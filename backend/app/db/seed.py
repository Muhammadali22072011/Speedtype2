"""Заливка языков в базу из JSON-файлов.

Источник правды — файлы в app/data/languages. База лишь их отражение,
поэтому добавить язык = положить рядом ещё один JSON и перезапустить сид.

Запуск: python -m app.db.seed
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import Base, SessionLocal, engine
from app.models import Language, Quote, Word

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "languages"


def seed_language(db: Session, payload: dict) -> tuple[int, int]:
    """Создать или обновить один язык. Возвращает (добавлено слов, добавлено цитат)."""
    lang = db.scalar(select(Language).where(Language.name == payload["name"]))
    if lang is None:
        lang = Language(
            name=payload["name"],
            display_name=payload["displayName"],
            rtl=payload.get("rtl", False),
        )
        db.add(lang)
        db.flush()
    else:
        lang.display_name = payload["displayName"]
        lang.rtl = payload.get("rtl", False)

    existing_words = set(db.scalars(select(Word.word).where(Word.language_id == lang.id)))
    # dict.fromkeys убирает повторы внутри самого файла, сохраняя порядок
    unique_words = dict.fromkeys(payload.get("words", []))
    new_words = [w for w in unique_words if w not in existing_words]
    db.add_all(Word(language_id=lang.id, word=w) for w in new_words)

    existing_quotes = set(db.scalars(select(Quote.text).where(Quote.language_id == lang.id)))
    unique_quotes = {q["text"]: q for q in payload.get("quotes", [])}.values()
    new_quotes = [q for q in unique_quotes if q["text"] not in existing_quotes]
    db.add_all(
        Quote(language_id=lang.id, text=q["text"], source=q.get("source")) for q in new_quotes
    )

    return len(new_words), len(new_quotes)


def run() -> None:
    Base.metadata.create_all(bind=engine)

    files = sorted(DATA_DIR.glob("*.json"))
    if not files:
        print(f"нет файлов языков в {DATA_DIR}")
        return

    with SessionLocal() as db:
        for path in files:
            payload = json.loads(path.read_text(encoding="utf-8"))
            words, quotes = seed_language(db, payload)
            print(f"{payload['name']:<10} +{words} слов, +{quotes} цитат")
        db.commit()

    print("готово")


if __name__ == "__main__":
    run()
