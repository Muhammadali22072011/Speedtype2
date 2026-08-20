"""Подготовка текста для теста.

Пунктуация и цифры добавляются поверх готового списка слов — так же,
как в monkeytype: словарь остаётся чистым, а режимы включаются флагами.
"""

from __future__ import annotations

import random

# Знак в конце предложения и его вес: точка встречается чаще прочего
_SENTENCE_ENDINGS = [(".", 0.65), ("?", 0.15), ("!", 0.10), ("...", 0.10)]

# Знаки внутри предложения
_INNER_MARKS = [",", ";", ":", "-"]

_QUOTE_PAIRS = [('"', '"'), ("'", "'")]


def _weighted_ending(rng: random.Random) -> str:
    roll = rng.random()
    cumulative = 0.0
    for mark, weight in _SENTENCE_ENDINGS:
        cumulative += weight
        if roll <= cumulative:
            return mark
    return "."


def add_punctuation(words: list[str], rng: random.Random | None = None) -> list[str]:
    """Расставить знаки препинания и заглавные буквы.

    Текст разбивается на предложения по 4-9 слов: первое слово с заглавной,
    последнее со знаком конца. Внутри изредка попадаются запятые и кавычки.
    """
    rng = rng or random.Random()
    if not words:
        return []

    result: list[str] = []
    index = 0

    while index < len(words):
        length = min(rng.randint(4, 9), len(words) - index)
        sentence = [w for w in words[index : index + length]]
        index += length

        sentence[0] = sentence[0].capitalize()

        # Знак внутри предложения — не в последнем слове
        if len(sentence) > 3 and rng.random() < 0.35:
            position = rng.randint(0, len(sentence) - 2)
            sentence[position] += rng.choice(_INNER_MARKS)

        # Слово в кавычках
        if len(sentence) > 4 and rng.random() < 0.15:
            position = rng.randint(1, len(sentence) - 2)
            left, right = rng.choice(_QUOTE_PAIRS)
            sentence[position] = f"{left}{sentence[position]}{right}"

        sentence[-1] += _weighted_ending(rng)
        result.extend(sentence)

    return result


def add_numbers(words: list[str], rng: random.Random | None = None, ratio: float = 0.15) -> list[str]:
    """Подмешать числа — примерно каждое седьмое слово."""
    rng = rng or random.Random()
    if not words:
        return []

    result = list(words)
    count = max(1, int(len(result) * ratio))

    for _ in range(count):
        position = rng.randrange(len(result))
        digits = rng.randint(1, 4)
        result[position] = str(rng.randrange(10 ** (digits - 1), 10**digits))

    return result


def prepare(
    words: list[str],
    *,
    punctuation: bool = False,
    numbers: bool = False,
    seed: int | None = None,
) -> list[str]:
    """Применить выбранные режимы. Порядок важен: сначала цифры, потом знаки."""
    rng = random.Random(seed)

    result = list(words)
    if numbers:
        result = add_numbers(result, rng)
    if punctuation:
        result = add_punctuation(result, rng)

    return result
