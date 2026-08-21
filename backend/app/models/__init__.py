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

    # Заблокирован администратором: вход запрещён, существующий токен
    # перестаёт действовать. Отдельным флагом, а не удалением: удаление
    # необратимо, а бан можно снять.
    blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

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

    # Какой формулой посчитана ровность. 1 — по нарастающему ряду wpm,
    # 2 — по посекундной скорости, как у monkeytype. Цифры двух версий
    # несравнимы между собой, поэтому версия хранится у каждой строки:
    # без неё лидерборд молча смешал бы две шкалы.
    consistency_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    correct_chars: Mapped[int] = mapped_column(Integer, default=0)
    incorrect_chars: Mapped[int] = mapped_column(Integer, default=0)

    # Посекундные ряды wpm и raw одним JSON-документом: {"wpm": [...], "raw": [...]}.
    # Нужны для мини-графика прямо в строке истории — как у monkeytype — и это
    # единственный способ когда-нибудь пересчитать старые результаты на новую
    # формулу ровности. Клиент их и так присылает, раньше сервер считал по ним
    # ровность и выбрасывал. Nullable: у результатов до этой правки рядов нет,
    # и график им честно не рисуется. В общий список не отдаём, чтобы историю
    # на полсотни строк не раздувать — только по отдельному запросу.
    samples: Mapped[str | None] = mapped_column(Text, nullable=True)

    mode: Mapped[str] = mapped_column(String(20), index=True)
    mode_value: Mapped[str] = mapped_column(String(20), default="")
    language: Mapped[str] = mapped_column(String(30), index=True)
    duration: Mapped[float] = mapped_column(Float)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped["User | None"] = relationship(back_populates="results")


class Tag(Base):
    """Метка на результате: «разминка», «код», «левая рука».

    Смысл тот же, что у monkeytype: разложить историю по своим корзинам
    и смотреть рекорд отдельно по каждой.
    """

    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_per_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResultTag(Base):
    """Связь результата с меткой. Отдельная таблица, а не список строк:
    иначе переименование метки пришлось бы разносить по всей истории."""

    __tablename__ = "result_tags"
    __table_args__ = (UniqueConstraint("result_id", "tag_id", name="uq_result_tag"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    result_id: Mapped[int] = mapped_column(ForeignKey("results.id"), index=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), index=True)


class Preset(Base):
    """Сохранённый набор настроек.

    Настройки лежат одним JSON-документом — как и у пользователя: их состав
    меняется каждый раз, когда в config-spec добавляется строка, и заводить
    колонку под каждую было бы бессмысленно.
    """

    __tablename__ = "presets"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_preset_per_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    settings: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


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

    # Модерация. pending — прислана пользователем и ждёт проверки,
    # approved — в выдаче, rejected — отклонена и в выдачу не идёт.
    # Всё, что было в базе до модерации, помечено approved миграцией.
    status: Mapped[str] = mapped_column(String(20), default="approved", server_default="approved", index=True)
    # Кто прислал. NULL у цитат из словарей monkeytype и у гостевых заявок.
    submitted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Причина отклонения — видна приславшему, чтобы отказ не был молчаливым.
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # У сеяных цитат метки времени нет, поэтому nullable.
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class QuoteReport(Base):
    """Жалоба на цитату: опечатка, дубль, неверный источник.

    Ссылки на quotes.id тут намеренно нет. Цитаты живут в двух местах: корпус
    monkeytype раздаётся из файлов, пользовательские заявки лежат в quotes.
    Пожаловаться можно на любую, а FK покрыл бы только вторую. Поэтому храним
    id в том виде, в каком его получил клиент (served_quote_id), плюс снимок
    самого текста — чтобы администратор видел, на что жалуются, даже если это
    цитата из файла, которой в базе нет.

    Отдельной таблицей, а не счётчиком: нужны причина и кто пожаловался.
    Один человек — одна жалоба на цитату, повторная не копится.
    """

    __tablename__ = "quote_reports"
    __table_args__ = (
        UniqueConstraint("served_quote_id", "user_id", name="uq_report_per_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # id цитаты в том виде, в каком её отдали клиенту (файловый или из базы)
    served_quote_id: Mapped[int] = mapped_column(Integer, index=True)
    language: Mapped[str] = mapped_column(String(30))
    # Снимок текста и источника на момент жалобы — чтобы не разрешать заново
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reason: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Разобрана ли жалоба администратором — чтобы очередь не показывала одно и то же.
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


__all__ = [
    "Base",
    "Language",
    "Preset",
    "Quote",
    "QuoteReport",
    "Result",
    "ResultTag",
    "Tag",
    "User",
    "Word",
]
