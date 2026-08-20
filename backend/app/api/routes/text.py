"""Языки и генерация текста для теста."""

from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.models import Language, Quote, Word
from app.schemas import LanguageOut, TextResponse
from app.services import text as text_service

router = APIRouter(tags=["text"])


@router.get("/languages", response_model=list[LanguageOut])
def list_languages(db: DbSession) -> list[Language]:
    return list(db.scalars(select(Language).order_by(Language.name)))


@router.get("/text", response_model=TextResponse)
def generate_text(
    db: DbSession,
    language: str = Query(default="english"),
    count: int = Query(default=50, ge=1, le=500),
    mode: str = Query(default="words"),
    punctuation: bool = Query(default=False),
    numbers: bool = Query(default=False),
    seed: int | None = Query(default=None),
) -> TextResponse:
    lang = db.scalar(select(Language).where(Language.name == language))
    if lang is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Язык '{language}' не найден")

    if mode == "quote":
        quote = db.scalar(
            select(Quote).where(Quote.language_id == lang.id).order_by(func.random()).limit(1)
        )
        if quote is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Для этого языка нет цитат")
        # Цитата уже со знаками, добавлять к ней ничего не нужно
        return TextResponse(words=quote.text.split(), language=lang.name, source=quote.source)

    pool = list(db.scalars(select(Word.word).where(Word.language_id == lang.id)))
    if not pool:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Для этого языка нет слов")

    # seed позволяет выдать одинаковый текст всем участникам гонки
    rng = random.Random(seed)

    # Слова повторяются: словарь короче, чем длина теста, и это нормально.
    words = [rng.choice(pool) for _ in range(count)]
    words = text_service.prepare(words, punctuation=punctuation, numbers=numbers, seed=seed)

    return TextResponse(words=words, language=lang.name)
