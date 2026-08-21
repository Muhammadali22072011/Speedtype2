"""Сохранение результатов и личная статистика."""

from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import Integer, delete, func, select

from app.api.deps import CurrentUser, DbSession, MaybeUser
from app.models import Result, ResultTag, Tag
from app.schemas import (
    ActivityDay,
    HistogramBucket,
    PersonalRecord,
    ProgressOut,
    ResultCreate,
    ResultOut,
    ResultSamples,
    TagOut,
    UserStats,
)
from app.services import anticheat, progress
from app.services.metrics import build_metrics

router = APIRouter(prefix="/results", tags=["results"])


def _pack_samples(wpm_samples: list[float], raw_samples: list[float]) -> str | None:
    """Свернуть посекундные ряды в JSON для хранения — или None, если их нет.

    Оба ряда пусты (старый клиент, zen без замеров) — храним NULL, а не «{}»:
    так по колонке сразу видно, есть график или нет.
    """
    if not wpm_samples and not raw_samples:
        return None
    return json.dumps({"wpm": wpm_samples, "raw": raw_samples})


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
        raw_samples=payload.raw_samples,
    )

    verdict = anticheat.validate(metrics, samples_count=len(payload.wpm_samples))
    anticheat.record(verdict.ok)
    if not verdict.ok:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, verdict.reason)

    result = Result(
        user_id=user.id if user else None,
        wpm=metrics.wpm,
        raw=metrics.raw,
        accuracy=metrics.accuracy,
        consistency=metrics.consistency,
        consistency_version=metrics.consistency_version,
        correct_chars=metrics.correct_chars,
        incorrect_chars=metrics.incorrect_chars,
        mode=payload.mode,
        mode_value=payload.mode_value,
        language=payload.language,
        duration=metrics.duration,
        samples=_pack_samples(payload.wpm_samples, payload.raw_samples),
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


@router.get("", response_model=list[ResultOut])
def my_results(
    db: DbSession,
    user: CurrentUser,
    response: Response,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    mode: str | None = Query(default=None, max_length=20),
    mode_value: str | None = Query(default=None, max_length=20),
    language: str | None = Query(default=None, max_length=30),
    since: dt.datetime | None = Query(default=None),
    until: dt.datetime | None = Query(default=None),
    tag_id: list[int] = Query(default_factory=list),
) -> list[ResultOut]:
    """История с фильтрами.

    Фильтры валидируются здесь, а не на клиенте: длина строк ограничена,
    даты разбирает pydantic. Общее число строк отдаём заголовком —
    без него клиент не знает, сколько всего страниц.

    Несколько ``tag_id`` — это «И», а не «ИЛИ»: результат должен иметь все
    указанные метки. «утро и новая раскладка» — осмысленный вопрос, а
    «утро или новая раскладка» почти никогда, поэтому пересечение полезнее
    объединения. Чужой tag_id не ошибка и не утечка: у результатов
    пользователя его меток нет, выборка просто окажется пустой.
    """
    filters = [Result.user_id == user.id]
    if mode:
        filters.append(Result.mode == mode)
    if mode_value:
        filters.append(Result.mode_value == mode_value)
    if language:
        filters.append(Result.language == language)
    if since:
        filters.append(Result.created_at >= since)
    if until:
        filters.append(Result.created_at <= until)
    if tag_id:
        # Пересечение через GROUP BY … HAVING: результат обязан быть связан
        # со ВСЕМИ метками, а не с любой из них. distinct на случай, если
        # клиент прислал один и тот же tag_id дважды — иначе счёт завысится.
        wanted = set(tag_id)
        with_all_tags = (
            select(ResultTag.result_id)
            .where(ResultTag.tag_id.in_(wanted))
            .group_by(ResultTag.result_id)
            .having(func.count(func.distinct(ResultTag.tag_id)) == len(wanted))
        )
        filters.append(Result.id.in_(with_all_tags))

    total = db.scalar(select(func.count(Result.id)).where(*filters)) or 0
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    stmt = (
        select(Result)
        .where(*filters)
        .order_by(Result.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list(db.scalars(stmt))

    return _with_tags(db, rows)


def _with_tags(db: DbSession, rows: list[Result]) -> list[ResultOut]:
    """Дописать метки к строкам истории.

    Одним запросом на всю страницу, а не по запросу на строку: иначе
    таблица на пятьдесят результатов сходила бы в базу пятьдесят раз.
    """
    out = [ResultOut.model_validate(row) for row in rows]
    if not rows:
        return out

    pairs = db.execute(
        select(ResultTag.result_id, Tag.id, Tag.name)
        .join(Tag, Tag.id == ResultTag.tag_id)
        .where(ResultTag.result_id.in_([r.id for r in rows]))
        .order_by(Tag.name)
    ).all()

    by_result: dict[int, list[TagOut]] = {}
    for result_id, tag_id, name in pairs:
        by_result.setdefault(result_id, []).append(TagOut(id=tag_id, name=name))

    for item in out:
        item.tags = by_result.get(item.id, [])

    return out


# Рекорды считаем на лету, отдельной таблицы нет. Предел на выборку тот же,
# что и у лидерборда: дальше него история читается слишком долго, и тогда
# понадобится таблица рекордов, обновляемая при сохранении результата.
MAX_SCAN = 20_000


@router.get("/records", response_model=list[PersonalRecord])
def my_records(db: DbSession, user: CurrentUser) -> list[PersonalRecord]:
    """Лучший результат в каждом режиме — 15/30/60/120 и 10/25/50/100."""
    stmt = (
        select(Result)
        .where(Result.user_id == user.id)
        .order_by(Result.wpm.desc())
        .limit(MAX_SCAN)
    )

    best: dict[tuple[str, str], Result] = {}
    for result in db.scalars(stmt):
        best.setdefault((result.mode, result.mode_value), result)

    return [
        PersonalRecord(
            mode=result.mode,
            mode_value=result.mode_value,
            wpm=result.wpm,
            raw=result.raw,
            accuracy=result.accuracy,
            consistency=result.consistency,
            language=result.language,
            created_at=result.created_at,
        )
        for result in sorted(best.values(), key=lambda r: r.wpm, reverse=True)
    ]


@router.get("/activity", response_model=list[ActivityDay])
def my_activity(
    db: DbSession,
    user: CurrentUser,
    days: int = Query(default=365, ge=1, le=1100),
) -> list[ActivityDay]:
    """Сколько тестов в каждый день — для тепловой карты активности.

    Считаем на сервере, а не на клиенте: иначе за годом истории пришлось бы
    тянуть все результаты целиком ради одного числа на день.

    Дни без тестов не отдаём — их дорисует клиент, ему всё равно рисовать
    сетку из пустых клеток.
    """
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)

    # date() у SQLite отдаёт строку YYYY-MM-DD — ровно то, что нужно клиенту
    day = func.date(Result.created_at)
    rows = db.execute(
        select(day, func.count(Result.id), func.sum(Result.duration), func.max(Result.wpm))
        .where(Result.user_id == user.id, Result.created_at >= since)
        .group_by(day)
        .order_by(day)
    ).all()

    return [
        ActivityDay(
            date=str(date),
            tests=tests or 0,
            time=round(time or 0, 2),
            best_wpm=round(best or 0, 2),
        )
        for date, tests, time, best in rows
    ]


@router.get("/progress", response_model=ProgressOut)
def my_progress(db: DbSession, user: CurrentUser) -> ProgressOut:
    """Опыт, уровень и серия дней.

    Считается на лету по истории: отдельной колонки с накопленным опытом
    нет намеренно — формулу начисления захочется поправить, и с колонкой
    пришлось бы пересчитывать всю базу.
    """
    rows = db.execute(
        select(Result.duration, Result.accuracy, Result.incorrect_chars).where(
            Result.user_id == user.id
        )
    ).all()

    chars = db.scalar(
        select(func.sum(Result.correct_chars)).where(Result.user_id == user.id)
    )

    day = func.date(Result.created_at)
    days = [
        dt.date.fromisoformat(str(value))
        for (value,) in db.execute(
            select(day).where(Result.user_id == user.id).group_by(day).order_by(day)
        ).all()
    ]

    info = progress.level_from_xp(progress.total_xp([tuple(r) for r in rows]))
    streak, longest = progress.streak_from_days(days, dt.datetime.now(dt.timezone.utc).date())

    return ProgressOut(
        xp=info.xp,
        level=info.level,
        xp_in_level=info.xp_in_level,
        xp_for_level=info.xp_for_level,
        progress=info.progress,
        streak=streak,
        longest_streak=longest,
        words_typed=progress.estimated_words(int(chars or 0)),
    )


@router.get("/histogram", response_model=list[HistogramBucket])
def my_histogram(
    db: DbSession,
    user: CurrentUser,
    step: int = Query(default=10, ge=5, le=50),
) -> list[HistogramBucket]:
    """Распределение результатов по скорости — столбики по step wpm.

    Группируем в SQL: гонять тысячи строк на клиент ради гистограммы
    из полутора десятков столбиков незачем.
    """
    bucket = (func.cast(Result.wpm / step, Integer)) * step
    rows = db.execute(
        select(bucket, func.count(Result.id))
        .where(Result.user_id == user.id)
        .group_by(bucket)
        .order_by(bucket)
    ).all()

    return [HistogramBucket(wpm=int(low or 0), tests=count or 0) for low, count in rows]


@router.get("/{result_id}/samples", response_model=ResultSamples)
def result_samples(result_id: int, db: DbSession, user: CurrentUser) -> ResultSamples:
    """Посекундные ряды одного результата — для мини-графика в строке истории.

    Отдельным запросом, а не полем в списке: ряды весят под килобайта на
    результат, и тащить их полсотнями ради истории незачем. Клиент берёт их
    лениво — когда строку разворачивают.

    Чужой результат не отдаём даже видеть — сразу 404, тем же путём, что и
    удаление. У старых результатов рядов нет: отвечаем пустыми списками,
    а не 404, чтобы клиент отличал «нет графика» от «нет результата».
    """
    result = db.get(Result, result_id)
    if result is None or result.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Результат не найден")

    if not result.samples:
        return ResultSamples(wpm=[], raw=[])

    data = json.loads(result.samples)
    return ResultSamples(wpm=data.get("wpm", []), raw=data.get("raw", []))


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def reset_results(db: DbSession, user: CurrentUser) -> Response:
    """Стереть всю свою историю. Необратимо — подтверждение спрашивает клиент."""
    db.execute(delete(Result).where(Result.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{result_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_result(result_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Удалить свой результат. Чужой не отдаём даже видеть — сразу 404."""
    result = db.get(Result, result_id)
    if result is None or result.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Результат не найден")

    db.delete(result)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
