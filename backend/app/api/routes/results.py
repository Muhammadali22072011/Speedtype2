"""Сохранение результатов и личная статистика."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, MaybeUser
from app.models import Result
from app.schemas import ResultCreate, ResultOut, UserStats
from app.services import anticheat
from app.services.metrics import build_metrics

router = APIRouter(prefix="/results", tags=["results"])


@router.post("", response_model=ResultOut, status_code=status.HTTP_201_CREATED)
def submit_result(payload: ResultCreate, db: DbSession, user: MaybeUser) -> Result:
    """Принять результат теста.

    Метрики считает сервер по сырым счётчикам — клиент присылает только
    количество верных и ошибочных нажатий, время и посекундные замеры.
    """
    metrics = build_metrics(
        correct_chars=payload.correct_chars,
        incorrect_chars=payload.incorrect_chars,
        seconds=payload.duration,
        wpm_samples=payload.wpm_samples,
    )

    verdict = anticheat.validate(metrics, samples_count=len(payload.wpm_samples))
    if not verdict.ok:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, verdict.reason)

    result = Result(
        user_id=user.id if user else None,
        wpm=metrics.wpm,
        raw=metrics.raw,
        accuracy=metrics.accuracy,
        consistency=metrics.consistency,
        correct_chars=metrics.correct_chars,
        incorrect_chars=metrics.incorrect_chars,
        mode=payload.mode,
        mode_value=payload.mode_value,
        language=payload.language,
        duration=metrics.duration,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


@router.get("", response_model=list[ResultOut])
def my_results(
    db: DbSession,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[Result]:
    stmt = (
        select(Result)
        .where(Result.user_id == user.id)
        .order_by(Result.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt))


@router.get("/stats", response_model=UserStats)
def my_stats(db: DbSession, user: CurrentUser) -> UserStats:
    row = db.execute(
        select(
            func.count(Result.id),
            func.avg(Result.wpm),
            func.max(Result.wpm),
            func.avg(Result.accuracy),
            func.sum(Result.duration),
        ).where(Result.user_id == user.id)
    ).one()

    tests, avg_wpm, best_wpm, avg_acc, total_time = row

    # Начало сегодняшних суток по UTC — тот же отсчёт, что у периода daily
    since = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today = db.execute(
        select(func.count(Result.id), func.sum(Result.duration)).where(
            Result.user_id == user.id, Result.created_at >= since
        )
    ).one()

    return UserStats(
        tests=tests or 0,
        avg_wpm=round(avg_wpm or 0, 2),
        best_wpm=round(best_wpm or 0, 2),
        avg_accuracy=round(avg_acc or 0, 2),
        time_typing=round(total_time or 0, 2),
        tests_today=today[0] or 0,
        time_today=round(today[1] or 0, 2),
    )
