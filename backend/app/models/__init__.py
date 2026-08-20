"""Модели базы. Импортируются здесь, чтобы Base.metadata знал обо всех таблицах."""

from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:  # pragma: no cover
    pass


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")
    avatar: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Настройки клиента лежат одним JSON-документом: их состав меняется часто,
    # и заводить колонку под каждый флажок не стоит.
    settings: Mapped[dict] = mapped_column(Text, default="{}")

    results: Mapped[list["Result"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Result(Base):
    __tablename__ = "results"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    wpm: Mapped[float] = mapped_column(Float)
    raw: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float] = mapped_column(Float)
    consistency: Mapped[float] = mapped_column(Float)

    correct_chars: Mapped[int] = mapped_column(Integer, default=0)
    incorrect_chars: Mapped[int] = mapped_column(Integer, default=0)

    mode: Mapped[str] = mapped_column(String(20), index=True)
    mode_value: Mapped[str] = mapped_column(String(20), default="")
    language: Mapped[str] = mapped_column(String(30), index=True)
    duration: Mapped[float] = mapped_column(Float)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped["User | None"] = relationship(back_populates="results")


class Language(Base):
    __tablename__ = "languages"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    rtl: Mapped[bool] = mapped_column(Boolean, default=False)


class Word(Base):
    __tablename__ = "words"
    __table_args__ = (UniqueConstraint("language_id", "word", name="uq_word_per_language"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    language_id: Mapped[int] = mapped_column(ForeignKey("languages.id"), index=True)
    word: Mapped[str] = mapped_column(String(100))


class Quote(Base):
    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    language_id: Mapped[int | None] = mapped_column(ForeignKey("languages.id"), nullable=True, index=True)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)


__all__ = ["User", "Result", "Language", "Word", "Quote", "Base"]
