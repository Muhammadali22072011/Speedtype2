"""Опыт, уровень и серия дней.

Функции чистые и проверяются без базы — ради этого они и принимают
готовые тройки чисел, а не сессию SQLAlchemy.
"""

from __future__ import annotations

import datetime as dt

from app.services.progress import (
    estimated_words,
    level_from_xp,
    streak_from_days,
    total_xp,
    xp_for_result,
    xp_needed_for_level,
)


class TestXp:
    def test_opyt_schitaetsya_ot_vremeni(self):
        # Вдвое дольше — вдвое больше опыта. Считать от скорости нельзя:
        # тогда выгоднее гнать короткие тесты, а не набирать ровно
        short = xp_for_result(duration=30, accuracy=90, incorrect_chars=5)
        long = xp_for_result(duration=60, accuracy=90, incorrect_chars=5)
        assert long == short * 2

    def test_bezoshibochnyy_test_dorozhe(self):
        clean = xp_for_result(duration=60, accuracy=100, incorrect_chars=0)
        dirty = xp_for_result(duration=60, accuracy=90, incorrect_chars=10)
        assert clean > dirty

    def test_vysokaya_tochnost_daet_nadbavku(self):
        good = xp_for_result(duration=60, accuracy=99, incorrect_chars=1)
        plain = xp_for_result(duration=60, accuracy=90, incorrect_chars=10)
        assert good > plain

    def test_nulevaya_dlitelnost_ne_daet_opyta(self):
        assert xp_for_result(duration=0, accuracy=100, incorrect_chars=0) == 0

    def test_otricatelnaya_dlitelnost_ne_lomaet(self):
        assert xp_for_result(duration=-10, accuracy=100, incorrect_chars=0) == 0

    def test_summa_po_istorii(self):
        one = xp_for_result(duration=60, accuracy=100, incorrect_chars=0)
        assert total_xp([(60, 100, 0), (60, 100, 0)]) == one * 2

    def test_pustaya_istoriya(self):
        assert total_xp([]) == 0


class TestLevels:
    def test_nachinaem_s_pervogo(self):
        info = level_from_xp(0)
        assert info.level == 1
        assert info.progress == 0.0

    def test_kazhdyy_sleduyushchiy_dorozhe(self):
        assert xp_needed_for_level(2) > xp_needed_for_level(1)
        assert xp_needed_for_level(10) > xp_needed_for_level(9)

    def test_ostatok_vnutri_urovnya(self):
        # Первый уровень стоит 50, значит на 70 будет второй с остатком 20
        info = level_from_xp(70)
        assert info.level == 2
        assert info.xp_in_level == 20
        assert info.xp_for_level == 100
        assert info.progress == 0.2

    def test_opyt_sohranyaetsya_celikom(self):
        assert level_from_xp(1234).xp == 1234

    def test_otricatelnyy_opyt_ne_lomaet(self):
        info = level_from_xp(-5)
        assert info.level == 1
        assert info.xp == 0

    def test_uroven_rastet_monotonno(self):
        levels = [level_from_xp(x).level for x in range(0, 5000, 250)]
        assert levels == sorted(levels)


class TestStreak:
    TODAY = dt.date(2026, 8, 20)

    def test_pustaya_istoriya(self):
        assert streak_from_days([], self.TODAY) == (0, 0)

    def test_tri_dnya_podryad(self):
        days = [dt.date(2026, 8, 18), dt.date(2026, 8, 19), self.TODAY]
        assert streak_from_days(days, self.TODAY) == (3, 3)

    def test_segodnya_eshche_ne_pechatali_seriya_zhiva(self):
        # День не кончился — обнулять счётчик рано
        days = [dt.date(2026, 8, 18), dt.date(2026, 8, 19)]
        assert streak_from_days(days, self.TODAY) == (2, 2)

    def test_propustili_den_seriya_oborvana(self):
        days = [dt.date(2026, 8, 10), dt.date(2026, 8, 11)]
        current, longest = streak_from_days(days, self.TODAY)
        assert current == 0
        # Но рекорд серии остаётся в истории
        assert longest == 2

    def test_dlinneyshaya_seriya_iz_serediny(self):
        days = [
            dt.date(2026, 8, 1),
            dt.date(2026, 8, 2),
            dt.date(2026, 8, 3),
            dt.date(2026, 8, 4),
            dt.date(2026, 8, 19),
            self.TODAY,
        ]
        current, longest = streak_from_days(days, self.TODAY)
        assert current == 2
        assert longest == 4

    def test_odin_den(self):
        assert streak_from_days([self.TODAY], self.TODAY) == (1, 1)


class TestWords:
    def test_slovo_eto_pyat_simvolov(self):
        # Та же условность, что и в метриках: иначе два числа на одной
        # странице считались бы по-разному
        assert estimated_words(500) == 100

    def test_nepolnoe_slovo_ne_schitaetsya(self):
        assert estimated_words(9) == 1

    def test_otricatelnoe_ne_lomaet(self):
        assert estimated_words(-100) == 0
