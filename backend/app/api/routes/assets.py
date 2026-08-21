"""Темы, языки, раскладки и цитаты — отдаются из файлов.

Данные взяты из monkeytype (GPL-3.0): 187 тем, 432 языка, 87 наборов
цитат, 239 раскладок. Файлы лежат в app/static и раздаются как есть,
а здесь только списки, чтобы клиент знал, что доступно.
"""

from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path

import datetime as dt

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.models import Language, Quote, QuoteReport

STATIC_DIR = Path(__file__).resolve().parents[2] / "static"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

router = APIRouter(tags=["assets"])

# Пользовательские цитаты из базы отдаются в том же потоке, что и файловые.
# Чтобы их id не столкнулись с файловыми (те — небольшие положительные),
# базовым добавляем сдвиг. По сдвигу же на обратном пути видно, что цитату
# надо искать в базе, а не в файле.
DB_QUOTE_ID_OFFSET = 1_000_000


def _approved_db_quotes(db, language: str) -> list[dict]:
    """Одобренные пользовательские цитаты языка в форме файловой цитаты.

    Пустой список, если таких нет или язык не заведён в базе, — тогда
    выдача остаётся чисто файловой, как и была.
    """
    rows = db.execute(
        select(Quote.id, Quote.text, Quote.source)
        .join(Language, Language.id == Quote.language_id)
        .where(Language.name == language, Quote.status == "approved")
    ).all()
    return [
        {
            "id": DB_QUOTE_ID_OFFSET + qid,
            "text": text,
            "source": source,
            "length": len(text),
        }
        for qid, text, source in rows
    ]


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


class QuoteOut(BaseModel):
    words: list[str]
    language: str
    source: str | None = None
    length: int = 0
    id: int | None = None


# Границы групп ровно те же, что в файлах monkeytype: [0,100], [101,300],
# [301,600], [601,9999]. Имена — наши, чтобы клиенту не считать индексы.
_QUOTE_GROUPS = {"short": 0, "medium": 1, "long": 2, "thicc": 3}


@lru_cache
def _load_quotes(language: str) -> dict:
    path = STATIC_DIR / "quotes" / f"{language}.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _filter_by_length(quotes: list[dict], payload: dict, length: str) -> list[dict]:
    """Оставить цитаты нужной группы длины.

    Пустая группа не отсекает выдачу совсем: у редких языков цитат
    десяток, и «нет коротких» лучше показать всеми, чем пустым списком.
    """
    group = _QUOTE_GROUPS.get(length)
    if group is None:
        return quotes

    groups: list[list[int]] = payload.get("groups", [])
    if group >= len(groups):
        return quotes

    low, high = groups[group]
    filtered = [q for q in quotes if low <= q.get("length", 0) <= high]
    return filtered or quotes


@router.get("/quotes/{language}", response_model=QuoteOut)
def get_quote(language: str, db: DbSession, length: str = "all", id: int | None = Query(default=None)):
    """Цитата: случайная нужной длины или конкретная по id.

    Основа — файлы monkeytype: там 87 языков со своей разметкой по длине,
    настройка «длина цитаты» без этого не работала бы. К ним подмешиваются
    одобренные пользовательские цитаты из базы — у них id со сдвигом
    DB_QUOTE_ID_OFFSET, чтобы не столкнуться с файловыми.

    Параметр id нужен поиску. Смысл не в удобстве: если бы клиент разбивал
    найденный текст на слова сам, у него получился бы свой алгоритм разбивки,
    а здесь свой — и цитата, выбранная поиском, со временем начала бы
    отличаться от такой же, выпавшей случайно. Разбивка должна быть одна.
    """
    if not language.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимое имя языка")

    payload = _load_quotes(language)
    # Копия, а не ссылка на кешированный список: ниже к нему добавляются
    # цитаты из базы, кеш при этом трогать нельзя.
    quotes: list[dict] = list(payload.get("quotes", [])) + _approved_db_quotes(db, language)
    if not quotes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Для языка '{language}' нет цитат")

    if id is not None:
        found = next((q for q in quotes if q.get("id") == id), None)
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Такой цитаты нет")
        quote = found
    else:
        quotes = _filter_by_length(quotes, payload, length)

        import random

        quote = random.Random().choice(quotes)

    return QuoteOut(
        words=quote["text"].split(),
        language=language,
        source=quote.get("source"),
        length=quote.get("length", 0),
        id=quote.get("id"),
    )


class QuoteMatch(BaseModel):
    """Найденная цитата: показывается списком, полный текст — по выбору."""

    id: int
    text: str
    source: str | None = None
    length: int = 0


@router.get("/quotes/{language}/search", response_model=list[QuoteMatch])
def search_quotes(
    language: str,
    db: DbSession,
    q: str = Query(default="", max_length=100),
    length: str = Query(default="all"),
    limit: int = Query(default=30, ge=1, le=100),
):
    """Поиск цитаты по тексту или источнику.

    Ищем подстроку без учёта регистра — не полнотекстовый поиск: цитат
    в файле тысячи, а не миллионы, и заводить индекс ради этого незачем.

    Пустой запрос отдаёт первые несколько цитат: так окно поиска не выглядит
    сломанным, пока в него ничего не ввели.

    Фильтр length тот же, что у случайной цитаты: short, medium, long, thicc
    или all. Пустая группа не отсекает выдачу совсем — см. _filter_by_length.
    """
    if not language.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимое имя языка")

    payload = _load_quotes(language)
    quotes: list[dict] = list(payload.get("quotes", [])) + _approved_db_quotes(db, language)
    if not quotes:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Для языка '{language}' нет цитат")

    quotes = _filter_by_length(quotes, payload, length)

    needle = q.strip().lower()
    if needle:
        quotes = [
            quote
            for quote in quotes
            if needle in quote.get("text", "").lower()
            or needle in (quote.get("source") or "").lower()
        ]

    return [
        QuoteMatch(
            id=quote.get("id", 0),
            text=quote["text"],
            source=quote.get("source"),
            length=quote.get("length", 0),
        )
        for quote in quotes[:limit]
    ]


# --- Заявки на цитаты и жалобы -------------------------------------------


class QuoteSubmit(BaseModel):
    """Заявка на новую цитату. Проверяет модератор, сразу в игру не идёт."""

    text: str = Field(min_length=10, max_length=600)
    source: str | None = Field(default=None, max_length=255)
    language: str = Field(max_length=30)


class QuoteSubmitOut(BaseModel):
    id: int
    status: str


@router.post("/quotes", response_model=QuoteSubmitOut, status_code=status.HTTP_201_CREATED)
def submit_quote(payload: QuoteSubmit, db: DbSession, user: CurrentUser) -> QuoteSubmitOut:
    """Прислать цитату на модерацию.

    Только для вошедших: у заявки должен быть автор, иначе очередь завалят
    анонимно. Попадает в базу со статусом pending и в выдачу не идёт, пока
    её не одобрят. Язык должен быть заведён в базе — иначе одобренную цитату
    некуда будет привязать и она не попадёт в выдачу.
    """
    lang = db.scalar(select(Language).where(Language.name == payload.language))
    if lang is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный язык")

    quote = Quote(
        language_id=lang.id,
        text=payload.text.strip(),
        source=(payload.source or None),
        status="pending",
        submitted_by=user.id,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return QuoteSubmitOut(id=quote.id, status=quote.status)


class QuoteReportIn(BaseModel):
    """Жалоба на цитату. Язык нужен, чтобы найти файловую цитату по её id."""

    language: str = Field(max_length=30)
    reason: str = Field(min_length=3, max_length=500)


@router.post("/quotes/{served_id}/report", status_code=status.HTTP_201_CREATED)
def report_quote(
    served_id: int, payload: QuoteReportIn, db: DbSession, user: CurrentUser
) -> dict[str, str]:
    """Пожаловаться на цитату — из файла или из базы, всё равно.

    Только для вошедших: одна жалоба на цитату от одного человека, повторная
    не копится (о ней отвечаем тем же «принято», не ошибкой). Текст цитаты
    сохраняем снимком — модератор увидит, на что жалуются, даже если это
    файловая цитата, которой в базе нет.
    """
    if not payload.language.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Недопустимое имя языка")

    # Уже жаловался — повторную не заводим, но и ошибкой не отвечаем
    already = db.scalar(
        select(QuoteReport).where(
            QuoteReport.served_quote_id == served_id, QuoteReport.user_id == user.id
        )
    )
    if already is not None:
        return {"status": "already_reported"}

    text, source = _resolve_quote_text(db, served_id, payload.language)
    if text is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Такой цитаты нет")

    report = QuoteReport(
        served_quote_id=served_id,
        language=payload.language,
        text=text,
        source=source,
        user_id=user.id,
        reason=payload.reason.strip(),
    )
    db.add(report)
    db.commit()
    return {"status": "reported"}


def _resolve_quote_text(db, served_id: int, language: str) -> tuple[str | None, str | None]:
    """Найти текст и источник цитаты по её id — в базе или в файле."""
    if served_id >= DB_QUOTE_ID_OFFSET:
        quote = db.get(Quote, served_id - DB_QUOTE_ID_OFFSET)
        if quote is None:
            return None, None
        return quote.text, quote.source

    payload = _load_quotes(language)
    found = next((q for q in payload.get("quotes", []) if q.get("id") == served_id), None)
    if found is None:
        return None, None
    return found.get("text"), found.get("source")


@lru_cache
def _load_british() -> dict[str, str]:
    """Словарь американских написаний против британских.

    671 пара из monkeytype (GPL-3.0), см. LICENSE-NOTICE.md. Одна запись
    у них зависит от предыдущего слова — её не берём: мы заменяем слова
    по одному и контекста не знаем.
    """
    path = DATA_DIR / "british-english.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _to_british(words: list[str]) -> list[str]:
    replacements = _load_british()
    if not replacements:
        return words

    result: list[str] = []
    for word in words:
        # Знаки препинания и заглавные добавляются позже, но на всякий
        # случай сохраняем регистр первой буквы
        lower = word.lower()
        british = replacements.get(lower)
        if british is None:
            result.append(word)
        elif word[:1].isupper():
            result.append(british.capitalize())
        else:
            result.append(british)

    return result


def _strip_diacritics(words: list[str]) -> list[str]:
    """Убрать надстрочные знаки: é → e, ñ → n. Это и есть lazy mode."""
    return [
        "".join(ch for ch in unicodedata.normalize("NFD", word) if not unicodedata.combining(ch))
        for word in words
    ]


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
    british: bool = False,
    lazy: bool = False,
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

    # Порядок важен: замены и снятие диакритики идут по чистым словам,
    # до того как к ним прилипнут знаки препинания и заглавные
    if british and language.startswith("english"):
        words = _to_british(words)
    if lazy and not payload.get("noLazyMode", False):
        words = _strip_diacritics(words)

    words = text_service.prepare(words, punctuation=punctuation, numbers=numbers)

    return {
        "words": words,
        "language": language,
        "rtl": payload.get("rightToLeft", False),
        "noLazyMode": payload.get("noLazyMode", False),
    }
