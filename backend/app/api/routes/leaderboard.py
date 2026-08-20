"""Лидерборд: лучший результат каждого игрока по выбранным фильтрам."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Query, Response
from sqlalchemy import Select, select

from app.api.deps import DbSession, MaybeUser
from app.models import Result, User
from app.schemas import LeaderboardRow, LeaderboardSelf

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])

Period = Literal["all", "daily", "weekly", "monthly"]

_PERIOD_DAYS: dict[str, int] = {"daily": 1, "weekly": 7, "monthly": 30}

# Таблица лучших собирается в Python, а значит читается целиком. Предел
# нужен, чтобы запрос не превратился в чтение всей истории: берём последние
# лучшие результаты, отсортированные по wpm. На нашем размере базы этого
# хватает с большим запасом; когда упрёмся — понадобится оконный запрос
# или отдельная таблица рекордов.
MAX_SCAN = 20_000


def _filtered(
    period: str,
    mode: str | None,
    mode_value: str | None,
    language: str | None,
) -> Select[tuple[Result, User]]:
    stmt = select(Result, User).join(User, Result.user_id == User.id)

    if period != "all":
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=_PERIOD_DAYS[period])
        stmt = stmt.where(Result.created_at >= since)

    if mode:
        stmt = stmt.where(Result.mode == mode)
    if mode_value:
        stmt = stmt.where(Result.mode_value == mode_value)
    if language:
        stmt = stmt.where(Result.language == language)

    return stmt.order_by(Result.wpm.desc()).limit(MAX_SCAN)


def _ranked(
    db: DbSession,
    period: str,
    mode: str | None,
    mode_value: str | None,
    language: str | None,
) -> list[tuple[Result, User]]:
    """По одной строке на игрока — его лучший результат, в порядке убывания wpm.

    Отбираем в Python: окно на SQLite через ORM читается хуже, а выборка
    ограничена MAX_SCAN.
    """
    best_per_user: dict[int, tuple[Result, User]] = {}
    for result, user in db.execute(_filtered(period, mode, mode_value, language)):
        best_per_user.setdefault(user.id, (result, user))

    return sorted(best_per_user.values(), key=lambda pair: pair[0].wpm, reverse=True)


def _row(index: int, result: Result, user: User) -> LeaderboardRow:
    return LeaderboardRow(
        rank=index,
        username=user.username,
        avatar=user.avatar,
        wpm=result.wpm,
        raw=result.raw,
        accuracy=result.accuracy,
        consistency=result.consistency,
        mode=result.mode,
        mode_value=result.mode_value,
        language=result.language,
        created_at=result.created_at,
    )


@router.get("", response_model=list[LeaderboardRow])
def leaderboard(
    db: DbSession,
    response: Response,
    period: Period = "all",
    mode: str | None = Query(default=None),
    mode_value: str | None = Query(default=None),
    language: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[LeaderboardRow]:
    rows = _ranked(db, period, mode, mode_value, language)

    # Общее число строк отдаём заголовком, а не в теле: тело остаётся
    # списком, и клиент, которому пагинация не нужна, ничего не замечает.
    response.headers["X-Total-Count"] = str(len(rows))
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    page = rows[offset : offset + limit]
    return [_row(offset + index, result, user) for index, (result, user) in enumerate(page, start=1)]


@router.get("/me", response_model=LeaderboardSelf)
def my_place(
    db: DbSession,
    user: MaybeUser,
    period: Period = "all",
    mode: str | None = Query(default=None),
    mode_value: str | None = Query(default=None),
    language: str | None = Query(default=None),
) -> LeaderboardSelf:
    """Своё место при тех же фильтрах — чтобы подсветить строку и доскроллить до неё."""
    if user is None:
        return LeaderboardSelf(rank=None, row=None)

    for index, (result, row_user) in enumerate(
        _ranked(db, period, mode, mode_value, language), start=1
    ):
        if row_user.id == user.id:
            return LeaderboardSelf(rank=index, row=_row(index, result, row_user))

    return LeaderboardSelf(rank=None, row=None)
