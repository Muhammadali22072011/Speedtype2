"""Гонки: HTTP для создания комнаты и WebSocket для самой гонки."""

from __future__ import annotations

import asyncio
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
from app.services.rooms import COUNTDOWN_SECONDS, MAX_PLAYERS, Player, Room, registry

router = APIRouter(prefix="/race", tags=["race"])

# Живые соединения по комнатам. Отдельно от Room, чтобы модель комнаты
# оставалась обычными данными и её можно было сериализовать.
connections: dict[str, dict[str, WebSocket]] = {}


class CreateRoomRequest(BaseModel):
    language: str = Field(default="english", max_length=30)
    word_count: int = Field(default=25, ge=10, le=100)
    punctuation: bool = False
    numbers: bool = False


class RoomInfo(BaseModel):
    code: str
    state: str
    players: int


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


# --- рассылка ---


async def broadcast(code: str, message: dict[str, Any]) -> None:
    """Отправить сообщение всем в комнате, отсеивая оборванные сокеты."""
    sockets = connections.get(code, {})
    dead: list[str] = []

    for player_id, socket in list(sockets.items()):
        try:
            await socket.send_json(message)
        except Exception:
            dead.append(player_id)

    for player_id in dead:
        sockets.pop(player_id, None)


async def send_room(room: Room) -> None:
    await broadcast(room.code, {"type": "room", "room": room.public()})


# --- текст гонки ---


def build_words(room: Room) -> list[str]:
    """Текст готовим один раз на комнату — у всех участников он одинаковый."""
    with SessionLocal() as db:
        lang = db.scalar(select(Language).where(Language.name == room.language))
        if lang is None:
            return []
        pool = list(db.scalars(select(Word.word).where(Word.language_id == lang.id)))

    if not pool:
        return []

    rng = random.Random(room.seed)
    words = [rng.choice(pool) for _ in range(room.word_count)]
    return text_service.prepare(
        words, punctuation=room.punctuation, numbers=room.numbers, seed=room.seed
    )


async def run_countdown(room: Room) -> None:
    """Обратный отсчёт, затем старт."""
    try:
        room.state = "countdown"
        room.words = build_words(room)
        await send_room(room)

        for remaining in range(COUNTDOWN_SECONDS, 0, -1):
            await broadcast(room.code, {"type": "countdown", "value": remaining})
            await asyncio.sleep(1)

        room.state = "racing"
        await broadcast(room.code, {"type": "start", "startedAt": time.time()})
        await send_room(room)
    except asyncio.CancelledError:
        # Отсчёт прервали — например, кто-то вышел и стало меньше двух игроков
        room.state = "waiting"
        await send_room(room)
        raise


async def maybe_start(room: Room) -> None:
    if room.state != "waiting" or not room.everyone_ready:
        return
    room._countdown_task = asyncio.create_task(run_countdown(room))


async def finish_race(room: Room) -> None:
    room.state = "finished"
    await broadcast(room.code, {"type": "finish"})
    await send_room(room)


# --- WebSocket ---


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

    player_id = uuid.uuid4().hex[:8]
    player = Player(
        id=player_id,
        name=name[:20] or "гость",
        is_host=len(room.players) == 0,
    )
    room.players[player_id] = player
    connections.setdefault(room.code, {})[player_id] = websocket

    await websocket.send_json({"type": "joined", "playerId": player_id, "room": room.public()})
    await send_room(room)

    try:
        while True:
            message = await websocket.receive_json()
            await handle_message(room, player, message)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.players.pop(player_id, None)
        connections.get(room.code, {}).pop(player_id, None)

        # Хост ушёл — передаём роль первому оставшемуся
        if player.is_host and room.players:
            next(iter(room.players.values())).is_host = True

        # Отсчёт больше некому дожидаться
        if room.state == "countdown" and len(room.players) < 2 and room._countdown_task:
            room._countdown_task.cancel()

        if room.players:
            await send_room(room)
        await registry.drop_if_empty(room.code)


async def handle_message(room: Room, player: Player, message: dict[str, Any]) -> None:
    kind = message.get("type")

    if kind == "ready":
        player.ready = bool(message.get("value", True))
        await send_room(room)
        await maybe_start(room)

    elif kind == "progress" and room.state == "racing":
        player.progress = max(0.0, min(1.0, float(message.get("progress", 0))))
        player.wpm = max(0.0, float(message.get("wpm", 0)))
        player.accuracy = max(0.0, min(100.0, float(message.get("accuracy", 100))))
        await broadcast(
            room.code,
            {"type": "progress", "playerId": player.id, **player.public()},
        )

    elif kind == "done" and room.state == "racing":
        if player.finished_at is None:
            player.finished_at = time.time()
            player.progress = 1.0
            player.wpm = max(0.0, float(message.get("wpm", 0)))
            player.accuracy = max(0.0, min(100.0, float(message.get("accuracy", 100))))

            room.finish_order.append(player.id)
            player.place = len(room.finish_order)

            await send_room(room)
            if room.everyone_finished:
                await finish_race(room)

    elif kind == "settings" and player.is_host and room.state == "waiting":
        room.language = str(message.get("language", room.language))[:30]
        room.word_count = max(10, min(100, int(message.get("wordCount", room.word_count))))
        room.punctuation = bool(message.get("punctuation", room.punctuation))
        room.numbers = bool(message.get("numbers", room.numbers))
        await send_room(room)
