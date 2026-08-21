"""Комнаты для гонок.

Состояние живёт в памяти процесса: гонка идёт минуты, переживать
перезапуск ей незачем. Для нескольких воркеров сюда понадобится Redis,
но пока сервер один.

В этом файле только данные и правила комнаты — ничего, что умеет говорить
по сети. Сокеты и фоновые задачи держит RaceSession в api/routes/race.py.
Благодаря этому Room собирается в тесте без единого соединения, и правила
гонки проверяются без поднятого сервера.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.anticheat import burst_exceeds_limit

RoomState = Literal["waiting", "countdown", "racing", "finished"]

COUNTDOWN_SECONDS = 5
MAX_PLAYERS = 8

#: Сколько ждём отставших после финиша первого.
#:
#: Без этого срока комната зависала навсегда: гонка заканчивалась только
#: когда финишировали ВСЕ, а один человек, ушедший от компьютера с открытой
#: вкладкой, держал остальных без результата бесконечно.
STRAGGLER_SECONDS = 60

#: Сколько живёт комната, в которую никто не вошёл. Создаётся она одним
#: POST, и без срока такие комнаты копились бы в памяти до перезапуска.
EMPTY_ROOM_TTL = 600

#: Запас на неровность сети.
#:
#: Сообщения о прогрессе приходят с дрожанием, и короткий интервал между
#: двумя из них сам по себе не признак накрутки: честный игрок мог просто
#: попасть в паузу канала. Прибавляем секунду к измеренному интервалу —
#: то есть прощаем ровно один секундный рывок.
BURST_GRACE_SECONDS = 1.0


@dataclass
class Player:
    id: str
    name: str
    is_host: bool = False
    ready: bool = False

    #: Верных символов. Счёт ведёт сервер, а не клиент: раньше wpm, точность
    #: и прогресс приходили из браузера и рассылались как истина —
    #: подделывалось одной строкой в консоли.
    chars: int = 0
    accuracy: float = 100.0

    finished_at: float | None = None
    place: int | None = None

    #: Когда последний раз приняли прирост — от этого считается потолок.
    last_chars_at: float = 0.0

    def wpm(self, started_at: float | None, now: float) -> float:
        """Скорость от времени, которое засёк сервер.

        Клиент своего wpm больше не присылает вовсе: у него нет способа
        доказать, что он не соврал, а у сервера есть собственные часы.
        """
        if started_at is None:
            return 0.0
        end = self.finished_at if self.finished_at is not None else now
        minutes = max(end - started_at, 1e-6) / 60
        return (self.chars / 5) / minutes

    def accept_chars(self, chars: int, now: float, started_at: float | None) -> bool:
        """Принять новое число набранных символов.

        Возвращает False, если прирост физически невозможен. В этом случае
        игрока НЕ отключаем и не наказываем: обрыв связи и лаг выглядят
        точно так же, как накрутка, а наказывать за плохой интернет нельзя.
        Просто не засчитываем прирост — на следующем честном сообщении
        счётчик догонит сам.
        """
        if started_at is None:
            return False
        if chars < self.chars:
            # Назад счётчик не идёт: это либо опоздавшее сообщение,
            # либо попытка занизить, чтобы потом «разогнаться»
            return False

        # Порог берём из античита обычного теста, а не свой. Одна общая
        # граница нужна затем, чтобы через гонку нельзя было протащить то,
        # что не проходит обычной проверкой: иначе лидерборд пришлось бы
        # защищать дважды и разными числами.
        since = max(now - (self.last_chars_at or started_at), 0.0)
        if burst_exceeds_limit(chars - self.chars, since + BURST_GRACE_SECONDS):
            return False

        self.chars = chars
        self.last_chars_at = now
        return True

    def public(self, started_at: float | None, now: float, total_chars: int) -> dict[str, Any]:
        progress = min(self.chars / total_chars, 1.0) if total_chars else 0.0
        return {
            "id": self.id,
            "name": self.name,
            "isHost": self.is_host,
            "ready": self.ready,
            "progress": round(progress, 4),
            "wpm": round(self.wpm(started_at, now), 1),
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

    created_at: float = field(default_factory=time.time)
    #: Момент старта по часам сервера. От него считается скорость всех.
    started_at: float | None = None

    @property
    def total_chars(self) -> int:
        """Сколько символов в тексте гонки — по нему считается прогресс."""
        if not self.words:
            return 0
        return sum(len(w) for w in self.words) + max(len(self.words) - 1, 0)

    def public(self, now: float | None = None) -> dict[str, Any]:
        moment = time.time() if now is None else now
        total = self.total_chars
        return {
            "code": self.code,
            "state": self.state,
            "language": self.language,
            "wordCount": self.word_count,
            "punctuation": self.punctuation,
            "numbers": self.numbers,
            "words": self.words if self.state in ("countdown", "racing", "finished") else [],
            "players": [p.public(self.started_at, moment, total) for p in self.players.values()],
        }

    @property
    def everyone_ready(self) -> bool:
        return len(self.players) >= 2 and all(p.ready for p in self.players.values())

    @property
    def everyone_finished(self) -> bool:
        return bool(self.players) and all(p.finished_at is not None for p in self.players.values())

    @property
    def is_abandoned(self) -> bool:
        """Пустая комната, в которую так никто и не вошёл за отведённый срок."""
        return not self.players and time.time() - self.created_at > EMPTY_ROOM_TTL

    def reset_progress(self) -> None:
        """Сбросить ход гонки, оставив состав. Нужно перед новым стартом."""
        self.finish_order.clear()
        self.started_at = None
        for player in self.players.values():
            player.chars = 0
            player.accuracy = 100.0
            player.finished_at = None
            player.place = None
            player.last_chars_at = 0.0


class RoomRegistry:
    """Хранилище комнат."""

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
            self.sweep()

            code = self._make_code()
            while code in self._rooms:
                code = self._make_code()

            room = Room(code=code, seed=random.randrange(1_000_000), **kwargs)
            self._rooms[code] = room
            return room

    def get(self, code: str) -> Room | None:
        return self._rooms.get(code.upper())

    async def drop(self, code: str) -> None:
        async with self._lock:
            room = self._rooms.get(code)
            if room is not None and not room.players:
                del self._rooms[code]

    def sweep(self) -> list[str]:
        """Убрать комнаты, в которые никто не вошёл.

        Зовётся при создании новой: отдельный фоновый таймер ради этого
        держать незачем, а комнаты появляются только здесь.
        """
        stale = [code for code, room in self._rooms.items() if room.is_abandoned]
        for code in stale:
            del self._rooms[code]
        return stale

    def stats(self) -> dict[str, int]:
        return {
            "rooms": len(self._rooms),
            "players": sum(len(r.players) for r in self._rooms.values()),
        }


registry = RoomRegistry()
