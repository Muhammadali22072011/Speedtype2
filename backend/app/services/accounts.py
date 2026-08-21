"""Удаление аккаунта — одним путём и для самого пользователя, и для админа.

Раньше самоудаление чистило только `results`, а метки, пресеты и жалобы
оставались висеть с внешним ключом на исчезнувшего пользователя. SQLite
внешние ключи по умолчанию не сторожит, поэтому падения не было — были
осиротевшие строки, которые всплыли бы позже. Здесь всё убирается за раз,
и обе ручки (самоудаление и админское удаление) зовут одну эту функцию,
чтобы «тем же путём» было правдой, а не обещанием.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Preset, QuoteReport, Quote, Result, ResultTag, Tag, User
from app.services import avatars

# Аватарки лежат на диске отдельно от базы — их надо убрать руками.
AVATAR_DIR = Path(__file__).resolve().parents[2] / "static" / "avatars"


def delete_user(db: Session, user: User) -> None:
    """Удалить пользователя и всё, что на нём висит. Необратимо, без commit.

    Commit оставлен вызывающему: самоудаление и админское удаление коммитят
    сами, каждое в своём месте.
    """
    # Картинка на диске сама не исчезнет
    avatars.remove(AVATAR_DIR, user.id)

    # Метки результатов — по самим результатам: связь в отдельной таблице
    result_ids = [rid for (rid,) in db.execute(
        select(Result.id).where(Result.user_id == user.id)
    ).all()]
    if result_ids:
        db.execute(delete(ResultTag).where(ResultTag.result_id.in_(result_ids)))

    # Результаты удаляем явно: ключ nullable, иначе повисли бы без владельца
    # и попали бы в лидерборд
    db.execute(delete(Result).where(Result.user_id == user.id))
    db.execute(delete(Tag).where(Tag.user_id == user.id))
    db.execute(delete(Preset).where(Preset.user_id == user.id))

    # Жалобы и присланные цитаты не удаляем, а обнуляем автора: жалоба со
    # снимком текста остаётся полезной модератору, а одобренная цитата —
    # игрокам. Привязка к удалённому пользователю при этом снимается.
    db.execute(update(QuoteReport).where(QuoteReport.user_id == user.id).values(user_id=None))
    db.execute(update(Quote).where(Quote.submitted_by == user.id).values(submitted_by=None))

    db.delete(user)
