"""Проверка правдоподобности результата.

Клиенту нельзя доверять: он может прислать любые числа. Здесь отсекаем
то, что физически невозможно, прежде чем результат попадёт в лидерборд.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings
from app.services.metrics import TestMetrics


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str = ""


# Счётчики с момента запуска процесса — для сводки в админке. Один воркер,
# поэтому обычного словаря достаточно; при перезапуске обнуляются, и это
# в сводке честно подписано «с момента запуска». В базу не пишем: доля
# отказов нужна как индикатор здесь и сейчас, а не как история.
_counters = {"accepted": 0, "rejected": 0}


def record(ok: bool) -> None:
    """Отметить исход проверки для сводки."""
    _counters["accepted" if ok else "rejected"] += 1


def counters() -> dict[str, int]:
    """Сколько результатов принято и отклонено с момента запуска."""
    return dict(_counters)


def validate(metrics: TestMetrics, *, samples_count: int) -> Verdict:
    """Проверить результат перед сохранением."""

    if metrics.duration <= 0 or metrics.duration > settings.max_test_duration:
        return Verdict(False, "Недопустимая длительность теста")

    if metrics.wpm > settings.max_wpm:
        return Verdict(False, f"Скорость выше предела в {settings.max_wpm:.0f} wpm")

    # raw не может быть меньше wpm: raw считается по всем символам,
    # а wpm — только по верным, то есть по подмножеству.
    if metrics.raw + 0.01 < metrics.wpm:
        return Verdict(False, "raw не может быть меньше wpm")

    if not 0 <= metrics.accuracy <= 100:
        return Verdict(False, "Точность вне диапазона")

    if metrics.total_chars == 0:
        return Verdict(False, "Пустой тест")

    # Идеально ровный темп на длинном тесте — признак автонабора.
    if metrics.duration >= 15 and samples_count >= 5 and metrics.consistency > 99.5:
        return Verdict(False, "Слишком ровный темп — похоже на автонабор")

    return Verdict(True)


def burst_exceeds_limit(chars: int, seconds: float) -> bool:
    """Не мог ли человек физически набрать столько символов за столько времени.

    Нужна гонкам: там прогресс приходит десятками сообщений в секунду,
    и проверять правдоподобность целого теста нечем — теста ещё нет.
    Поэтому проверяем прирост между сообщениями.

    Функция намеренно чистая, без обращений к базе: её зовут на каждое
    сообщение сокета, и поход в базу там недопустим.

    Порог тот же, что у сохранённого результата: settings.max_wpm, то есть
    max_wpm × 5 символов в минуту. Одну общую границу держим специально —
    иначе через гонку можно было бы протащить то, что не проходит обычной
    проверкой, и лидерборд пришлось бы защищать дважды.

    True означает «столько за столько времени невозможно». Отключать за это
    игрока не следует: то же самое даёт задержка в сети, когда несколько
    сообщений приходят слипшимися. Правильная реакция — не засчитать прирост.
    """
    if chars <= 0:
        return False

    # Нулевое и отрицательное время — это не сверхскорость, а рассинхрон
    # часов или два сообщения в одну миллисекунду. Считаем невозможным.
    if seconds <= 0:
        return True

    limit_chars_per_second = settings.max_wpm * 5 / 60
    return chars / seconds > limit_chars_per_second
