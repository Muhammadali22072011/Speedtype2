"""Расчёт метрик теста печати.

Формулы взяты из monkeytype, а не выдуманы:

- слово = 5 символов, независимо от языка;
- wpm считается по ПРАВИЛЬНО набранным символам;
- raw — по всем набранным символам, включая ошибочные;
- accuracy — доля верных нажатий от всех нажатий, а не от длины текста;
- consistency — насколько ровно шла скорость: 100% минус
  коэффициент вариации посекундных замеров wpm.

В старой версии consistency был Math.random(), а wpm считался
по количеству слов — обе величины были неверными.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

CHARS_PER_WORD = 5


@dataclass(frozen=True)
class TestMetrics:
    """Результат одного теста."""

    wpm: float
    raw: float
    accuracy: float
    consistency: float
    correct_chars: int
    incorrect_chars: int
    total_chars: int
    duration: float


def _minutes(seconds: float) -> float:
    """Секунды в минуты. Ноль защищаем, чтобы не делить на него."""
    return max(seconds, 1e-9) / 60.0


def calculate_wpm(correct_chars: int, seconds: float) -> float:
    """Скорость по верно набранным символам."""
    return (correct_chars / CHARS_PER_WORD) / _minutes(seconds)


def calculate_raw(total_chars: int, seconds: float) -> float:
    """Скорость по всем нажатиям, ошибки не вычитаются."""
    return (total_chars / CHARS_PER_WORD) / _minutes(seconds)


def calculate_accuracy(correct_chars: int, incorrect_chars: int) -> float:
    """Доля верных нажатий от общего числа нажатий."""
    total = correct_chars + incorrect_chars
    if total == 0:
        return 100.0
    return (correct_chars / total) * 100.0


def calculate_consistency(wpm_samples: list[float]) -> float:
    """Ровность скорости по посекундным замерам wpm.

    Считаем коэффициент вариации (стандартное отклонение / среднее)
    и переводим его в проценты «ровности». Чем ровнее темп,
    тем ближе к 100.
    """
    samples = [s for s in wpm_samples if s > 0]
    if len(samples) < 2:
        return 100.0

    mean = sum(samples) / len(samples)
    if mean == 0:
        return 0.0

    variance = sum((s - mean) ** 2 for s in samples) / len(samples)
    cv = math.sqrt(variance) / mean

    return max(0.0, min(100.0, (1 - cv) * 100.0))


def build_metrics(
    *,
    correct_chars: int,
    incorrect_chars: int,
    seconds: float,
    wpm_samples: list[float] | None = None,
) -> TestMetrics:
    """Собрать все метрики теста разом."""
    total_chars = correct_chars + incorrect_chars

    return TestMetrics(
        wpm=round(calculate_wpm(correct_chars, seconds), 2),
        raw=round(calculate_raw(total_chars, seconds), 2),
        accuracy=round(calculate_accuracy(correct_chars, incorrect_chars), 2),
        consistency=round(calculate_consistency(wpm_samples or []), 2),
        correct_chars=correct_chars,
        incorrect_chars=incorrect_chars,
        total_chars=total_chars,
        duration=round(seconds, 2),
    )
