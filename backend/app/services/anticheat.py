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
