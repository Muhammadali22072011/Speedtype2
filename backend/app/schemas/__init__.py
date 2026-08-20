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


# --- Результаты ---

class ResultCreate(BaseModel):
    """Что присылает клиент по окончании теста.

    Сырые счётчики, а не готовые wpm: считать метрики должен сервер,
    иначе их можно прислать любыми.
    """

    correct_chars: int = Field(ge=0, le=100_000)
    incorrect_chars: int = Field(ge=0, le=100_000)
    duration: float = Field(gt=0, le=3600)
    wpm_samples: list[float] = Field(default_factory=list, max_length=3600)

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
    correct_chars: int
    incorrect_chars: int
    mode: str
    mode_value: str
    language: str
    duration: float
    created_at: dt.datetime


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
