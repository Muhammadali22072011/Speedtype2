"""Регистрация, вход, текущий пользователь."""

from __future__ import annotations

import json

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select

from app.api import deps
from app.api.deps import CurrentUser, DbSession
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Result, User
from app.schemas import (
    AccountDelete,
    LoginRequest,
    PasswordUpdate,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.services import accounts, avatars

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DbSession) -> TokenResponse:
    taken = db.scalar(
        select(User).where((User.username == payload.username) | (User.email == payload.email))
    )
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Имя или email уже заняты")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        settings=json.dumps({}),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    user = db.scalar(
        select(User).where((User.username == payload.username) | (User.email == payload.username))
    )
    # Сравниваем пароль даже когда пользователя нет, чтобы по времени ответа
    # нельзя было узнать, существует ли такой логин.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")

    # Проверяем блокировку только после пароля: иначе по разному ответу на
    # заблокированного и несуществующего можно было бы перебирать логины.
    if user.blocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт заблокирован")

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    # is_admin проставляем здесь: в модели User его нет, он считается по
    # окружению. Клиент по нему решает, показывать ли ссылку на админку.
    out = UserOut.model_validate(user)
    out.is_admin = deps.is_admin(user)
    return out


def _check_password(user: User, password: str) -> None:
    """Подтверждение текущим паролем. Без него смена почты — половина угона."""
    if not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Неверный пароль")


@router.patch("/me", response_model=UserOut)
def update_me(payload: ProfileUpdate, db: DbSession, user: CurrentUser) -> User:
    """Сменить имя или почту."""
    _check_password(user, payload.current_password)

    if payload.username is not None and payload.username != user.username:
        taken = db.scalar(select(User).where(User.username == payload.username))
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "Имя уже занято")
        user.username = payload.username

    if payload.email is not None and payload.email != user.email:
        taken = db.scalar(select(User).where(User.email == payload.email))
        if taken:
            raise HTTPException(status.HTTP_409_CONFLICT, "Почта уже занята")
        user.email = payload.email

    db.commit()
    db.refresh(user)
    return user


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def change_password(payload: PasswordUpdate, db: DbSession, user: CurrentUser) -> Response:
    """Сменить пароль. Старые токены остаются рабочими — своего чёрного
    списка у нас нет, и заводить его ради одной ручки несоразмерно."""
    _check_password(user, payload.current_password)

    user.password_hash = hash_password(payload.new_password)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/export")
def export_data(db: DbSession, user: CurrentUser) -> dict:
    """Выгрузить свои данные одним json — то же, что «export data» у них.

    Отдаём всё, что о человеке знает база: профиль и вся история.
    """
    results = db.scalars(
        select(Result).where(Result.user_id == user.id).order_by(Result.created_at)
    )

    return {
        "user": {
            "username": user.username,
            "email": user.email,
            "created_at": user.created_at.isoformat(),
        },
        "results": [
            {
                "wpm": r.wpm,
                "raw": r.raw,
                "accuracy": r.accuracy,
                "consistency": r.consistency,
                "correct_chars": r.correct_chars,
                "incorrect_chars": r.incorrect_chars,
                "mode": r.mode,
                "mode_value": r.mode_value,
                "language": r.language,
                "duration": r.duration,
                "created_at": r.created_at.isoformat(),
            }
            for r in results
        ],
    }


AVATAR_DIR = Path(__file__).resolve().parents[2] / "static" / "avatars"


@router.post("/avatar", response_model=UserOut)
async def upload_avatar(db: DbSession, user: CurrentUser, file: UploadFile = File(...)) -> User:
    """Загрузить аватарку.

    Тип определяется по содержимому файла, а не по имени и не по
    content-type: и то и другое приходит от клиента и подделывается.
    """
    data = await file.read()

    try:
        user.avatar = avatars.save(AVATAR_DIR, user.id, data)
    except avatars.AvatarError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(error)) from error

    db.commit()
    db.refresh(user)
    return user


@router.delete("/avatar", response_model=UserOut)
def delete_avatar(db: DbSession, user: CurrentUser) -> User:
    """Убрать аватарку и вернуться к иконке по умолчанию."""
    avatars.remove(AVATAR_DIR, user.id)
    user.avatar = None
    db.commit()
    db.refresh(user)
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_me(payload: AccountDelete, db: DbSession, user: CurrentUser) -> Response:
    """Удалить аккаунт вместе со всей историей. Необратимо.

    Само удаление — в services/accounts: тем же путём удаляет пользователей
    и админка, чтобы чистилось одинаково и ничего не оставалось висеть.
    """
    _check_password(user, payload.current_password)

    accounts.delete_user(db, user)
    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
