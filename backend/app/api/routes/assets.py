"""Темы, языки, раскладки и цитаты — отдаются из файлов.

Данные взяты из monkeytype (GPL-3.0): 187 тем, 432 языка, 87 наборов
цитат, 239 раскладок. Файлы лежат в app/static и раздаются как есть,
а здесь только списки, чтобы клиент знал, что доступно.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

router = APIRouter(tags=["assets"])


class ThemeInfo(BaseModel):
    name: str
    colors: dict[str, str]
    hasCss: bool


class LanguageInfo(BaseModel):
    name: str
    displayName: str
    words: int


@lru_cache
def _load_themes() -> dict[str, dict]:
    path = DATA_DIR / "themes.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache
def _load_language_index() -> list[LanguageInfo]:
    """Собрать список языков один раз при первом запросе.

    Читаем каждый файл ради количества слов — 432 файла, поэтому
    результат кэшируем на всё время работы процесса.
    """
    languages: list[LanguageInfo] = []
    directory = STATIC_DIR / "languages"

    for path in sorted(directory.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        name = payload.get("name") or path.stem
        languages.append(
            LanguageInfo(
                name=path.stem,
                displayName=name.replace("_", " "),
                words=len(payload.get("words", [])),
            )
        )

    return languages


@router.get("/themes", response_model=list[ThemeInfo])
def list_themes() -> list[ThemeInfo]:
    themes = _load_themes()
    return [
        ThemeInfo(name=name, colors=data["colors"], hasCss=data.get("hasCss", False))
        for name, data in sorted(themes.items())
    ]


@router.get("/languages/index", response_model=list[LanguageInfo])
def list_languages() -> list[LanguageInfo]:
    return _load_language_index()


@router.get("/layouts/index", response_model=list[str])
def list_layouts() -> list[str]:
    return sorted(p.stem for p in (STATIC_DIR / "layouts").glob("*.json"))


@router.get("/quotes/index", response_model=list[str])
def list_quote_sets() -> list[str]:
    return sorted(p.stem for p in (STATIC_DIR / "quotes").glob("*.json"))


def _zipf_index(rng, size: int) -> int:
    """Индекс слова со смещением к началу списка.

    Словари monkeytype отсортированы по убыванию частоты, поэтому
    «частые слова встречаются чаще» — это просто выборка, смещённая
    к нулю. Берём квадрат равномерной величины: слово из первой десятой
    части словаря выпадает примерно в шесть раз чаще, чем из последней.
    """
    return min(size - 1, int(rng.random() ** 2 * size))


@router.get("/words/{language}")
def get_words(
    language: str,
    count: int = 50,
    punctuation: bool = False,
    numbers: bool = False,
    zipf: bool = False,
):
    """Слова из языкового файла monkeytype.

    Отдельно от /api/text: тот берёт слова из базы, этот — из файлов,
    и знает про все 432 языка.
    """
    # Имя приходит от клиента, поэтому проверяем, что это простое имя файла
    if not language.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимое имя языка")

    path = STATIC_DIR / "languages" / f"{language}.json"
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Язык '{language}' не найден")

    payload = json.loads(path.read_text(encoding="utf-8"))
    pool: list[str] = payload.get("words", [])
    if not pool:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "В файле языка нет слов")

    import random

    from app.services import text as text_service

    rng = random.Random()
    total = max(1, min(count, 500))

    if zipf:
        words = [pool[_zipf_index(rng, len(pool))] for _ in range(total)]
    else:
        words = [rng.choice(pool) for _ in range(total)]

    words = text_service.prepare(words, punctuation=punctuation, numbers=numbers)

    return {
        "words": words,
        "language": language,
        "rtl": payload.get("rightToLeft", False),
        "noLazyMode": payload.get("noLazyMode", False),
    }
