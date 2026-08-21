"""Теги и пресеты — две функции monkeytype, которых у нас не было.

Тег — метка на результате: «разминка», «код», «левая рука». Нужна, чтобы
смотреть историю и рекорды не целиком, а по своей корзине.

Пресет — сохранённый набор настроек. Настройки хранятся одним JSON:
их состав меняется каждый раз, когда в config-spec добавляется строка.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import delete, select

from app.api.deps import CurrentUser, DbSession
from app.models import Preset, Result, ResultTag, Tag
from app.schemas import (
    PresetCreate,
    PresetOut,
    ResultTagsUpdate,
    TagCreate,
    TagOut,
)

router = APIRouter(tags=["tags"])


# ---------- теги ----------


def _tag_or_404(db: DbSession, user_id: int, tag_id: int) -> Tag:
    tag = db.get(Tag, tag_id)
    # Чужой тег не отличаем от несуществующего: иначе по коду ответа
    # можно перебрать, какие id заняты
    if tag is None or tag.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тег не найден")
    return tag


@router.get("/tags", response_model=list[TagOut])
def list_tags(db: DbSession, user: CurrentUser) -> list[Tag]:
    return list(db.scalars(select(Tag).where(Tag.user_id == user.id).order_by(Tag.name)))


@router.post("/tags", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(payload: TagCreate, db: DbSession, user: CurrentUser) -> Tag:
    taken = db.scalar(select(Tag).where(Tag.user_id == user.id, Tag.name == payload.name))
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Тег с таким именем уже есть")

    tag = Tag(user_id=user.id, name=payload.name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.patch("/tags/{tag_id}", response_model=TagOut)
def rename_tag(tag_id: int, payload: TagCreate, db: DbSession, user: CurrentUser) -> Tag:
    """Переименовать тег. Связи с результатами при этом не трогаются —
    ради этого теги и вынесены в отдельную таблицу."""
    tag = _tag_or_404(db, user.id, tag_id)

    taken = db.scalar(
        select(Tag).where(Tag.user_id == user.id, Tag.name == payload.name, Tag.id != tag_id)
    )
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Тег с таким именем уже есть")

    tag.name = payload.name
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tag(tag_id: int, db: DbSession, user: CurrentUser) -> Response:
    """Удалить тег вместе со всеми его связями.

    Связи убираем явно: внешних ключей с каскадом в SQLite по умолчанию нет,
    и без этого в result_tags остались бы висеть строки на несуществующий тег.
    """
    tag = _tag_or_404(db, user.id, tag_id)

    db.execute(delete(ResultTag).where(ResultTag.tag_id == tag.id))
    db.delete(tag)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/results/{result_id}/tags", response_model=list[TagOut])
def set_result_tags(
    result_id: int,
    payload: ResultTagsUpdate,
    db: DbSession,
    user: CurrentUser,
) -> list[Tag]:
    """Заменить набор тегов результата целиком.

    Именно заменить, а не добавить: интерфейс отмечает галочками весь
    список сразу, и присылать разницу ему неоткуда.
    """
    result = db.get(Result, result_id)
    if result is None or result.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Результат не найден")

    # Проверяем, что все теги свои: иначе можно навесить на свой результат
    # чужой тег и увидеть его имя
    tags = list(
        db.scalars(select(Tag).where(Tag.user_id == user.id, Tag.id.in_(payload.tag_ids)))
    )
    if len(tags) != len(set(payload.tag_ids)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Какой-то из тегов не найден")

    db.execute(delete(ResultTag).where(ResultTag.result_id == result.id))
    for tag in tags:
        db.add(ResultTag(result_id=result.id, tag_id=tag.id))
    db.commit()

    return sorted(tags, key=lambda t: t.name)


@router.get("/results/{result_id}/tags", response_model=list[TagOut])
def get_result_tags(result_id: int, db: DbSession, user: CurrentUser) -> list[Tag]:
    result = db.get(Result, result_id)
    if result is None or result.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Результат не найден")

    return list(
        db.scalars(
            select(Tag)
            .join(ResultTag, ResultTag.tag_id == Tag.id)
            .where(ResultTag.result_id == result.id)
            .order_by(Tag.name)
        )
    )


# ---------- пресеты ----------


def _preset_or_404(db: DbSession, user_id: int, preset_id: int) -> Preset:
    preset = db.get(Preset, preset_id)
    if preset is None or preset.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пресет не найден")
    return preset


def _to_out(preset: Preset) -> PresetOut:
    try:
        settings = json.loads(preset.settings)
    except json.JSONDecodeError:
        # Битый json в базе не повод ронять всю страницу настроек
        settings = {}

    return PresetOut(
        id=preset.id,
        name=preset.name,
        settings=settings,
        created_at=preset.created_at,
    )


@router.get("/presets", response_model=list[PresetOut])
def list_presets(db: DbSession, user: CurrentUser) -> list[PresetOut]:
    presets = db.scalars(select(Preset).where(Preset.user_id == user.id).order_by(Preset.name))
    return [_to_out(p) for p in presets]


@router.post("/presets", response_model=PresetOut, status_code=status.HTTP_201_CREATED)
def create_preset(payload: PresetCreate, db: DbSession, user: CurrentUser) -> PresetOut:
    taken = db.scalar(
        select(Preset).where(Preset.user_id == user.id, Preset.name == payload.name)
    )
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пресет с таким именем уже есть")

    preset = Preset(
        user_id=user.id,
        name=payload.name,
        settings=json.dumps(payload.settings, ensure_ascii=False),
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _to_out(preset)


@router.put("/presets/{preset_id}", response_model=PresetOut)
def update_preset(
    preset_id: int,
    payload: PresetCreate,
    db: DbSession,
    user: CurrentUser,
) -> PresetOut:
    """Перезаписать пресет — и имя, и настройки."""
    preset = _preset_or_404(db, user.id, preset_id)

    taken = db.scalar(
        select(Preset).where(
            Preset.user_id == user.id, Preset.name == payload.name, Preset.id != preset_id
        )
    )
    if taken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Пресет с таким именем уже есть")

    preset.name = payload.name
    preset.settings = json.dumps(payload.settings, ensure_ascii=False)
    db.commit()
    db.refresh(preset)
    return _to_out(preset)


@router.delete(
    "/presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
def delete_preset(preset_id: int, db: DbSession, user: CurrentUser) -> Response:
    preset = _preset_or_404(db, user.id, preset_id)
    db.delete(preset)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
