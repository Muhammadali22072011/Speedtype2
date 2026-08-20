"""Настройки приложения. Читаются из окружения или .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Speedtype"
    debug: bool = True

    # Тот же ключ используется для подписи JWT, в продакшене задать через окружение
    secret_key: str = "dev-secret-change-me"
    access_token_ttl_minutes: int = 60 * 24 * 7

    database_url: str = f"sqlite:///{BASE_DIR / 'speedtype.db'}"

    # Откуда разрешено ходить фронтенду в dev-режиме
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # Пределы, за которыми результат считается недостоверным
    max_wpm: float = 300.0
    max_test_duration: int = 3600

    # Канонический адрес сайта — единственное место, где записан домен.
    # Отсюда берутся canonical, og:url, sitemap.xml и robots.txt.
    # Без слеша на конце: к нему всегда дописывается путь.
    site_url: str = "https://speedtype.izzatullaev.uz"

    # Собранный фронтенд. Его отдаёт catch-all, он же источник index.html
    # для подстановки мета-тегов. В dev папки может не быть — это нормально,
    # там страницу раздаёт Vite.
    frontend_dist: Path = BASE_DIR.parent / "frontend" / "dist"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
