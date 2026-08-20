"""Регистрация, вход, текущий пользователь."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserOut

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

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
