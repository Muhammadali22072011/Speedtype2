"""Комнаты для гонок.

Состояние держим в памяти процесса: гонка живёт минуты и переживать
перезапуск ей незачем. Для нескольких воркеров сюда понадобится Redis,
но пока сервер один.
"""

from __future__ import annotations

import asyncio
import random
import string
from dataclasses import dataclass, field
from typing import Any, Literal

RoomState = Literal["waiting", "countdown", "racing", "finished"]

COUNTDOWN_SECONDS = 5
MAX_PLAYERS = 8


@dataclass
class Player:
    id: str
    name: str
    is_host: bool = False
    ready: bool = False

    progress: float = 0.0
    wpm: float = 0.0
    accuracy: float = 100.0
    finished_at: float | None = None
    place: int | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "isHost": self.is_host,
            "ready": self.ready,
            "progress": round(self.progress, 4),
            "wpm": round(self.wpm, 1),
            "accuracy": round(self.accuracy, 1),
            "place": self.place,
            "finished": self.finished_at is not None,
        }


@dataclass
class Room:
    code: str
    language: str = "english"
    word_count: int = 25
    punctuation: bool = False
    numbers: bool = False

    state: RoomState = "waiting"
    words: list[str] = field(default_factory=list)
    seed: int = 0

    players: dict[str, Player] = field(default_factory=dict)
    finish_order: list[str] = field(default_factory=list)

    _countdown_task: asyncio.Task[None] | None = None

    def public(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "state": self.state,
            "language": self.language,
            "wordCount": self.word_count,
            "punctuation": self.punctuation,
            "numbers": self.numbers,
            "words": self.words if self.state in ("countdown", "racing", "finished") else [],
            "players": [p.public() for p in self.players.values()],
        }

    @property
    def everyone_ready(self) -> bool:
        return len(self.players) >= 2 and all(p.ready for p in self.players.values())

    @property
    def everyone_finished(self) -> bool:
        return bool(self.players) and all(p.finished_at is not None for p in self.players.values())


class RoomRegistry:
    """Хранилище комнат и подписчиков на них."""

    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _make_code() -> str:
        # Без похожих символов: 0/O и 1/I путают при диктовке кода вслух
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return "".join(random.choices(alphabet, k=5))

    async def create(self, **kwargs: Any) -> Room:
        async with self._lock:
            code = self._make_code()
            while code in self._rooms:
                code = self._make_code()

            room = Room(code=code, seed=random.randrange(1_000_000), **kwargs)
            self._rooms[code] = room
            return room

    def get(self, code: str) -> Room | None:
        return self._rooms.get(code.upper())

    async def drop_if_empty(self, code: str) -> None:
        async with self._lock:
            room = self._rooms.get(code)
            if room and not room.players:
                if room._countdown_task:
                    room._countdown_task.cancel()
                del self._rooms[code]

    def stats(self) -> dict[str, int]:
        return {
            "rooms": len(self._rooms),
            "players": sum(len(r.players) for r in self._rooms.values()),
        }


registry = RoomRegistry()
