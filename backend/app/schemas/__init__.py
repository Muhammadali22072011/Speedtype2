"""Схемы запросов и ответов. Валидация целиком на Pydantic."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["time", "words", "quote", "custom"]


# --- Аутентификация ---

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str | None
    role: str
    avatar: str | None
    created_at: dt.datetime
    #: Администратор ли — считается по ADMIN_USERNAMES, в модели User такого
    #: поля нет. Проставляется в ручках «про себя» (/me); в остальных местах
    #: остаётся False, там оно и не нужно.
    is_admin: bool = False


# --- Результаты ---

class ResultCreate(BaseModel):
    """Что присылает клиент по окончании теста.

    Сырые счётчики, а не готовые wpm: считать метрики должен сервер,
    иначе их можно прислать любыми.
    """

    correct_chars: int = Field(ge=0, le=100_000)
    incorrect_chars: int = Field(ge=0, le=100_000)
    duration: float = Field(gt=0, le=3600)
    #: Нарастающий wpm по секундам. Из него считается ровность старой формулой.
    wpm_samples: list[float] = Field(default_factory=list, max_length=3600)
    #: Скорость ЗА каждую секунду. Если прислан — ровность считается как
    #: у monkeytype, и результат помечается версией формулы 2.
    raw_samples: list[float] = Field(default_factory=list, max_length=3600)

    mode: Mode
    mode_value: str = Field(default="", max_length=20)
    language: str = Field(max_length=30)


class ResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wpm: float
    raw: float
    accuracy: float
    consistency: float
    #: Какой формулой посчитана ровность: 1 — по нарастающему ряду,
    #: 2 — по посекундному, как у monkeytype. Цифры двух версий несравнимы,
    #: поэтому версия едет вместе с числом, а не подразумевается.
    consistency_version: int = 1
    correct_chars: int
    incorrect_chars: int
    mode: str
    mode_value: str
    language: str
    duration: float
    created_at: dt.datetime

    #: Метки результата. Поле необязательное и заполняется только там,
    #: где оно нужно, — в списке истории. Без него таблица на странице
    #: аккаунта собирала бы по запросу на каждую строку.
    tags: list["TagOut"] = Field(default_factory=list)


class ResultSamples(BaseModel):
    """Посекундные ряды одного результата для мини-графика.

    wpm — нарастающая скорость, raw — скорость за каждую секунду. У старых
    результатов рядов нет, тогда оба списка пусты.
    """

    wpm: list[float]
    raw: list[float]


class UserStats(BaseModel):
    tests: int
    avg_wpm: float
    best_wpm: float
    avg_accuracy: float
    time_typing: float
    # Сегодняшний день считаем на сервере: клиент иначе тянул бы всю
    # историю ради двух чисел на экране результата
    tests_today: int
    time_today: float


# --- Лидерборд ---

class PersonalRecord(BaseModel):
    """Лучший результат в одном режиме: время 60, слова 25 и так далее."""

    mode: str
    mode_value: str
    wpm: float
    raw: float
    accuracy: float
    consistency: float
    language: str
    created_at: dt.datetime


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ResultTagsUpdate(BaseModel):
    """Полный набор тегов результата: интерфейс отмечает галочками весь
    список сразу и присылает его целиком, а не разницу."""

    tag_ids: list[int] = Field(default_factory=list, max_length=50)


class PresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    # Состав настроек меняется с каждой строкой в config-spec, поэтому
    # схему тут не фиксируем — храним как есть
    settings: dict = Field(default_factory=dict)


class PresetOut(BaseModel):
    id: int
    name: str
    settings: dict
    created_at: dt.datetime


class ProfileUpdate(BaseModel):
    """Смена имени или почты. Пустые поля значат «не менять»."""

    username: str | None = Field(default=None, min_length=3, max_length=50)
    # Тип тот же, что при регистрации: email-validator в зависимостях нет,
    # и вводить его ради одного поля незачем
    email: str | None = Field(default=None, min_length=5, max_length=255)
    # Пароль спрашиваем всегда: смена почты — это половина угона аккаунта
    current_password: str = Field(min_length=1)


class PasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)


class AccountDelete(BaseModel):
    """Удаление аккаунта. Пароль обязателен, отменить нельзя."""

    current_password: str = Field(min_length=1)


class ProgressOut(BaseModel):
    """Уровень, опыт и серия дней — то, что monkeytype показывает в шапке."""

    xp: int
    level: int
    xp_in_level: int
    xp_for_level: int
    #: Доля пройденного внутри уровня, 0..1 — из неё рисуется полоса
    progress: float

    streak: int
    longest_streak: int

    #: Оценка набранных слов за всё время: символы, делённые на пять
    words_typed: int


class ActivityDay(BaseModel):
    """Один день тепловой карты активности.

    Дни без тестов сюда не попадают — сетку из пустых клеток рисует клиент.
    """

    date: str
    tests: int
    time: float
    best_wpm: float


class HistogramBucket(BaseModel):
    """Столбик распределения: сколько тестов попало в диапазон скорости."""

    wpm: int
    tests: int


class LeaderboardRow(BaseModel):
    rank: int
    username: str
    avatar: str | None
    wpm: float
    raw: float
    accuracy: float
    consistency: float
    mode: str
    mode_value: str
    language: str
    created_at: dt.datetime


class LeaderboardSelf(BaseModel):
    """Своё место в таблице: строка и её номер, либо оба None."""

    rank: int | None
    row: LeaderboardRow | None


# --- Языки и текст ---

class LanguageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    display_name: str
    rtl: bool


class TextResponse(BaseModel):
    words: list[str]
    language: str
    source: str | None = None
