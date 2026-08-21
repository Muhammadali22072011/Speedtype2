"""Опыт, уровень и серия дней.

Три вещи, которых у нас не было, а у monkeytype они на видном месте:
полоса опыта в шапке, уровень рядом с именем и счётчик дней подряд.

Считаем на лету по истории результатов, отдельных колонок не заводим.
Причина простая: формулу начисления захочется поправить — и с колонкой
пришлось бы пересчитывать всю базу, а так меняется одна функция.
Когда история дорастёт до десятков тысяч строк на человека, это станет
дорого, и вот тогда появится колонка с накопленным опытом.
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

# Сколько опыта даёт секунда набора. Число из monkeytype: там базовое
# начисление — примерно секунда теста за очко.
XP_PER_SECOND = 1.0

# Надбавки за качество: безошибочный тест и высокая точность.
XP_PERFECT_BONUS = 0.5
XP_ACCURACY_THRESHOLD = 98.0
XP_ACCURACY_BONUS = 0.25


@dataclass(frozen=True)
class LevelInfo:
    """Уровень и положение внутри него."""

    level: int
    xp: int
    #: Сколько опыта набрано внутри текущего уровня
    xp_in_level: int
    #: Сколько нужно на весь текущий уровень
    xp_for_level: int
    #: Доля пройденного, 0..1 — из неё рисуется полоса
    progress: float


def xp_for_result(*, duration: float, accuracy: float, incorrect_chars: int) -> int:
    """Сколько опыта принёс один тест.

    Опыт считается от времени, а не от скорости: иначе выгоднее было бы
    гнать короткие тесты на пределе, а не набирать ровно и долго.
    """
    xp = max(0.0, duration) * XP_PER_SECOND

    if incorrect_chars == 0:
        xp *= 1 + XP_PERFECT_BONUS
    elif accuracy >= XP_ACCURACY_THRESHOLD:
        xp *= 1 + XP_ACCURACY_BONUS

    return round(xp)


def xp_needed_for_level(level: int) -> int:
    """Сколько опыта стоит переход с уровня level на следующий.

    Растёт линейно: каждый следующий уровень дороже предыдущего на
    постоянную величину. Квадратичный рост на больших уровнях
    превращается в стену, а линейный оставляет ощущение движения.
    """
    return 50 * max(1, level)


def level_from_xp(total_xp: int) -> LevelInfo:
    """Разложить накопленный опыт на уровень и остаток."""
    total = max(0, int(total_xp))

    level = 1
    left = total

    while left >= xp_needed_for_level(level):
        left -= xp_needed_for_level(level)
        level += 1

        # Страховка от бесконечного цикла, если кто-то поправит формулу
        # так, что она перестанет расти
        if level > 10_000:  # pragma: no cover
            break

    need = xp_needed_for_level(level)
    return LevelInfo(
        level=level,
        xp=total,
        xp_in_level=left,
        xp_for_level=need,
        progress=round(left / need, 4) if need else 0.0,
    )


def streak_from_days(days: list[dt.date], today: dt.date) -> tuple[int, int]:
    """Серия дней подряд: текущая и самая длинная за всю историю.

    Дни приходят уникальными и отсортированными по возрастанию.

    Текущая серия не рвётся, если сегодня ещё не печатали, но вчера
    печатали: день не кончился, и обнулять счётчик рано — иначе человек,
    открывший тренажёр утром, увидит ноль вместо честной серии.
    """
    if not days:
        return 0, 0

    longest = 1
    running = 1

    for previous, current in zip(days, days[1:]):
        if (current - previous).days == 1:
            running += 1
            longest = max(longest, running)
        else:
            running = 1

    last = days[-1]
    gap = (today - last).days

    # Сегодня или вчера — серия жива, дальше уже разорвана
    current_streak = running if gap <= 1 else 0

    return current_streak, longest


def total_xp(results: list[tuple[float, float, int]]) -> int:
    """Сумма опыта по всей истории.

    Принимает тройки (duration, accuracy, incorrect_chars) — ровно то,
    что нужно формуле, и ничего лишнего: так функция остаётся проверяемой
    без базы.
    """
    return sum(
        xp_for_result(duration=d, accuracy=a, incorrect_chars=i) for d, a, i in results
    )


def estimated_words(correct_chars: int) -> int:
    """Сколько слов набрано за всё время — по той же мере, что и wpm.

    Слово это пять символов; здесь та же условность, что и в метриках,
    иначе два числа на одной странице считались бы по-разному.
    """
    return math.floor(max(0, correct_chars) / 5)
