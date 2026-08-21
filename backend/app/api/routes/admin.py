"""Админка: пользователи, модерация цитат, сводка.

Доступ — только у тех, кто перечислен в ADMIN_USERNAMES (см. deps.is_admin).
Проверка стоит на каждой ручке через зависимость AdminUser, а не один раз
на роутере: так её видно у каждой ручки и нельзя случайно завести админскую
ручку без неё.

Админ не может заблокировать или удалить себя и другого админа. Себя — чтобы
не запереть последнего администратора; другого админа — потому что роль
раздаётся окружением, и разбираться, кто главнее, здесь неуместно: сначала
уберите имя из ADMIN_USERNAMES.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select

from app.api.deps import AdminUser, DbSession, is_admin
from app.models import Quote, QuoteReport, Result, User
from app.services import accounts, anticheat
from app.services.rooms import registry

router = APIRouter(prefix="/admin", tags=["admin"])


# --- Пользователи --------------------------------------------------------


class AdminUserOut(BaseModel):
    id: int
    username: str
    email: str | None
    blocked: bool
    is_admin: bool
    created_at: dt.datetime
    tests: int


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    db: DbSession,
    admin: AdminUser,
    response: Response,
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AdminUserOut]:
    """Список пользователей с поиском по имени и почте.

    Число тестов берём одним запросом на всю страницу, а не по запросу на
    строку, — тем же приёмом, что и метки в истории.
    """
    filters = []
    needle = q.strip()
    if needle:
        like = f"%{needle}%"
        filters.append(or_(User.username.ilike(like), User.email.ilike(like)))

    total = db.scalar(select(func.count(User.id)).where(*filters)) or 0
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    users = list(
        db.scalars(
            select(User).where(*filters).order_by(User.created_at.desc()).limit(limit).offset(offset)
        )
    )
    if not users:
        return []

    counts = dict(
        db.execute(
            select(Result.user_id, func.count(Result.id))
            .where(Result.user_id.in_([u.id for u in users]))
            .group_by(Result.user_id)
        ).all()
    )

    return [
        AdminUserOut(
            id=u.id,
            username=u.username,
            email=u.email,
            blocked=u.blocked,
            is_admin=is_admin(u),
            created_at=u.created_at,
            tests=counts.get(u.id, 0),
        )
        for u in users
    ]


def _target_user(db: DbSession, admin: User, user_id: int) -> User:
    """Найти пользователя для админского действия и отсечь запреты.

    Себя и другого админа трогать нельзя (см. модуль). Несуществующий — 404.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Над собой так нельзя")
    if is_admin(user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя трогать другого администратора")
    return user


@router.post("/users/{user_id}/block", response_model=AdminUserOut)
def block_user(user_id: int, db: DbSession, admin: AdminUser) -> AdminUserOut:
    """Заблокировать: вход запрещён, существующий токен перестаёт действовать."""
    user = _target_user(db, admin, user_id)
    user.blocked = True
    db.commit()
    db.refresh(user)
    return AdminUserOut(
        id=user.id, username=user.username, email=user.email, blocked=user.blocked,
        is_admin=False, created_at=user.created_at, tests=0,
    )


@router.post("/users/{user_id}/unblock", response_model=AdminUserOut)
def unblock_user(user_id: int, db: DbSession, admin: AdminUser) -> AdminUserOut:
    """Снять блокировку."""
    user = _target_user(db, admin, user_id)
    user.blocked = False
    db.commit()
    db.refresh(user)
    return AdminUserOut(
        id=user.id, username=user.username, email=user.email, blocked=user.blocked,
        is_admin=False, created_at=user.created_at, tests=0,
    )


@router.delete("/users/{user_id}/results", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def reset_user_results(user_id: int, db: DbSession, admin: AdminUser) -> Response:
    """Стереть историю пользователя, сам аккаунт оставить. Необратимо."""
    user = _target_user(db, admin, user_id)
    # Метки результатов снимаем заодно, иначе повиснут на удалённых строках
    result_ids = [rid for (rid,) in db.execute(
        select(Result.id).where(Result.user_id == user.id)
    ).all()]
    if result_ids:
        from app.models import ResultTag

        db.execute(delete(ResultTag).where(ResultTag.result_id.in_(result_ids)))
    db.execute(delete(Result).where(Result.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_user(user_id: int, db: DbSession, admin: AdminUser) -> Response:
    """Удалить пользователя тем же путём, что и самоудаление."""
    user = _target_user(db, admin, user_id)
    accounts.delete_user(db, user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Модерация цитат -----------------------------------------------------


class AdminQuoteOut(BaseModel):
    id: int
    text: str
    source: str | None
    language: str | None
    status: str
    submitted_by: str | None
    rejection_reason: str | None
    created_at: dt.datetime | None


@router.get("/quotes", response_model=list[AdminQuoteOut])
def list_quotes(
    db: DbSession,
    admin: AdminUser,
    response: Response,
    status_filter: str = Query(default="pending", alias="status", pattern="^(pending|approved|rejected)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AdminQuoteOut]:
    """Очередь модерации: по умолчанию присланные и ждущие проверки.

    Цитаты из словарей monkeytype сюда не попадают — они раздаются из файлов
    и в таблицу quotes не заносятся. Здесь только пользовательские заявки.
    """
    from app.models import Language

    where = [Quote.status == status_filter]
    total = db.scalar(select(func.count(Quote.id)).where(*where)) or 0
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    rows = db.execute(
        select(Quote, Language.name, User.username)
        .outerjoin(Language, Language.id == Quote.language_id)
        .outerjoin(User, User.id == Quote.submitted_by)
        .where(*where)
        .order_by(Quote.created_at.desc().nullslast(), Quote.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        AdminQuoteOut(
            id=quote.id,
            text=quote.text,
            source=quote.source,
            language=lang_name,
            status=quote.status,
            submitted_by=username,
            rejection_reason=quote.rejection_reason,
            created_at=quote.created_at,
        )
        for quote, lang_name, username in rows
    ]


@router.post("/quotes/{quote_id}/approve", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def approve_quote(quote_id: int, db: DbSession, admin: AdminUser) -> Response:
    """Одобрить заявку — цитата начинает попадать в выдачу."""
    quote = db.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Цитата не найдена")
    quote.status = "approved"
    quote.rejection_reason = None
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/quotes/{quote_id}/reject", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def reject_quote(quote_id: int, payload: RejectIn, db: DbSession, admin: AdminUser) -> Response:
    """Отклонить заявку с причиной. Не удаляем: приславший увидит, почему.

    Отклонённая помечается статусом, а не стирается — иначе один и тот же
    текст присылали бы снова, не понимая, что с ним не так.
    """
    quote = db.get(Quote, quote_id)
    if quote is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Цитата не найдена")
    quote.status = "rejected"
    quote.rejection_reason = payload.reason.strip()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class AdminReportOut(BaseModel):
    id: int
    served_quote_id: int
    language: str
    text: str
    source: str | None
    reason: str
    reported_by: str | None
    created_at: dt.datetime
    resolved: bool


@router.get("/reports", response_model=list[AdminReportOut])
def list_reports(
    db: DbSession,
    admin: AdminUser,
    response: Response,
    resolved: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[AdminReportOut]:
    """Жалобы на цитаты. По умолчанию — ещё не разобранные."""
    where = [QuoteReport.resolved == resolved]
    total = db.scalar(select(func.count(QuoteReport.id)).where(*where)) or 0
    response.headers["X-Total-Count"] = str(total)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    rows = db.execute(
        select(QuoteReport, User.username)
        .outerjoin(User, User.id == QuoteReport.user_id)
        .where(*where)
        .order_by(QuoteReport.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        AdminReportOut(
            id=report.id,
            served_quote_id=report.served_quote_id,
            language=report.language,
            text=report.text,
            source=report.source,
            reason=report.reason,
            reported_by=username,
            created_at=report.created_at,
            resolved=report.resolved,
        )
        for report, username in rows
    ]


@router.post("/reports/{report_id}/resolve", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def resolve_report(report_id: int, db: DbSession, admin: AdminUser) -> Response:
    """Отметить жалобу разобранной, чтобы очередь не показывала её снова."""
    report = db.get(QuoteReport, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Жалоба не найдена")
    report.resolved = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Сводка --------------------------------------------------------------


class DayCount(BaseModel):
    date: str
    count: int


class AntiCheatStats(BaseModel):
    accepted: int
    rejected: int
    # Доля отклонённых среди всех проверенных, 0..1. С момента запуска сервера.
    reject_rate: float


class AdminSummary(BaseModel):
    users_total: int
    results_total: int
    registrations: list[DayCount]
    tests: list[DayCount]
    live_rooms: int
    live_players: int
    anticheat: AntiCheatStats


@router.get("/summary", response_model=AdminSummary)
def summary(
    db: DbSession,
    admin: AdminUser,
    days: int = Query(default=30, ge=1, le=365),
) -> AdminSummary:
    """Сводка: регистрации и тесты по дням, живые комнаты, работа античита.

    Живые комнаты и счётчики античита — из памяти процесса: воркер один,
    и это индикатор «сейчас», а не история. При перезапуске обнуляются.
    """
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)

    reg_day = func.date(User.created_at)
    registrations = [
        DayCount(date=str(d), count=c or 0)
        for d, c in db.execute(
            select(reg_day, func.count(User.id))
            .where(User.created_at >= since)
            .group_by(reg_day)
            .order_by(reg_day)
        ).all()
    ]

    test_day = func.date(Result.created_at)
    tests = [
        DayCount(date=str(d), count=c or 0)
        for d, c in db.execute(
            select(test_day, func.count(Result.id))
            .where(Result.created_at >= since)
            .group_by(test_day)
            .order_by(test_day)
        ).all()
    ]

    counters = anticheat.counters()
    checked = counters["accepted"] + counters["rejected"]
    reject_rate = counters["rejected"] / checked if checked else 0.0

    room_stats = registry.stats()

    return AdminSummary(
        users_total=db.scalar(select(func.count(User.id))) or 0,
        results_total=db.scalar(select(func.count(Result.id))) or 0,
        registrations=registrations,
        tests=tests,
        live_rooms=room_stats["rooms"],
        live_players=room_stats["players"],
        anticheat=AntiCheatStats(
            accepted=counters["accepted"],
            rejected=counters["rejected"],
            reject_rate=round(reject_rate, 4),
        ),
    )
