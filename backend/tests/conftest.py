"""Общая обвязка тестов: одна база, один движок, один клиент.

Почему это один файл, а не по копии в каждом тесте.

Раньше test_api.py и test_race.py каждый заводил свой движок in-memory и
каждый ставил ``app.dependency_overrides[get_db]``. Приложение одно на весь
прогон, словарь подмен у него один — и побеждала та подмена, чей файл
собрали последним. Запросы одного файла уходили в пустую базу другого,
отсюда «no such table: users». Порознь всё зелено, вместе падает половина,
и выглядит это как поломка кода, хотя код цел.

Здесь взят другой подход, без подмены get_db вовсе. ``DATABASE_URL``
выставляется во временный файл ДО импорта приложения, поэтому собственный
движок приложения (``app.db.session.engine``) сразу смотрит в тестовую базу.
Тогда с одной базой работают все: и запросы через ``get_db``, и стартовый
``lifespan`` — а он теперь не только создаёт таблицы, но и досоздаёт колонки
(``ensure_columns``). Пока движка было два, ``lifespan`` трогал рабочую
speedtype.db на файле; стоило её кому-то держать открытой — и старт падал на
«database is locked», роняя все тесты разом. С единой тестовой базой этого
больше нет.
"""

from __future__ import annotations

import os
import tempfile

# Временный файл именно файл, а не sqlite:// в памяти: движок приложения
# создаётся без StaticPool, а без него каждое соединение к in-memory базе
# получает свою пустую копию. Файл же одинаково виден всем соединениям.
_TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMP.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP.name.replace("\\", "/")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    """Клиент с чистой схемой на каждый тест.

    Схему создаём и роняем вокруг каждого теста, чтобы результаты одного
    не протекали в другой. База одна на прогон, а вот данные — нет.
    """
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


def pytest_sessionfinish(session, exitstatus):
    """Убрать временный файл базы после прогона."""
    try:
        os.unlink(_TMP.name)
    except OSError:
        pass
