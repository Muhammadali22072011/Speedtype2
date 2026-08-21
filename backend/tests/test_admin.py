"""Админка: доступ по окружению, блокировки, модерация цитат, сводка.

Роль администратора задаётся списком ADMIN_USERNAMES. В тестах правим тот же
объект настроек, что читает проверка доступа, — так проверяется именно она,
а не подстроенный флаг в базе.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Language, Quote, Word


def register(client, username, password="secret123"):
    r = client.post(
        "/api/auth/register",
        json={"username": username, "email": f"{username}@test.local", "password": password},
    )
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def make_admin(monkeypatch):
    """Сделать перечисленные имена администраторами на время теста."""

    def _make(*usernames):
        monkeypatch.setattr(settings, "admin_usernames", ",".join(usernames))

    return _make


def seed_english():
    """Завести английский язык со словами — цитаты привязываются к языку."""
    with SessionLocal() as db:
        if db.scalar(select(Language).where(Language.name == "english")) is None:
            lang = Language(name="english", display_name="english")
            db.add(lang)
            db.flush()
            db.add_all([Word(language_id=lang.id, word=w) for w in ("one", "two", "three")])
            db.commit()


class TestAccess:
    def test_ne_admin_poluchaet_403(self, client, make_admin):
        make_admin("boss")
        token = register(client, "someone")
        assert client.get("/api/admin/users", headers=auth(token)).status_code == 403

    def test_bez_vhoda_401(self, client, make_admin):
        make_admin("boss")
        assert client.get("/api/admin/users").status_code == 401

    def test_admin_prohodit(self, client, make_admin):
        make_admin("boss")
        token = register(client, "boss")
        assert client.get("/api/admin/users", headers=auth(token)).status_code == 200


class TestUsers:
    def test_spisok_s_poiskom_i_schyotom(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        register(client, "alice")
        register(client, "bob")

        # тест засчитается alice, чтобы проверить счётчик
        a = None
        for tok, name in [(admin, "boss")]:
            pass
        alice_tok = client.post(
            "/api/auth/login", json={"username": "alice", "password": "secret123"}
        ).json()["access_token"]
        client.post(
            "/api/results",
            headers=auth(alice_tok),
            json={"correct_chars": 300, "incorrect_chars": 0, "duration": 60,
                  "wpm_samples": [50, 55, 60], "mode": "time", "mode_value": "60", "language": "english"},
        )

        r = client.get("/api/admin/users", headers=auth(admin), params={"q": "alic"})
        assert r.status_code == 200
        rows = r.json()
        assert [u["username"] for u in rows] == ["alice"]
        assert rows[0]["tests"] == 1
        assert r.headers["X-Total-Count"] == "1"

    def test_blokirovka_zakryvaet_vhod_i_token(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        victim = register(client, "victim")
        vid = client.get("/api/admin/users", headers=auth(admin), params={"q": "victim"}).json()[0]["id"]

        # заблокировали
        assert client.post(f"/api/admin/users/{vid}/block", headers=auth(admin)).status_code == 200
        # старый токен больше не работает
        assert client.get("/api/auth/me", headers=auth(victim)).status_code == 401
        # войти заново нельзя
        r = client.post("/api/auth/login", json={"username": "victim", "password": "secret123"})
        assert r.status_code == 403
        # разблокировали — вход снова открыт
        assert client.post(f"/api/admin/users/{vid}/unblock", headers=auth(admin)).status_code == 200
        assert client.post(
            "/api/auth/login", json={"username": "victim", "password": "secret123"}
        ).status_code == 200

    def test_nelzya_nad_soboy(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        me = client.get("/api/admin/users", headers=auth(admin)).json()[0]
        assert client.post(f"/api/admin/users/{me['id']}/block", headers=auth(admin)).status_code == 400

    def test_nelzya_nad_drugim_adminom(self, client, make_admin):
        make_admin("boss", "second")
        admin = register(client, "boss")
        register(client, "second")
        sid = client.get("/api/admin/users", headers=auth(admin), params={"q": "second"}).json()[0]["id"]
        assert client.post(f"/api/admin/users/{sid}/block", headers=auth(admin)).status_code == 400

    def test_sbros_rezultatov(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        user = register(client, "player")
        client.post(
            "/api/results",
            headers=auth(user),
            json={"correct_chars": 300, "incorrect_chars": 0, "duration": 60,
                  "wpm_samples": [50, 55, 60], "mode": "time", "mode_value": "60", "language": "english"},
        )
        uid = client.get("/api/admin/users", headers=auth(admin), params={"q": "player"}).json()[0]["id"]
        assert client.delete(f"/api/admin/users/{uid}/results", headers=auth(admin)).status_code == 204
        assert client.get("/api/results", headers=auth(user)).json() == []

    def test_udalenie_polzovatelya(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        register(client, "goner")
        uid = client.get("/api/admin/users", headers=auth(admin), params={"q": "goner"}).json()[0]["id"]
        assert client.delete(f"/api/admin/users/{uid}", headers=auth(admin)).status_code == 204
        # его больше нет в списке
        assert client.get("/api/admin/users", headers=auth(admin), params={"q": "goner"}).json() == []


class TestQuoteModeration:
    def test_zayavka_popadaet_v_ochered(self, client, make_admin):
        seed_english()
        make_admin("boss")
        admin = register(client, "boss")
        author = register(client, "author")

        r = client.post(
            "/api/quotes",
            headers=auth(author),
            json={"text": "цитата достаточной длины для проверки", "source": "тест", "language": "english"},
        )
        assert r.status_code == 201
        assert r.json()["status"] == "pending"

        queue = client.get("/api/admin/quotes", headers=auth(admin)).json()
        assert len(queue) == 1
        assert queue[0]["text"] == "цитата достаточной длины для проверки"
        assert queue[0]["submitted_by"] == "author"

    def test_odobrennaya_popadaet_v_vydachu(self, client, make_admin):
        seed_english()
        make_admin("boss")
        admin = register(client, "boss")
        author = register(client, "author2")

        qid = client.post(
            "/api/quotes",
            headers=auth(author),
            json={"text": "уникальная одобряемая цитата достаточной длины", "language": "english"},
        ).json()["id"]

        # до одобрения — поиск её не находит
        found = client.get("/api/quotes/english/search", params={"q": "одобряемая"}).json()
        assert found == []

        assert client.post(f"/api/admin/quotes/{qid}/approve", headers=auth(admin)).status_code == 204

        found = client.get("/api/quotes/english/search", params={"q": "одобряемая"}).json()
        assert len(found) == 1
        assert "одобряемая" in found[0]["text"]

    def test_otklonenie_ne_udalyaet_i_pishet_prichinu(self, client, make_admin):
        seed_english()
        make_admin("boss")
        admin = register(client, "boss")
        author = register(client, "author3")
        qid = client.post(
            "/api/quotes",
            headers=auth(author),
            json={"text": "цитата которую отклонят с причиной подробно", "language": "english"},
        ).json()["id"]

        assert client.post(
            f"/api/admin/quotes/{qid}/reject",
            headers=auth(admin),
            json={"reason": "дубликат"},
        ).status_code == 204

        rejected = client.get(
            "/api/admin/quotes", headers=auth(admin), params={"status": "rejected"}
        ).json()
        assert len(rejected) == 1
        assert rejected[0]["rejection_reason"] == "дубликат"
        # в выдачу не попала
        assert client.get("/api/quotes/english/search", params={"q": "отклонят"}).json() == []


class TestQuoteReports:
    def test_zhaloba_na_faylovuyu_citatu(self, client, make_admin):
        # Файловые цитаты в базе не лежат — жалоба должна сохраниться снимком.
        # english есть в файлах статик; берём случайную и жалуемся по её id.
        make_admin("boss")
        admin = register(client, "boss")
        user = register(client, "reader")

        quote = client.get("/api/quotes/english").json()
        qid = quote["id"]
        r = client.post(
            f"/api/quotes/{qid}/report",
            headers=auth(user),
            json={"language": "english", "reason": "опечатка в тексте"},
        )
        assert r.status_code == 201

        reports = client.get("/api/admin/reports", headers=auth(admin)).json()
        assert len(reports) == 1
        assert reports[0]["reason"] == "опечатка в тексте"
        assert reports[0]["reported_by"] == "reader"
        assert reports[0]["text"]  # снимок текста сохранён

    def test_povtornaya_zhaloba_ne_kopitsya(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        user = register(client, "reader2")
        qid = client.get("/api/quotes/english").json()["id"]
        body = {"language": "english", "reason": "плохая цитата"}
        client.post(f"/api/quotes/{qid}/report", headers=auth(user), json=body)
        second = client.post(f"/api/quotes/{qid}/report", headers=auth(user), json=body)
        assert second.json()["status"] == "already_reported"
        assert len(client.get("/api/admin/reports", headers=auth(admin)).json()) == 1

    def test_razbor_zhaloby(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        user = register(client, "reader3")
        qid = client.get("/api/quotes/english").json()["id"]
        client.post(
            f"/api/quotes/{qid}/report",
            headers=auth(user),
            json={"language": "english", "reason": "неверный источник"},
        )
        rid = client.get("/api/admin/reports", headers=auth(admin)).json()[0]["id"]
        assert client.post(f"/api/admin/reports/{rid}/resolve", headers=auth(admin)).status_code == 204
        # из очереди неразобранных ушла
        assert client.get("/api/admin/reports", headers=auth(admin)).json() == []
        # но видна среди разобранных
        assert len(client.get("/api/admin/reports", headers=auth(admin), params={"resolved": "true"}).json()) == 1


class TestSummary:
    def test_svodka_schitaet(self, client, make_admin):
        make_admin("boss")
        admin = register(client, "boss")
        user = register(client, "typist")
        client.post(
            "/api/results",
            headers=auth(user),
            json={"correct_chars": 300, "incorrect_chars": 0, "duration": 60,
                  "wpm_samples": [50, 55, 60], "mode": "time", "mode_value": "60", "language": "english"},
        )
        s = client.get("/api/admin/summary", headers=auth(admin)).json()
        assert s["users_total"] == 2
        assert s["results_total"] == 1
        assert s["anticheat"]["accepted"] >= 1
        assert 0.0 <= s["anticheat"]["reject_rate"] <= 1.0
        assert "live_rooms" in s
