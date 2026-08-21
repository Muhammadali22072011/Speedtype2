"""Общие зависимости роутов."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]
Token = Annotated[str | None, Depends(oauth2_scheme)]


def get_current_user_optional(db: DbSession, token: Token) -> User | None:
    """Пользователь, если он вошёл. Гостям тест тоже доступен.

    Заблокированный пользователь с валидным токеном считается не вошедшим:
    его токен перестаёт открывать личные ручки сразу, не дожидаясь, пока он
    истечёт сам. Тест как гость ему при этом доступен — блокировка аккаунта
    не запрещает печатать анонимно.
    """
    if not token:
        return None
    user_id = decode_access_token(token)
    if user_id is None:
        return None
    user = db.get(User, int(user_id))
    if user is None or user.blocked:
        return None
    return user


def get_current_user(
    user: Annotated[User | None, Depends(get_current_user_optional)],
) -> User:
    """Пользователь обязателен, иначе 401."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется вход",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
MaybeUser = Annotated[User | None, Depends(get_current_user_optional)]


def is_admin(user: User) -> bool:
    """Администратор ли пользователь — по списку из окружения, не по роли в базе.

    Источник правды — окружение: роль в базе можно было бы поменять запросом,
    а список имён в ADMIN_USERNAMES правит только тот, у кого доступ к серверу.
    """
    return user.username.lower() in settings.admin_username_set


def get_admin_user(user: CurrentUser) -> User:
    """Только для администратора, иначе 403.

    Не 404 и не 401: пользователь вошёл и существует, ему просто нельзя.
    Прятать сам факт существования админских ручек смысла нет — они
    перечислены в открытой схеме OpenAPI.
    """
    if not is_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только для администратора",
        )
    return user


AdminUser = Annotated[User, Depends(get_admin_user)]
