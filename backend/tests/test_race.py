"""Проверка гонок: правила комнаты, счёт на стороне сервера, живое соединение.

До этого файла у гонок не было ни одного теста. Основная часть проверок
здесь работает с Room и Player напрямую, без поднятого сервера и без
сокетов — ради этого правила гонки и вынесены в services/rooms.py.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import Base, SessionLocal, engine
from app.main import app
from app.models import Language, Word
from app.services.rooms import (
    EMPTY_ROOM_TTL,
    Player,
    Room,
    RoomRegistry,
)


@pytest.fixture()
def client():
    """Клиент с заведённым английским языком — гонке нужны слова.

    Движок и база — общие, из conftest.py; здесь только своя фикстура,
    потому что гонке, в отличие от остальных тестов, нужен непустой язык
    со словами. Одноимённая фикстура из conftest при этом перекрывается
    ровно для этого файла — так и задумано.
    """
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        lang = Language(name="english", display_name="english")
        db.add(lang)
        db.flush()
        db.add_all([Word(language_id=lang.id, word=w) for w in ("one", "two", "three")])
        db.commit()

    with TestClient(app) as c:
        yield c

    Base.metadata.drop_all(bind=engine)


# --- счёт символов -------------------------------------------------------


def test_прирост_в_пределах_потолка_засчитывается():
    player = Player(id="a", name="a")
    assert player.accept_chars(20, now=1001.0, started_at=1000.0) is True
    assert player.chars == 20


def test_невозможный_рывок_не_засчитывается():
    """Главная дыра гонок: клиент присылал любое число и ему верили."""
    player = Player(id="a", name="a")
    player.accept_chars(20, now=1001.0, started_at=1000.0)

    # Тысяча символов за одну секунду — за пределами любого разумного порога
    assert player.accept_chars(1020, now=1002.0, started_at=1000.0) is False
    assert player.chars == 20, "счётчик обязан остаться прежним"


def test_после_паузы_принимается_накопленное():
    """Лаг сети не должен выглядеть как накрутка."""
    player = Player(id="a", name="a")
    player.accept_chars(20, now=1001.0, started_at=1000.0)

    # Молчали пять секунд — за них честно можно набрать 125 символов
    assert player.accept_chars(20 + 125, now=1006.0, started_at=1000.0) is True


def test_счётчик_не_идёт_назад():
    player = Player(id="a", name="a")
    player.accept_chars(50, now=1002.0, started_at=1000.0)
    assert player.accept_chars(10, now=1003.0, started_at=1000.0) is False
    assert player.chars == 50


def test_до_старта_прирост_не_принимается():
    player = Player(id="a", name="a")
    assert player.accept_chars(10, now=1000.0, started_at=None) is False


# --- скорость ------------------------------------------------------------


def test_скорость_считается_от_времени_сервера():
    player = Player(id="a", name="a", chars=100)
    # 100 символов за ровно минуту — это 20 wpm по определению
    assert player.wpm(started_at=1000.0, now=1060.0) == pytest.approx(20.0)


def test_скорость_финишировавшего_не_растёт_дальше():
    player = Player(id="a", name="a", chars=100, finished_at=1060.0)
    сразу = player.wpm(started_at=1000.0, now=1060.0)
    много_позже = player.wpm(started_at=1000.0, now=9999.0)
    assert сразу == много_позже


def test_до_старта_скорость_ноль():
    player = Player(id="a", name="a", chars=100)
    assert player.wpm(started_at=None, now=1060.0) == 0.0


# --- комната -------------------------------------------------------------


def test_длина_текста_считает_пробелы():
    room = Room(code="AAAAA", words=["ab", "cd"])
    assert room.total_chars == 5  # 2 + 2 и один пробел между


def test_прогресс_доля_от_текста():
    room = Room(code="AAAAA", words=["abcde"], started_at=1000.0)
    room.players["a"] = Player(id="a", name="a", chars=2)
    данные = room.public(now=1001.0)
    assert данные["players"][0]["progress"] == pytest.approx(0.4)


def test_старт_требует_двоих():
    room = Room(code="AAAAA")
    room.players["a"] = Player(id="a", name="a", ready=True)
    assert room.everyone_ready is False, "в одиночку гонка не начинается"

    room.players["b"] = Player(id="b", name="b", ready=True)
    assert room.everyone_ready is True


def test_один_неготовый_держит_старт():
    room = Room(code="AAAAA")
    room.players["a"] = Player(id="a", name="a", ready=True)
    room.players["b"] = Player(id="b", name="b", ready=False)
    assert room.everyone_ready is False


def test_сброс_прогресса_оставляет_состав():
    room = Room(code="AAAAA", started_at=1000.0)
    room.players["a"] = Player(id="a", name="a", chars=50, finished_at=1010.0, place=1)
    room.finish_order.append("a")

    room.reset_progress()

    assert list(room.players) == ["a"], "игроки остаются в комнате"
    assert room.players["a"].chars == 0
    assert room.players["a"].finished_at is None
    assert room.players["a"].place is None
    assert room.finish_order == []
    assert room.started_at is None


def test_пустая_комната_стареет():
    свежая = Room(code="AAAAA")
    assert свежая.is_abandoned is False

    старая = Room(code="BBBBB")
    старая.created_at -= EMPTY_ROOM_TTL + 1
    assert старая.is_abandoned is True


def test_занятая_комната_не_стареет():
    room = Room(code="AAAAA")
    room.created_at -= EMPTY_ROOM_TTL + 1
    room.players["a"] = Player(id="a", name="a")
    assert room.is_abandoned is False, "комнату с людьми убирать нельзя"


# --- хранилище -----------------------------------------------------------


# Плагина pytest-asyncio в проекте нет, а тащить зависимость ради трёх
# тестов незачем: реестр не ждёт ничего внешнего, и asyncio.run его
# гоняет ровно так же.


def test_создание_и_поиск_комнаты():
    async def сценарий():
        registry = RoomRegistry()
        room = await registry.create(language="english")
        assert registry.get(room.code) is room
        assert registry.get(room.code.lower()) is room, "код ищется без учёта регистра"

    asyncio.run(сценарий())


def test_уборка_брошенных_комнат():
    async def сценарий():
        registry = RoomRegistry()
        брошенная = await registry.create(language="english")
        брошенная.created_at -= EMPTY_ROOM_TTL + 1

        живая = await registry.create(language="english")

        assert registry.get(брошенная.code) is None, "брошенную убрали при создании новой"
        assert registry.get(живая.code) is not None

    asyncio.run(сценарий())


def test_комната_с_людьми_не_удаляется():
    async def сценарий():
        registry = RoomRegistry()
        room = await registry.create(language="english")
        room.players["a"] = Player(id="a", name="a")

        await registry.drop(room.code)
        assert registry.get(room.code) is not None

    asyncio.run(сценарий())


# --- HTTP ----------------------------------------------------------------


def test_комната_создаётся(client):
    ответ = client.post("/api/race", json={"language": "english", "word_count": 10})
    assert ответ.status_code == 201
    тело = ответ.json()
    assert len(тело["code"]) == 5
    assert тело["state"] == "waiting"
    assert тело["players"] == 0


def test_неизвестный_язык_отклоняется(client):
    ответ = client.post("/api/race", json={"language": "клингонский"})
    assert ответ.status_code == 404


def test_несуществующая_комната(client):
    assert client.get("/api/race/ZZZZZ").status_code == 404


def test_слишком_много_слов_отклоняется(client):
    assert client.post("/api/race", json={"word_count": 5}).status_code == 422
    assert client.post("/api/race", json={"word_count": 500}).status_code == 422


# --- живое соединение ----------------------------------------------------


def test_вход_в_комнату_по_сокету(client):
    код = client.post("/api/race", json={"language": "english", "word_count": 10}).json()["code"]

    with client.websocket_connect(f"/api/race/{код}/ws?name=аня") as socket:
        первое = socket.receive_json()
        assert первое["type"] == "joined"
        assert первое["room"]["code"] == код
        assert первое["room"]["players"][0]["name"] == "аня"
        assert первое["room"]["players"][0]["isHost"] is True, "первый вошедший — хозяин"


def test_вход_в_несуществующую_комнату(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/api/race/ZZZZZ/ws") as socket:
            socket.receive_json()


def test_текст_не_отдаётся_до_старта(client):
    код = client.post("/api/race", json={"language": "english", "word_count": 10}).json()["code"]

    with client.websocket_connect(f"/api/race/{код}/ws") as socket:
        комната = socket.receive_json()["room"]
        assert комната["words"] == [], "пока гонка не началась, текст видеть рано"
