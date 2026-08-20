"""Точка входа FastAPI."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import assets, auth, leaderboard, race, results, text
from app.api.routes.seo import router as seo_router
from app.core import seo
from app.core.config import settings
from app.db.session import Base, engine
from app.models import Language, Quote, Result, User, Word  # noqa: F401  — регистрирует таблицы


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="Тренажёр слепой печати. Метрики считает сервер, клиент присылает только сырые счётчики.",
    lifespan=lifespan,
)

# Сжатия не было вовсе: список тем уезжал клиенту как 62 КБ текста.
# minimum_size — чтобы не тратить процессор на короткие json-ответы.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(leaderboard.router, prefix="/api")
app.include_router(text.router, prefix="/api")
app.include_router(race.router, prefix="/api")
app.include_router(assets.router, prefix="/api")

# Без префикса: robots.txt и sitemap.xml поисковики ищут строго в корне
app.include_router(seo_router)

class DataStatic(StaticFiles):
    """Словари, темы, раскладки и звуки из monkeytype.

    Файлы взяты из чужого репозитория и не меняются, но хеша в имени
    у них нет — поэтому не год и не immutable, а месяц с обычной
    перепроверкой. Раньше заголовка не было совсем, и браузер ходил
    за каждым файлом заново.
    """

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=2592000"
        return response


# Языки, цитаты, раскладки, звуки и css тем раздаются как обычные файлы
app.mount("/static", DataStatic(directory=assets.STATIC_DIR), name="static")


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Раздача фронтенда ---------------------------------------------------
#
# Всё, что ниже, должно оставаться в конце файла: Starlette подбирает
# маршруты в порядке регистрации, и catch-all перехватит /api и /static,
# если объявить его выше.

DIST_DIR = settings.frontend_dist


class HashedStatic(StaticFiles):
    """Файлы сборки: имена с хешем, поэтому кешируются навсегда.

    Меняется содержимое — меняется имя, так что инвалидация не нужна
    и годовой срок безопасен.
    """

    def file_response(self, *args, **kwargs) -> Response:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# В dev папки нет — фронтенд раздаёт Vite, и это нормально
if (DIST_DIR / "assets").is_dir():
    app.mount("/assets", HashedStatic(directory=DIST_DIR / "assets"), name="assets")


def _dist_file(relative: str) -> Path | None:
    """Файл из корня сборки — или None, если такого файла нет.

    Сюда попадают favicon, картинка превью, манифест и шрифты: Vite
    складывает содержимое ``public/`` в корень ``dist``, и запрос
    ``/favicon.ico`` доходит до catch-all.

    Путь обязательно проверяется на выход за пределы ``dist``: ``full_path``
    приходит от клиента, и без проверки ``../../`` отдал бы что угодно
    с диска.
    """
    if not relative:
        return None

    # Служебные папки сборки наружу не отдаём: в .vite лежит манифест,
    # он нужен бэкенду, а не браузеру
    if relative.startswith(".") or "/." in relative:
        return None

    root = DIST_DIR.resolve()
    candidate = (root / relative).resolve()

    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str, request: Request) -> Response:
    """Отдать оболочку SPA с мета-тегами под конкретный маршрут.

    Клиентских маршрутов у фронтенда семь, и до этой правки прямой заход
    на любой из них возвращал 404 — бэкенд про них не знал.

    Код ответа честный: известный маршрут — 200, неизвестный — 404.
    Оболочка в обоих случаях одна и та же, страницу «такой страницы нет»
    рисует сам SPA. Отдавать на несуществующий адрес 200 нельзя: поиск
    считает это soft 404 и понижает сайт.
    """
    path = "/" + full_path

    # /leaderboard/ и /leaderboard — одна страница. Оставляем вариант
    # без слеша, параметры запроса сохраняем.
    if len(path) > 1 and path.endswith("/"):
        target = path.rstrip("/")
        if request.url.query:
            target = f"{target}?{request.url.query}"
        return RedirectResponse(target, status_code=301)

    # Оболочка доступна по одному адресу, а не по двум
    if path == "/index.html":
        return RedirectResponse("/", status_code=301)

    file = _dist_file(full_path)
    if file is not None:
        # Шрифты не меняются годами, иконки и картинка превью — изредка
        long_lived = file.suffix in {".woff2", ".woff", ".ttf"}
        return FileResponse(
            file,
            headers={"Cache-Control": f"public, max-age={31536000 if long_lived else 86400}"},
        )

    index = DIST_DIR / "index.html"
    if not index.is_file():
        return PlainTextResponse(
            "Фронтенд не собран. Выполните: cd frontend && npm run build\n"
            f"Ожидался файл: {index}",
            status_code=503,
        )

    meta = seo.PAGES.get(path)
    body = seo.render(index.read_text(encoding="utf-8"), path, meta or seo.NOT_FOUND)

    return HTMLResponse(
        body,
        status_code=200 if meta else 404,
        # Оболочка одна на всех, но <head> в ней разный — прокси не должен
        # раздать всем страницу, собранную для одного маршрута
        headers={"Cache-Control": "no-cache"},
    )
