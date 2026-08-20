"""Гонки: HTTP для создания комнаты и WebSocket для самой гонки.

Здесь живёт всё, что умеет говорить по сети. Правила комнаты и счёт —
в services/rooms.py, и они специально не знают ни про сокеты, ни про
FastAPI: так их можно проверить тестом без поднятого сервера.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession
from app.db.session import SessionLocal
from app.models import Language, Word
from app.services import text as text_service
from app.services.rooms import (
    COUNTDOWN_SECONDS,
    MAX_PLAYERS,
    STRAGGLER_SECONDS,
    Player,
    Room,
    registry,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/race", tags=["race"])

#: Сколько ждём сообщения от игрока, прежде чем проверить, жив ли он.
#: Без такой проверки оборванное соединение висело в комнате до первой
#: неудачной отправки — и всё это время блокировало и старт, и финиш:
#: комната ждала «готов» и «финишировал» от того, кого уже нет.
IDLE_SECONDS = 30


class CreateRoomRequest(BaseModel):
    language: str = Field(default="english", max_length=30)
    word_count: int = Field(default=25, ge=10, le=100)
    punctuation: bool = False
    numbers: bool = False


class RoomInfo(BaseModel):
    code: str
    state: str
    players: int


# --- живые гонки ---------------------------------------------------------


class RaceSession:
    """Комната плюс всё, что нельзя положить в dataclass.

    Сокеты и фоновые задачи держим здесь, а не на самой Room: у комнаты
    задача быть обычными данными. Раньше задача отсчёта лежала прямо
    в модели приватным полем и дёргалась снаружи через room._countdown_task.
    """

    def __init__(self, room: Room) -> None:
        self.room = room
        self.sockets: dict[str, WebSocket] = {}
        self._countdown: asyncio.Task[None] | None = None
        self._deadline: asyncio.Task[None] | None = None
        # Замок на старт: два «готов», пришедшие в один момент, раньше
        # порождали два отсчёта и два старта
        self._lock = asyncio.Lock()

    # --- рассылка ---

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Отправить всем, отсеивая оборванные сокеты."""
        dead: list[str] = []

        for player_id, socket in list(self.sockets.items()):
            try:
                await socket.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                dead.append(player_id)
            except Exception:
                # Неожиданное — записываем. Раньше здесь стоял голый except,
                # и любая ошибка отправки выглядела как обрыв связи
                log.exception("Не удалось отправить сообщение игроку %s", player_id)
                dead.append(player_id)

        for player_id in dead:
            self.sockets.pop(player_id, None)

    async def send_room(self) -> None:
        await self.broadcast({"type": "room", "room": self.room.public()})

    # --- ход гонки ---

    async def maybe_start(self) -> None:
        async with self._lock:
            if self.room.state != "waiting" or not self.room.everyone_ready:
                return
            if self._countdown is not None and not self._countdown.done():
                return
            self._countdown = asyncio.create_task(self._run_countdown())

    async def _run_countdown(self) -> None:
        try:
            self.room.state = "countdown"
            self.room.reset_progress()
            # Текст готовим в отдельном потоке: работа с базой синхронная,
            # и раньше она вставала прямо посреди цикла событий
            self.room.words = await asyncio.to_thread(build_words, self.room)
            await self.send_room()

            for remaining in range(COUNTDOWN_SECONDS, 0, -1):
                await self.broadcast({"type": "countdown", "value": remaining})
                await asyncio.sleep(1)

            self.room.state = "racing"
            self.room.started_at = time.time()
            await self.broadcast({"type": "start", "startedAt": self.room.started_at})
            await self.send_room()
        except asyncio.CancelledError:
            # Отсчёт прервали — например, кто-то вышел и стало меньше двух
            self.room.state = "waiting"
            await self.send_room()
            raise

    def start_deadline(self) -> None:
        """Дать отставшим срок после финиша первого.

        Раньше гонка заканчивалась только когда финишировали все, и один
        человек, отошедший от компьютера, держал комнату без результата
        сколько угодно долго.
        """
        if self._deadline is not None and not self._deadline.done():
            return
        self._deadline = asyncio.create_task(self._await_stragglers())

    async def _await_stragglers(self) -> None:
        try:
            await asyncio.sleep(STRAGGLER_SECONDS)
            if self.room.state == "racing":
                await self.finish()
        except asyncio.CancelledError:
            raise

    async def finish(self) -> None:
        self.room.state = "finished"
        if self._deadline is not None:
            self._deadline.cancel()
        await self.broadcast({"type": "finish"})
        await self.send_room()

    def cancel_tasks(self) -> None:
        for task in (self._countdown, self._deadline):
            if task is not None and not task.done():
                task.cancel()


#: Живые гонки по коду комнаты.
sessions: dict[str, RaceSession] = {}


def session_for(room: Room) -> RaceSession:
    session = sessions.get(room.code)
    if session is None:
        session = RaceSession(room)
        sessions[room.code] = session
    return session


# --- HTTP ----------------------------------------------------------------


@router.post("", response_model=RoomInfo, status_code=status.HTTP_201_CREATED)
async def create_room(payload: CreateRoomRequest, db: DbSession) -> RoomInfo:
    lang = db.scalar(select(Language).where(Language.name == payload.language))
    if lang is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Язык '{payload.language}' не найден")

    room = await registry.create(
        language=payload.language,
        word_count=payload.word_count,
        punctuation=payload.punctuation,
        numbers=payload.numbers,
    )
    return RoomInfo(code=room.code, state=room.state, players=0)


@router.get("/{code}", response_model=RoomInfo)
async def room_info(code: str) -> RoomInfo:
    room = registry.get(code)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Комната не найдена")
    return RoomInfo(code=room.code, state=room.state, players=len(room.players))


# --- текст гонки ---------------------------------------------------------

#: Словарь языка меняется только при переливке базы, а весит он тысячи
#: строк. Раньше он вычитывался целиком на каждый старт каждой комнаты.
_pool_cache: dict[str, list[str]] = {}


def build_words(room: Room) -> list[str]:
    """Текст готовим один раз на комнату — у всех участников он одинаковый.

    Функция синхронная и работает с базой, поэтому звать её можно только
    через asyncio.to_thread: иначе она встаёт посреди цикла событий и
    подвешивает все остальные гонки на время чтения словаря.
    """
    pool = _pool_cache.get(room.language)

    if pool is None:
        with SessionLocal() as db:
            lang = db.scalar(select(Language).where(Language.name == room.language))
            if lang is None:
                return []
            pool = list(db.scalars(select(Word.word).where(Word.language_id == lang.id)))
        _pool_cache[room.language] = pool

    if not pool:
        return []

    rng = random.Random(room.seed)
    words = [rng.choice(pool) for _ in range(room.word_count)]
    return text_service.prepare(
        words, punctuation=room.punctuation, numbers=room.numbers, seed=room.seed
    )


# --- WebSocket -----------------------------------------------------------


@router.websocket("/{code}/ws")
async def race_socket(websocket: WebSocket, code: str, name: str = "гость") -> None:
    room = registry.get(code)
    if room is None:
        await websocket.close(code=4404, reason="Комната не найдена")
        return

    if len(room.players) >= MAX_PLAYERS:
        await websocket.close(code=4403, reason="Комната заполнена")
        return

    if room.state in ("racing", "countdown"):
        await websocket.close(code=4409, reason="Гонка уже идёт")
        return

    await websocket.accept()

    session = session_for(room)
    player_id = uuid.uuid4().hex[:8]
    player = Player(
        id=player_id,
        name=name[:20] or "гость",
        is_host=len(room.players) == 0,
    )
    room.players[player_id] = player
    session.sockets[player_id] = websocket

    await websocket.send_json({"type": "joined", "playerId": player_id, "room": room.public()})
    await session.send_room()

    try:
        while True:
            try:
                message = await asyncio.wait_for(
                    websocket.receive_json(), timeout=IDLE_SECONDS
                )
            except asyncio.TimeoutError:
                # Молчит — проверяем, жив ли сокет вообще. Если отправка
                # не проходит, соединение оборвано и цикл заканчивается
                await websocket.send_json({"type": "ping"})
                continue

            await handle_message(session, player, message)
    except WebSocketDisconnect:
        pass
    except (ValueError, TypeError, KeyError):
        # Битое сообщение. Раньше здесь стоял голый except: игрок молча
        # исчезал из комнаты, и понять почему было нельзя
        log.warning("Битое сообщение от игрока %s в комнате %s", player_id, room.code)
    except Exception:
        log.exception("Гонка %s: соединение игрока %s оборвано ошибкой", room.code, player_id)
    finally:
        await leave(session, player)


async def leave(session: RaceSession, player: Player) -> None:
    room = session.room
    room.players.pop(player.id, None)
    session.sockets.pop(player.id, None)

    # Хост ушёл — передаём роль первому оставшемуся
    if player.is_host and room.players:
        next(iter(room.players.values())).is_host = True

    # Отсчёт больше некому дожидаться
    if room.state == "countdown" and len(room.players) < 2:
        session.cancel_tasks()

    # Ушедший был последним, кого ждали
    if room.state == "racing" and room.everyone_finished:
        await session.finish()

    if room.players:
        await session.send_room()
    else:
        session.cancel_tasks()
        sessions.pop(room.code, None)
        await registry.drop(room.code)


def _clamp_accuracy(value: Any) -> float:
    try:
        return max(0.0, min(100.0, float(value)))
    except (TypeError, ValueError):
        return 100.0


async def handle_message(session: RaceSession, player: Player, message: dict[str, Any]) -> None:
    room = session.room
    kind = message.get("type")
    now = time.time()

    if kind == "pong":
        return

    if kind == "ready":
        player.ready = bool(message.get("value", True))
        await session.send_room()
        await session.maybe_start()

    elif kind == "progress" and room.state == "racing":
        # Клиент присылает только число набранных символов. Скорость
        # считает сервер по своим часам, прогресс — по длине текста.
        # Раньше wpm, точность и прогресс приходили из браузера и
        # рассылались как истина.
        chars = _chars_from(message, room)
        player.accuracy = _clamp_accuracy(message.get("accuracy", player.accuracy))

        if player.accept_chars(chars, now, room.started_at):
            await session.broadcast(
                {
                    "type": "progress",
                    "playerId": player.id,
                    **player.public(room.started_at, now, room.total_chars),
                }
            )

    elif kind == "done" and room.state == "racing":
        if player.finished_at is None:
            chars = _chars_from(message, room)
            # На финише засчитываем весь текст: до сюда доходят только те,
            # кто действительно добрал последнее слово
            player.chars = max(player.chars, min(chars, room.total_chars))
            player.accuracy = _clamp_accuracy(message.get("accuracy", player.accuracy))
            player.finished_at = now

            room.finish_order.append(player.id)
            player.place = len(room.finish_order)

            await session.send_room()

            if room.everyone_finished:
                await session.finish()
            else:
                # Первый финишировал — включаем срок для отставших
                session.start_deadline()

    elif kind == "settings" and player.is_host and room.state == "waiting":
        room.language = str(message.get("language", room.language))[:30]
        try:
            room.word_count = max(10, min(100, int(message.get("wordCount", room.word_count))))
        except (TypeError, ValueError):
            pass
        room.punctuation = bool(message.get("punctuation", room.punctuation))
        room.numbers = bool(message.get("numbers", room.numbers))
        await session.send_room()


def _chars_from(message: dict[str, Any], room: Room) -> int:
    """Сколько символов набрано, по сообщению клиента.

    Основное поле — chars. Старые клиенты присылают долю progress:
    пересчитываем её в символы, чтобы они не сломались на выкатке.
    Доверия к обоим одинаково мало, поэтому прирост в любом случае
    проходит проверку потолка в Player.accept_chars.
    """
    if "chars" in message:
        try:
            return max(0, int(message["chars"]))
        except (TypeError, ValueError):
            return 0

    try:
        progress = max(0.0, min(1.0, float(message.get("progress", 0))))
    except (TypeError, ValueError):
        return 0
    return int(progress * room.total_chars)
