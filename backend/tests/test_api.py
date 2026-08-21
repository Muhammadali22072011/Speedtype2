"""Проверка API целиком: регистрация, отправка результата, лидерборд, античит."""

from __future__ import annotations

import pytest

# Движок, тестовая база и фикстура client живут в conftest.py — одни на все
# файлы тестов. Здесь только помощники и сами проверки.


def register(client, username="tester", password="secret123"):
    r = client.post(
        "/api/auth/register",
        json={"username": username, "email": f"{username}@test.local", "password": password},
    )
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


class TestAuth:
    def test_registraciya_i_vhod(self, client):
        token = register(client)

        me = client.get("/api/auth/me", headers=auth(token))
        assert me.status_code == 200
        assert me.json()["username"] == "tester"

    def test_povtornoe_imya_otklonyaetsya(self, client):
        register(client)
        r = client.post(
            "/api/auth/register",
            json={"username": "tester", "email": "other@test.local", "password": "secret123"},
        )
        assert r.status_code == 409

    def test_nevernyy_parol(self, client):
        register(client)
        r = client.post("/api/auth/login", json={"username": "tester", "password": "wrong"})
        assert r.status_code == 401

    def test_bez_tokena_net_dostupa(self, client):
        assert client.get("/api/auth/me").status_code == 401

    def test_korotkiy_parol_otklonyaetsya(self, client):
        r = client.post(
            "/api/auth/register",
            json={"username": "shorty", "email": "s@test.local", "password": "123"},
        )
        assert r.status_code == 422


class TestResults:
    def test_server_sam_schitaet_metriki(self, client):
        token = register(client)
        r = client.post(
            "/api/results",
            headers=auth(token),
            json={
                "correct_chars": 250,
                "incorrect_chars": 50,
                "duration": 60,
                "wpm_samples": [50, 52, 48],
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["wpm"] == pytest.approx(50.0)
        assert body["raw"] == pytest.approx(60.0)
        assert body["accuracy"] == pytest.approx(83.33, abs=0.01)

    def test_gost_tozhe_mozhet_sohranit(self, client):
        r = client.post(
            "/api/results",
            json={
                "correct_chars": 100,
                "incorrect_chars": 0,
                "duration": 30,
                "wpm_samples": [40, 40],
                "mode": "words",
                "mode_value": "25",
                "language": "english",
            },
        )
        assert r.status_code == 201

    def test_statistika_polzovatelya(self, client):
        token = register(client)
        for correct in (150, 300):
            client.post(
                "/api/results",
                headers=auth(token),
                json={
                    "correct_chars": correct,
                    "incorrect_chars": 0,
                    "duration": 60,
                    "wpm_samples": [30, 30],
                    "mode": "time",
                    "mode_value": "60",
                    "language": "english",
                },
            )
        stats = client.get("/api/results/stats", headers=auth(token)).json()
        assert stats["tests"] == 2
        assert stats["best_wpm"] == pytest.approx(60.0)
        assert stats["avg_wpm"] == pytest.approx(45.0)


class TestAnticheat:
    def test_nerealnaya_skorost_otklonyaetsya(self, client):
        token = register(client)
        # 100 000 символов за секунду — 1 200 000 wpm
        r = client.post(
            "/api/results",
            headers=auth(token),
            json={
                "correct_chars": 100000,
                "incorrect_chars": 0,
                "duration": 1,
                "wpm_samples": [500, 500],
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )
        assert r.status_code == 422
        assert "wpm" in r.json()["detail"].lower()

    def test_pustoy_test_otklonyaetsya(self, client):
        r = client.post(
            "/api/results",
            json={
                "correct_chars": 0,
                "incorrect_chars": 0,
                "duration": 10,
                "wpm_samples": [],
                "mode": "time",
                "mode_value": "10",
                "language": "english",
            },
        )
        assert r.status_code == 422

    def test_idealno_rovnyy_temp_podozritelen(self, client):
        r = client.post(
            "/api/results",
            json={
                "correct_chars": 500,
                "incorrect_chars": 0,
                "duration": 60,
                "wpm_samples": [100.0] * 10,
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )
        assert r.status_code == 422
        assert "автонабор" in r.json()["detail"]


def send_result(client, token, *, correct=300, mode="time", value="60", language="english"):
    r = client.post(
        "/api/results",
        headers=auth(token),
        json={
            "correct_chars": correct,
            "incorrect_chars": 0,
            "duration": 60,
            "wpm_samples": [60, 60],
            "mode": mode,
            "mode_value": value,
            "language": language,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestRecordsAndFilters:
    def test_rekord_po_kazhdomu_rezhimu(self, client):
        token = register(client, "gina")
        send_result(client, token, correct=300, mode="time", value="60")
        send_result(client, token, correct=600, mode="time", value="60")
        send_result(client, token, correct=150, mode="words", value="25")

        records = client.get("/api/results/records", headers=auth(token)).json()
        by_mode = {(r["mode"], r["mode_value"]): r["wpm"] for r in records}

        assert len(records) == 2
        # В режиме time 60 два результата — в рекордах остаётся лучший
        assert by_mode[("time", "60")] == pytest.approx(120.0)
        assert by_mode[("words", "25")] == pytest.approx(30.0)

    def test_pustaya_istoriya_daet_pustye_rekordy(self, client):
        token = register(client, "hugo")
        assert client.get("/api/results/records", headers=auth(token)).json() == []

    def test_filtr_istorii_po_yazyku_i_rezhimu(self, client):
        token = register(client, "iris")
        send_result(client, token, mode="time", value="15", language="russian")
        send_result(client, token, mode="words", value="25", language="english")

        only_russian = client.get(
            "/api/results", headers=auth(token), params={"language": "russian"}
        )
        assert only_russian.headers["X-Total-Count"] == "1"
        assert only_russian.json()[0]["language"] == "russian"

        only_words = client.get("/api/results", headers=auth(token), params={"mode": "words"})
        assert [r["mode"] for r in only_words.json()] == ["words"]

    def test_chuzhoy_rezultat_ne_udalyaetsya(self, client):
        mine = register(client, "jack")
        other = register(client, "kate")
        result = send_result(client, other)

        assert client.delete(f"/api/results/{result['id']}", headers=auth(mine)).status_code == 404
        # А свой удаляется, и из истории пропадает
        assert client.delete(f"/api/results/{result['id']}", headers=auth(other)).status_code == 204
        assert client.get("/api/results", headers=auth(other)).json() == []


class TestStatsToday:
    def test_segodnyashnie_testy_schitayutsya_otdelno(self, client):
        token = register(client, "eva")
        client.post(
            "/api/results",
            headers=auth(token),
            json={
                "correct_chars": 300,
                "incorrect_chars": 0,
                "duration": 60,
                "wpm_samples": [60, 60],
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )

        stats = client.get("/api/results/stats", headers=auth(token)).json()
        assert stats["tests_today"] == 1
        assert stats["time_today"] == pytest.approx(60.0)

    def test_pustoy_akkaunt_daet_nuli(self, client):
        token = register(client, "fox")
        stats = client.get("/api/results/stats", headers=auth(token)).json()
        assert stats["tests_today"] == 0
        assert stats["time_today"] == 0


class TestLeaderboard:
    def test_odna_stroka_na_igroka_luchshiy_rezultat(self, client):
        token = register(client, "alice")
        for correct in (150, 400, 200):
            client.post(
                "/api/results",
                headers=auth(token),
                json={
                    "correct_chars": correct,
                    "incorrect_chars": 10,
                    "duration": 60,
                    "wpm_samples": [30, 45, 38],
                    "mode": "time",
                    "mode_value": "60",
                    "language": "english",
                },
            )

        rows = client.get("/api/leaderboard").json()
        assert len(rows) == 1
        assert rows[0]["username"] == "alice"
        assert rows[0]["rank"] == 1
        assert rows[0]["wpm"] == pytest.approx(80.0)

    def test_gosti_v_liderbord_ne_popadayut(self, client):
        client.post(
            "/api/results",
            json={
                "correct_chars": 300,
                "incorrect_chars": 0,
                "duration": 60,
                "wpm_samples": [60, 60],
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )
        assert client.get("/api/leaderboard").json() == []

    def test_filtr_po_rezhimu(self, client):
        token = register(client, "bob")
        for value, correct in (("15", 300), ("60", 600)):
            client.post(
                "/api/results",
                headers=auth(token),
                json={
                    "correct_chars": correct,
                    "incorrect_chars": 0,
                    "duration": 60,
                    "wpm_samples": [60, 60],
                    "mode": "time",
                    "mode_value": value,
                    "language": "english",
                },
            )

        rows = client.get("/api/leaderboard", params={"mode": "time", "mode_value": "15"}).json()
        assert len(rows) == 1
        assert rows[0]["mode_value"] == "15"

    def test_stranicy_i_obshchee_chislo(self, client):
        for name in ("ann", "bob", "cid"):
            token = register(client, name)
            client.post(
                "/api/results",
                headers=auth(token),
                json={
                    "correct_chars": 300,
                    "incorrect_chars": 0,
                    "duration": 60,
                    "wpm_samples": [60, 60],
                    "mode": "time",
                    "mode_value": "60",
                    "language": "english",
                },
            )

        first = client.get("/api/leaderboard", params={"limit": 2, "offset": 0})
        assert first.headers["X-Total-Count"] == "3"
        assert [row["rank"] for row in first.json()] == [1, 2]

        second = client.get("/api/leaderboard", params={"limit": 2, "offset": 2})
        # Номера мест продолжают сквозную нумерацию, а не начинаются заново
        assert [row["rank"] for row in second.json()] == [3]

    def test_svoyo_mesto(self, client):
        token = register(client, "dan")
        client.post(
            "/api/results",
            headers=auth(token),
            json={
                "correct_chars": 300,
                "incorrect_chars": 0,
                "duration": 60,
                "wpm_samples": [60, 60],
                "mode": "time",
                "mode_value": "60",
                "language": "english",
            },
        )

        mine = client.get("/api/leaderboard/me", headers=auth(token)).json()
        assert mine["rank"] == 1
        assert mine["row"]["username"] == "dan"

        # Гостю отвечаем пустым местом, а не ошибкой
        assert client.get("/api/leaderboard/me").json() == {"rank": None, "row": None}


class TestMeta:
    def test_health(self, client):
        assert client.get("/api/health").json() == {"status": "ok"}


class TestActivityAndHistogram:
    """Агрегаты для страницы аккаунта: тепловая карта и распределение."""

    def test_aktivnost_gruppiruet_po_dnyam(self, client):
        token = register(client, "hedy")
        send_result(client, token, correct=300)
        send_result(client, token, correct=350)

        r = client.get("/api/results/activity", headers=auth(token))
        assert r.status_code == 200, r.text

        days = r.json()
        # Оба результата отправлены сейчас, значит день один
        assert len(days) == 1
        assert days[0]["tests"] == 2
        assert days[0]["time"] == 120
        # Лучший за день — из большего числа символов
        assert days[0]["best_wpm"] > 60

    def test_aktivnost_pustaya_bez_testov(self, client):
        token = register(client, "ida")
        r = client.get("/api/results/activity", headers=auth(token))
        assert r.status_code == 200
        assert r.json() == []

    def test_aktivnost_trebuet_vhoda(self, client):
        assert client.get("/api/results/activity").status_code == 401

    def test_gistogramma_skladyvaet_v_stolbiki(self, client):
        token = register(client, "jane")
        # 300 верных за 60 с — это 60 wpm, попадёт в столбик 60
        send_result(client, token, correct=300)
        send_result(client, token, correct=300)
        # 550 за 60 с — 110 wpm, столбик 110
        send_result(client, token, correct=550)

        r = client.get("/api/results/histogram", headers=auth(token))
        assert r.status_code == 200, r.text

        buckets = {b["wpm"]: b["tests"] for b in r.json()}
        assert buckets[60] == 2
        assert buckets[110] == 1

    def test_sbros_istorii(self, client):
        token = register(client, "kate")
        send_result(client, token)
        assert len(client.get("/api/results", headers=auth(token)).json()) == 1

        r = client.delete("/api/results", headers=auth(token))
        assert r.status_code == 204

        assert client.get("/api/results", headers=auth(token)).json() == []
        # Статистика тоже обнулилась, а не осталась висеть
        assert client.get("/api/results/stats", headers=auth(token)).json()["tests"] == 0


class TestAccountSettings:
    """Смена имени, почты, пароля, выгрузка и удаление аккаунта."""

    def test_smena_imeni(self, client):
        token = register(client, "liam")
        r = client.patch(
            "/api/auth/me",
            headers=auth(token),
            json={"username": "liam2", "current_password": "secret123"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["username"] == "liam2"

    def test_smena_imeni_bez_parolya_ne_prohodit(self, client):
        token = register(client, "mia")
        r = client.patch(
            "/api/auth/me",
            headers=auth(token),
            json={"username": "mia2", "current_password": "wrong"},
        )
        assert r.status_code == 403
        assert client.get("/api/auth/me", headers=auth(token)).json()["username"] == "mia"

    def test_zanyatoe_imya_ne_otdaem(self, client):
        register(client, "noah")
        token = register(client, "olga")
        r = client.patch(
            "/api/auth/me",
            headers=auth(token),
            json={"username": "noah", "current_password": "secret123"},
        )
        assert r.status_code == 409

    def test_smena_parolya(self, client):
        token = register(client, "petra")
        r = client.post(
            "/api/auth/password",
            headers=auth(token),
            json={"current_password": "secret123", "new_password": "newsecret1"},
        )
        assert r.status_code == 204, r.text

        # Старый пароль больше не подходит, новый подходит
        assert (
            client.post(
                "/api/auth/login", json={"username": "petra", "password": "secret123"}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/login", json={"username": "petra", "password": "newsecret1"}
            ).status_code
            == 200
        )

    def test_korotkiy_parol_ne_prohodit(self, client):
        token = register(client, "quinn")
        r = client.post(
            "/api/auth/password",
            headers=auth(token),
            json={"current_password": "secret123", "new_password": "123"},
        )
        assert r.status_code == 422

    def test_vygruzka_dannyh(self, client):
        token = register(client, "rosa")
        send_result(client, token, mode="words", value="25")

        r = client.get("/api/auth/export", headers=auth(token))
        assert r.status_code == 200, r.text

        data = r.json()
        assert data["user"]["username"] == "rosa"
        assert len(data["results"]) == 1
        assert data["results"][0]["mode"] == "words"

    def test_udalenie_akkaunta_unosit_rezultaty(self, client):
        token = register(client, "sara")
        send_result(client, token)

        r = client.request(
            "DELETE",
            "/api/auth/me",
            headers=auth(token),
            json={"current_password": "secret123"},
        )
        assert r.status_code == 204, r.text

        # Токен указывает на несуществующего человека
        assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
        # Результаты не остались висеть без владельца в лидерборде
        rows = client.get("/api/leaderboard").json()
        rows = rows["rows"] if isinstance(rows, dict) else rows
        assert all(row["username"] != "sara" for row in rows)

    def test_udalenie_bez_parolya_ne_prohodit(self, client):
        token = register(client, "tina")
        r = client.request(
            "DELETE",
            "/api/auth/me",
            headers=auth(token),
            json={"current_password": "wrong"},
        )
        assert r.status_code == 403
        assert client.get("/api/auth/me", headers=auth(token)).status_code == 200


class TestTags:
    """Метки на результатах: своя корзина для истории и рекордов."""

    def test_sozdanie_i_spisok(self, client):
        token = register(client, "ulla")
        r = client.post("/api/tags", headers=auth(token), json={"name": "разминка"})
        assert r.status_code == 201, r.text
        assert r.json()["name"] == "разминка"

        tags = client.get("/api/tags", headers=auth(token)).json()
        assert [t["name"] for t in tags] == ["разминка"]

    def test_odno_imya_dvazhdy_ne_prohodit(self, client):
        token = register(client, "vera")
        client.post("/api/tags", headers=auth(token), json={"name": "код"})
        r = client.post("/api/tags", headers=auth(token), json={"name": "код"})
        assert r.status_code == 409

    def test_odinakovye_imena_u_raznyh_lyudey_mozhno(self, client):
        a = register(client, "wanda")
        b = register(client, "xena")
        assert client.post("/api/tags", headers=auth(a), json={"name": "код"}).status_code == 201
        assert client.post("/api/tags", headers=auth(b), json={"name": "код"}).status_code == 201

    def test_pereimenovanie_ne_teryaet_svyazi(self, client):
        token = register(client, "yara")
        tag = client.post("/api/tags", headers=auth(token), json={"name": "старое"}).json()
        result = send_result(client, token)

        client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(token),
            json={"tag_ids": [tag["id"]]},
        )
        client.patch(
            f"/api/tags/{tag['id']}", headers=auth(token), json={"name": "новое"}
        )

        linked = client.get(f"/api/results/{result['id']}/tags", headers=auth(token)).json()
        assert [t["name"] for t in linked] == ["новое"]

    def test_udalenie_tega_ubiraet_svyazi(self, client):
        token = register(client, "zoya")
        tag = client.post("/api/tags", headers=auth(token), json={"name": "тест"}).json()
        result = send_result(client, token)
        client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(token),
            json={"tag_ids": [tag["id"]]},
        )

        assert client.delete(f"/api/tags/{tag['id']}", headers=auth(token)).status_code == 204
        assert client.get(f"/api/results/{result['id']}/tags", headers=auth(token)).json() == []

    def test_chuzhoy_teg_ne_naveshivaetsya(self, client):
        a = register(client, "anna2")
        b = register(client, "boris2")
        foreign = client.post("/api/tags", headers=auth(a), json={"name": "чужой"}).json()
        result = send_result(client, b)

        r = client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(b),
            json={"tag_ids": [foreign["id"]]},
        )
        assert r.status_code == 404

    def test_chuzhoy_rezultat_ne_pometit(self, client):
        a = register(client, "clara2")
        b = register(client, "diana2")
        result = send_result(client, a)
        tag = client.post("/api/tags", headers=auth(b), json={"name": "мой"}).json()

        r = client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(b),
            json={"tag_ids": [tag["id"]]},
        )
        assert r.status_code == 404

    def test_nabor_zamenyaetsya_celikom(self, client):
        token = register(client, "elena2")
        first = client.post("/api/tags", headers=auth(token), json={"name": "один"}).json()
        second = client.post("/api/tags", headers=auth(token), json={"name": "два"}).json()
        result = send_result(client, token)

        client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(token),
            json={"tag_ids": [first["id"], second["id"]]},
        )
        r = client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(token),
            json={"tag_ids": [second["id"]]},
        )
        assert [t["name"] for t in r.json()] == ["два"]

    def test_trebuet_vhoda(self, client):
        assert client.get("/api/tags").status_code == 401


class TestPresets:
    """Сохранённые наборы настроек."""

    def test_sozdanie_i_chtenie(self, client):
        token = register(client, "fedor2")
        r = client.post(
            "/api/presets",
            headers=auth(token),
            json={"name": "быстрый", "settings": {"mode": "time", "timeValue": 15}},
        )
        assert r.status_code == 201, r.text
        assert r.json()["settings"]["timeValue"] == 15

        presets = client.get("/api/presets", headers=auth(token)).json()
        assert presets[0]["name"] == "быстрый"
        assert presets[0]["settings"]["mode"] == "time"

    def test_perezapis(self, client):
        token = register(client, "galina2")
        preset = client.post(
            "/api/presets",
            headers=auth(token),
            json={"name": "тот", "settings": {"fontSize": 2}},
        ).json()

        r = client.put(
            f"/api/presets/{preset['id']}",
            headers=auth(token),
            json={"name": "этот", "settings": {"fontSize": 3}},
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "этот"
        assert r.json()["settings"]["fontSize"] == 3

    def test_odno_imya_dvazhdy_ne_prohodit(self, client):
        token = register(client, "igor2")
        client.post("/api/presets", headers=auth(token), json={"name": "п", "settings": {}})
        r = client.post("/api/presets", headers=auth(token), json={"name": "п", "settings": {}})
        assert r.status_code == 409

    def test_chuzhoy_preset_ne_viden(self, client):
        a = register(client, "katya2")
        b = register(client, "lena2")
        preset = client.post(
            "/api/presets", headers=auth(a), json={"name": "мой", "settings": {}}
        ).json()

        assert client.get("/api/presets", headers=auth(b)).json() == []
        assert (
            client.delete(f"/api/presets/{preset['id']}", headers=auth(b)).status_code == 404
        )

    def test_udalenie(self, client):
        token = register(client, "marina2")
        preset = client.post(
            "/api/presets", headers=auth(token), json={"name": "на выброс", "settings": {}}
        ).json()

        assert client.delete(f"/api/presets/{preset['id']}", headers=auth(token)).status_code == 204
        assert client.get("/api/presets", headers=auth(token)).json() == []


class TestProgress:
    """Опыт, уровень и серия дней — то, что monkeytype держит в шапке."""

    def test_bez_testov_pervyy_uroven(self, client):
        token = register(client, "nina3")
        r = client.get("/api/results/progress", headers=auth(token))
        assert r.status_code == 200, r.text

        data = r.json()
        assert data["level"] == 1
        assert data["xp"] == 0
        assert data["streak"] == 0
        assert data["words_typed"] == 0

    def test_test_daet_opyt_i_seriyu(self, client):
        token = register(client, "oleg3")
        send_result(client, token, correct=300)

        data = client.get("/api/results/progress", headers=auth(token)).json()
        assert data["xp"] > 0
        # Печатали сегодня, значит серия началась
        assert data["streak"] == 1
        assert data["longest_streak"] == 1
        # 300 верных символов — это 60 слов по мере wpm
        assert data["words_typed"] == 60

    def test_polosa_urovnya_v_predelah(self, client):
        token = register(client, "pavel3")
        send_result(client, token)

        data = client.get("/api/results/progress", headers=auth(token)).json()
        assert 0 <= data["progress"] <= 1
        assert data["xp_in_level"] < data["xp_for_level"]

    def test_trebuet_vhoda(self, client):
        assert client.get("/api/results/progress").status_code == 401


class TestAvatar:
    """Загрузка аватарки через API."""

    PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32

    def test_zagruzka_i_udalenie(self, client):
        token = register(client, "rita4")

        r = client.post(
            "/api/auth/avatar",
            headers=auth(token),
            files={"file": ("avatar.png", self.PNG, "image/png")},
        )
        assert r.status_code == 200, r.text
        assert r.json()["avatar"].startswith("/static/avatars/")

        r = client.delete("/api/auth/avatar", headers=auth(token))
        assert r.status_code == 200
        assert r.json()["avatar"] is None

    def test_ne_kartinku_ne_prinimaet(self, client):
        token = register(client, "semyon4")
        r = client.post(
            "/api/auth/avatar",
            headers=auth(token),
            # Имя и content-type говорят «картинка», а содержимое — нет
            files={"file": ("avatar.png", b"<?php echo 1; ?>", "image/png")},
        )
        assert r.status_code == 422
        assert "картинка" in r.json()["detail"]

    def test_trebuet_vhoda(self, client):
        r = client.post("/api/auth/avatar", files={"file": ("a.png", self.PNG, "image/png")})
        assert r.status_code == 401


class TestResultTagsInList:
    """Метки приезжают вместе с историей, а не отдельным запросом на строку."""

    def test_tegi_v_spiske_istorii(self, client):
        token = register(client, "ulyana5")
        tag = client.post("/api/tags", headers=auth(token), json={"name": "разминка"}).json()
        result = send_result(client, token)
        client.put(
            f"/api/results/{result['id']}/tags",
            headers=auth(token),
            json={"tag_ids": [tag["id"]]},
        )

        rows = client.get("/api/results", headers=auth(token)).json()
        assert [t["name"] for t in rows[0]["tags"]] == ["разминка"]

    def test_bez_tegov_pustoy_spisok(self, client):
        token = register(client, "vadim5")
        send_result(client, token)

        rows = client.get("/api/results", headers=auth(token)).json()
        assert rows[0]["tags"] == []

    def test_chuzhie_tegi_ne_pokazyvayutsya(self, client):
        a = register(client, "wera5")
        b = register(client, "yakov5")
        client.post("/api/tags", headers=auth(a), json={"name": "чужой"})
        send_result(client, b)

        rows = client.get("/api/results", headers=auth(b)).json()
        assert rows[0]["tags"] == []


class TestResultTagFilter:
    """Фильтр истории по меткам. Несколько меток — это «И»."""

    def _tag_result(self, client, token, result_id, tag_ids):
        client.put(
            f"/api/results/{result_id}/tags",
            headers=auth(token),
            json={"tag_ids": tag_ids},
        )

    def test_filtr_po_odnoy_metke(self, client):
        token = register(client, "tagf1")
        tag = client.post("/api/tags", headers=auth(token), json={"name": "утро"}).json()
        помеченный = send_result(client, token)
        send_result(client, token)  # без метки
        self._tag_result(client, token, помеченный["id"], [tag["id"]])

        rows = client.get("/api/results", headers=auth(token), params={"tag_id": tag["id"]})
        assert rows.status_code == 200
        assert [r["id"] for r in rows.json()] == [помеченный["id"]]
        assert rows.headers["X-Total-Count"] == "1"

    def test_dve_metki_eto_peresechenie(self, client):
        token = register(client, "tagf2")
        утро = client.post("/api/tags", headers=auth(token), json={"name": "утро"}).json()
        код = client.post("/api/tags", headers=auth(token), json={"name": "код"}).json()

        обе = send_result(client, token)
        только_утро = send_result(client, token)
        self._tag_result(client, token, обе["id"], [утро["id"], код["id"]])
        self._tag_result(client, token, только_утро["id"], [утро["id"]])

        rows = client.get(
            "/api/results",
            headers=auth(token),
            params=[("tag_id", утро["id"]), ("tag_id", код["id"])],
        ).json()
        # Только результат с обеими метками, «утро»-только сюда не попадает
        assert [r["id"] for r in rows] == [обе["id"]]

    def test_povtor_metki_ne_zavyshaet_schyot(self, client):
        # tag_id=5&tag_id=5 не должен требовать «две пятёрки» и всё отсеять
        token = register(client, "tagf3")
        tag = client.post("/api/tags", headers=auth(token), json={"name": "одна"}).json()
        r = send_result(client, token)
        self._tag_result(client, token, r["id"], [tag["id"]])

        rows = client.get(
            "/api/results",
            headers=auth(token),
            params=[("tag_id", tag["id"]), ("tag_id", tag["id"])],
        ).json()
        assert [x["id"] for x in rows] == [r["id"]]

    def test_chuzhaya_metka_dayot_pustoy_spisok(self, client):
        a = register(client, "tagf4a")
        b = register(client, "tagf4b")
        чужая = client.post("/api/tags", headers=auth(a), json={"name": "чужая"}).json()
        send_result(client, b)

        rows = client.get("/api/results", headers=auth(b), params={"tag_id": чужая["id"]})
        assert rows.json() == []
        assert rows.headers["X-Total-Count"] == "0"


class TestConsistencyVersion:
    """Ровность считается двумя формулами, и версия честно едет с результатом."""

    def _post(self, client, token, **extra):
        body = {
            "correct_chars": 300,
            "incorrect_chars": 0,
            "duration": 60,
            "mode": "time",
            "mode_value": "60",
            "language": "english",
        }
        body.update(extra)
        r = client.post("/api/results", headers=auth(token), json=body)
        assert r.status_code == 201, r.text
        return r.json()

    def test_bez_raw_samples_versiya_odin(self, client):
        token = register(client, "consv1")
        result = self._post(client, token, wpm_samples=[60, 60, 60])
        assert result["consistency_version"] == 1

    def test_s_raw_samples_versiya_dva(self, client):
        token = register(client, "consv2")
        result = self._post(client, token, raw_samples=[60, 60, 60, 60])
        assert result["consistency_version"] == 2

    def test_versiya_dva_perezhivaet_perezagruzku(self, client):
        # Версия должна лежать в базе, а не считаться на лету при выдаче
        token = register(client, "consv3")
        self._post(client, token, raw_samples=[40, 50, 45, 55])
        rows = client.get("/api/results", headers=auth(token)).json()
        assert rows[0]["consistency_version"] == 2

    def test_rovnyy_ryad_rovnee_ryvkov(self, client):
        token = register(client, "consv4")
        ровный = self._post(client, token, raw_samples=[50, 50, 50, 50])
        рваный = self._post(client, token, raw_samples=[10, 90, 20, 80])
        assert ровный["consistency"] > рваный["consistency"]


class TestResultSamples:
    """Посекундные ряды для мини-графика: хранятся, отдаются отдельно, не текут."""

    def _post(self, client, token, **extra):
        body = {
            "correct_chars": 300,
            "incorrect_chars": 0,
            "duration": 60,
            "mode": "time",
            "mode_value": "60",
            "language": "english",
        }
        body.update(extra)
        r = client.post("/api/results", headers=auth(token), json=body)
        assert r.status_code == 201, r.text
        return r.json()

    def test_ryady_sohranyayutsya_i_otdayutsya(self, client):
        token = register(client, "smpl1")
        result = self._post(client, token, wpm_samples=[40, 55, 60], raw_samples=[40, 70, 50])
        got = client.get(f"/api/results/{result['id']}/samples", headers=auth(token)).json()
        assert got == {"wpm": [40, 55, 60], "raw": [40, 70, 50]}

    def test_bez_ryadov_pustye_spiski_a_ne_404(self, client):
        # Старый клиент без посекундных замеров: результат есть, графика нет
        token = register(client, "smpl2")
        result = self._post(client, token, wpm_samples=[], raw_samples=[])
        r = client.get(f"/api/results/{result['id']}/samples", headers=auth(token))
        assert r.status_code == 200
        assert r.json() == {"wpm": [], "raw": []}

    def test_chuzhie_ryady_ne_otdayutsya(self, client):
        a = register(client, "smpl3a")
        b = register(client, "smpl3b")
        result = self._post(client, a, raw_samples=[50, 50])
        r = client.get(f"/api/results/{result['id']}/samples", headers=auth(b))
        assert r.status_code == 404

    def test_nesushchestvuyushchiy_rezultat(self, client):
        token = register(client, "smpl4")
        assert client.get("/api/results/999999/samples", headers=auth(token)).status_code == 404

    def test_ryady_ne_edut_v_obshchem_spiske(self, client):
        # Ряды тяжёлые — в историю их класть нельзя, только по отдельному запросу.
        # Ряд неровный намеренно: ровный отсечёт античит как автонабор.
        token = register(client, "smpl5")
        self._post(client, token, wpm_samples=[45, 58, 61, 59, 63], raw_samples=[45, 72, 61, 40, 68])
        rows = client.get("/api/results", headers=auth(token)).json()
        assert "samples" not in rows[0]


class TestQuotes:
    """Цитаты из файлов monkeytype: длина и поиск."""

    def test_gruppy_dliny_sovpadayut_s_ih_razmetkoy(self, client):
        # Границы в файлах monkeytype: [0,100], [101,300], [301,600], [601,9999]
        limits = {"short": (0, 100), "medium": (101, 300), "long": (301, 600)}

        for name, (low, high) in limits.items():
            r = client.get(f"/api/quotes/english?length={name}")
            assert r.status_code == 200, r.text
            assert low <= r.json()["length"] <= high, name

    def test_slova_razbity_a_ne_odnoy_strokoy(self, client):
        words = client.get("/api/quotes/english").json()["words"]
        assert len(words) > 1
        assert all(" " not in w for w in words)

    def test_nesushchestvuyushchiy_yazyk(self, client):
        assert client.get("/api/quotes/klingon").status_code == 404

    def test_imya_yazyka_proveryaetsya(self, client):
        # Путь к файлу собирается из имени, поэтому обход каталогов
        # должен отсекаться до обращения к диску
        r = client.get("/api/quotes/..%2F..%2Fetc")
        assert r.status_code in (400, 404)

    def test_poisk_nahodit_po_tekstu(self, client):
        found = client.get("/api/quotes/english/search?q=love&limit=5").json()
        assert len(found) > 0
        assert all(
            "love" in q["text"].lower() or "love" in (q["source"] or "").lower()
            for q in found
        )

    def test_poisk_bez_zaprosa_otdaet_nachalo(self, client):
        # Пустой запрос не должен выглядеть как поломка
        found = client.get("/api/quotes/english/search?limit=3").json()
        assert len(found) == 3

    def test_poisk_nichego_ne_nashel(self, client):
        found = client.get("/api/quotes/english/search?q=щщщщщщ").json()
        assert found == []

    def test_predel_vydachi_soblyudaetsya(self, client):
        assert len(client.get("/api/quotes/english/search?q=a&limit=7").json()) == 7

    def test_poisk_filtruet_po_dline(self, client):
        # Тот же фильтр, что у случайной цитаты: короткие не длиннее 100
        found = client.get("/api/quotes/english/search?length=short&limit=10").json()
        assert len(found) > 0
        assert all(q["length"] <= 100 for q in found)

    def test_poisk_dlina_i_zapros_vmeste(self, client):
        found = client.get("/api/quotes/english/search?q=the&length=long&limit=10").json()
        assert all(301 <= q["length"] <= 600 for q in found)
        assert all(
            "the" in q["text"].lower() or "the" in (q["source"] or "").lower() for q in found
        )

    def test_citata_po_id(self, client):
        # Разбивка на слова должна быть одна и та же у поиска и у случайной
        found = client.get("/api/quotes/english/search?limit=1").json()[0]
        r = client.get(f"/api/quotes/english?id={found['id']}")

        assert r.status_code == 200, r.text
        got = r.json()
        assert got["id"] == found["id"]
        assert " ".join(got["words"]) == found["text"]

    def test_nesushchestvuyushchiy_id(self, client):
        assert client.get("/api/quotes/english?id=99999999").status_code == 404


class TestBurstLimit:
    """Порог прироста для гонок: там целого теста ещё нет, проверять нечего."""

    def test_obychnyy_temp_prohodit(self):
        from app.services.anticheat import burst_exceeds_limit

        # 10 символов за секунду это 120 wpm — быстро, но по-человечески
        assert burst_exceeds_limit(10, 1.0) is False

    def test_nevozmozhnyy_temp_lovitsya(self):
        from app.services.anticheat import burst_exceeds_limit

        # 100 символов за секунду — 1200 wpm
        assert burst_exceeds_limit(100, 1.0) is True

    def test_porog_tot_zhe_chto_u_rezultata(self):
        from app.core.config import settings
        from app.services.anticheat import burst_exceeds_limit

        per_second = settings.max_wpm * 5 / 60
        assert burst_exceeds_limit(int(per_second), 1.0) is False
        assert burst_exceeds_limit(int(per_second) + 2, 1.0) is True

    def test_nulevoe_vremya_eto_rassinhron(self):
        from app.services.anticheat import burst_exceeds_limit

        assert burst_exceeds_limit(5, 0) is True
        # Но ноль символов за ноль времени — просто пустое сообщение
        assert burst_exceeds_limit(0, 0) is False

    def test_otricatelnyy_prirost_ne_lovitsya(self):
        from app.services.anticheat import burst_exceeds_limit

        # Стирание даёт отрицательный прирост — это не жульничество
        assert burst_exceeds_limit(-5, 1.0) is False
