"""Подключение к базе и зависимость для роутов."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """Общий базовый класс для всех моделей."""


# check_same_thread нужен только SQLite: FastAPI ходит в базу из разных потоков
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    """Отдаёт сессию на время запроса и закрывает её после."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


#: Колонки, добавленные к уже существующим таблицам.
#: Таблица → имя колонки → объявление для ALTER TABLE.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "results": {
        "consistency_version": "INTEGER NOT NULL DEFAULT 1",
        # Посекундные ряды для мини-графика. У старых результатов их нет —
        # колонка nullable без значения по умолчанию, NULL значит «нет графика».
        "samples": "TEXT",
    },
    "users": {
        # Блокировка администратором. Старые пользователи не заблокированы.
        "blocked": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "quotes": {
        # Модерация цитат. Всё, что уже лежало в базе, считаем одобренным —
        # иначе цитаты пропали бы из выдачи разом.
        "status": "VARCHAR(20) NOT NULL DEFAULT 'approved'",
        "submitted_by": "INTEGER",
        "rejection_reason": "TEXT",
        "created_at": "DATETIME",
    },
}


def ensure_columns() -> None:
    """Дописать колонки, появившиеся после создания базы.

    ``Base.metadata.create_all`` создаёт только отсутствующие ТАБЛИЦЫ и
    ничего не делает с существующими. Новая колонка в уже созданной базе
    без этого не появится, и запрос упадёт на «no such column» —
    у разработчика с рабочей базой, а не в тестах, где база каждый раз новая.
    Именно поэтому такое ломается не сразу и не у всех.

    Alembic в проекте нет и ради одной колонки его заводить не стоит.
    Здесь ровно то, что нужно: список добавленных колонок и проверка,
    есть ли они уже. Операция идемпотентна — вызывается при каждом старте.

    Значение по умолчанию 1 не случайно: всё, что лежало в базе до этой
    правки, посчитано старой формулой ровности, и пометить это надо честно.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as connection:
        for table, columns in _ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue

            present = {column["name"] for column in inspector.get_columns(table)}
            for name, declaration in columns.items():
                if name in present:
                    continue
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}"))
