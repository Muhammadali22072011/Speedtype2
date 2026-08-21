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

#: Версия формулы ровности, которой посчитан результат.
#: 1 — коэффициент вариации НАРАСТАЮЩЕГО ряда wpm, линейный перевод в проценты.
#:     Нарастающий ряд гладок по своей природе, поэтому цифра завышена
#:     примерно на 14 пунктов против monkeytype.
#: 2 — как у них: коэффициент вариации ПОСЕКУНДНОЙ скорости, перевод через
#:     kogasa. Считается только когда клиент прислал посекундный ряд.
#: Версия хранится у каждого результата: старые и новые цифры несравнимы,
#: и без пометки лидерборд молча смешал бы две шкалы.
CONSISTENCY_LEGACY = 1
CONSISTENCY_CURRENT = 2


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
    #: Какой формулой посчитана ровность — см. CONSISTENCY_LEGACY и CURRENT.
    #: Со значением по умолчанию, поэтому стоит последним: у dataclass
    #: поля без значения не могут идти после полей со значением.
    consistency_version: int = CONSISTENCY_LEGACY


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




def kogasa(cov: float) -> float:
    """Перевод коэффициента вариации в проценты ровности, как у monkeytype.

    Сглаженная версия «100 − cov·100»: до cov 0.5 они совпадают в пределах
    десятой доли процента, дальше эта не уходит в отрицательные значения.
    Формула из packages/util/src/numbers.ts.
    """
    return 100 * (1 - math.tanh(cov + cov**3 / 3 + cov**5 / 5))


def coefficient_of_variation(samples: list[float]) -> float | None:
    """Отношение среднеквадратичного отклонения к среднему.

    None означает «считать не из чего»: одного замера мало, а нулевое
    среднее означает, что не набрано ничего.
    """
    values = [s for s in samples if s > 0]
    if len(values) < 2:
        return None

    mean = sum(values) / len(values)
    if mean == 0:
        return None

    variance = sum((s - mean) ** 2 for s in values) / len(values)
    return math.sqrt(variance) / mean


def calculate_consistency_v2(raw_samples: list[float]) -> float:
    """Ровность по посекундной скорости — так считает monkeytype.

    Ряд должен быть именно посекундным: скорость ЗА каждую секунду,
    а не с начала теста. Нарастающий ряд подавляет разброс и завышает
    ровность примерно на 14 пунктов.
    """
    cov = coefficient_of_variation(raw_samples)
    if cov is None:
        return 100.0

    return max(0.0, min(100.0, kogasa(cov)))


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
    raw_samples: list[float] | None = None,
) -> TestMetrics:
    """Собрать все метрики теста разом.

    Ровность считается по посекундному ряду, если клиент его прислал, —
    так же, как у monkeytype. Старые клиенты его не шлют, для них остаётся
    прежняя формула, и результат помечается версией 1.

    Обратной совместимости ради, а не из вежливости: без неё каждый
    не обновившийся клиент получал бы ровность 100% на пустом ряде.
    """
    total_chars = correct_chars + incorrect_chars

    if raw_samples:
        consistency = calculate_consistency_v2(raw_samples)
        version = CONSISTENCY_CURRENT
    else:
        consistency = calculate_consistency(wpm_samples or [])
        version = CONSISTENCY_LEGACY

    return TestMetrics(
        wpm=round(calculate_wpm(correct_chars, seconds), 2),
        raw=round(calculate_raw(total_chars, seconds), 2),
        accuracy=round(calculate_accuracy(correct_chars, incorrect_chars), 2),
        consistency=round(consistency, 2),
        consistency_version=version,
        correct_chars=correct_chars,
        incorrect_chars=incorrect_chars,
        total_chars=total_chars,
        duration=round(seconds, 2),
    )
