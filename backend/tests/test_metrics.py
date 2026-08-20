"""Проверка формул. Числа подобраны так, чтобы результат можно было посчитать в уме."""

from __future__ import annotations

import pytest

from app.services.metrics import (
    build_metrics,
    calculate_accuracy,
    calculate_consistency,
    calculate_raw,
    calculate_wpm,
)


class TestWpm:
    def test_slovo_eto_pyat_simvolov(self):
        # 300 верных символов за 60 секунд = 60 слов за минуту
        assert calculate_wpm(300, 60) == pytest.approx(60.0)

    def test_polovina_minuty_udvaivaet_skorost(self):
        assert calculate_wpm(300, 30) == pytest.approx(120.0)

    def test_nulevoy_vvod_daet_nol(self):
        assert calculate_wpm(0, 60) == pytest.approx(0.0)


class TestRaw:
    def test_raw_uchityvaet_oshibki(self):
        # 250 верных + 50 ошибочных: wpm по 250, raw по всем 300
        assert calculate_wpm(250, 60) == pytest.approx(50.0)
        assert calculate_raw(300, 60) == pytest.approx(60.0)

    def test_bez_oshibok_raw_raven_wpm(self):
        assert calculate_raw(300, 60) == calculate_wpm(300, 60)


class TestAccuracy:
    def test_schitaetsya_ot_nazhatiy_a_ne_ot_dliny_teksta(self):
        # 90 верных из 100 нажатий
        assert calculate_accuracy(90, 10) == pytest.approx(90.0)

    def test_bez_nazhatiy_sto_procentov(self):
        assert calculate_accuracy(0, 0) == pytest.approx(100.0)

    def test_vse_oshibki_nol(self):
        assert calculate_accuracy(0, 50) == pytest.approx(0.0)


class TestConsistency:
    def test_rovnyy_temp_daet_sto(self):
        assert calculate_consistency([60, 60, 60, 60]) == pytest.approx(100.0)

    def test_rvanyy_temp_daet_menshe(self):
        rovno = calculate_consistency([60, 60, 60, 60])
        rvano = calculate_consistency([20, 100, 30, 90])
        assert rvano < rovno

    def test_odna_tochka_ne_pokazatelna(self):
        # По одному замеру о ровности судить нельзя — не наказываем
        assert calculate_consistency([55]) == pytest.approx(100.0)

    def test_vsegda_v_diapazone(self):
        for samples in ([1, 200, 1, 300], [5, 5, 5], [10, 90]):
            value = calculate_consistency(samples)
            assert 0.0 <= value <= 100.0

    def test_ne_sluchaynoe_chislo(self):
        # В старой версии consistency был Math.random(): два вызова
        # на одних данных давали разное. Теперь функция чистая.
        samples = [40, 55, 61, 48]
        assert calculate_consistency(samples) == calculate_consistency(samples)


class TestBuildMetrics:
    def test_sobiraet_vse_vmeste(self):
        m = build_metrics(
            correct_chars=250,
            incorrect_chars=50,
            seconds=60,
            wpm_samples=[50, 50, 50],
        )
        assert m.wpm == pytest.approx(50.0)
        assert m.raw == pytest.approx(60.0)
        assert m.accuracy == pytest.approx(83.33, abs=0.01)
        assert m.consistency == pytest.approx(100.0)
        assert m.total_chars == 300

    def test_raw_nikogda_ne_menshe_wpm(self):
        m = build_metrics(correct_chars=100, incorrect_chars=200, seconds=30)
        assert m.raw >= m.wpm
