"""Проверка API целиком: регистрация, отправка результата, лидерборд, античит."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app

# Отдельная база в памяти, чтобы тесты не трогали рабочую.
# StaticPool обязателен: без него каждое соединение получает свою пустую
# in-memory базу, и таблицы, созданные в фикстуре, не видны запросам.
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture()
def client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


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
