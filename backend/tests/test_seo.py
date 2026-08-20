"""Проверка того, что видит поисковик: коды ответов, мета-теги, robots, карта сайта.

Всё это ломается молча. Заголовок, подставленный не в ту страницу, или 200
вместо 404 в браузере выглядят нормально — заметно только через месяц
в Search Console. Поэтому проверяем сырой html, а не отрисованную страницу.
"""

from __future__ import annotations

import json
import re
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app.core import seo
from app.core.config import settings
from app.main import DIST_DIR, app

# Оболочка, максимально похожая на настоящую: свои title и description,
# которые подстановка обязана убрать
SHELL = """<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>speedtype</title>
    <meta name="description" content="заглушка для dev" />
  </head>
  <body><div id="app"></div></body>
</html>
"""

needs_dist = pytest.mark.skipif(
    not (DIST_DIR / "index.html").is_file(),
    reason="фронтенд не собран: cd frontend && npm run build",
)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


# --- подстановка мета-тегов ------------------------------------------------


def test_render_replaces_shell_title():
    """Заглушка из index.html заменяется, а не дополняется."""
    html = seo.render(SHELL, "/", seo.PAGES["/"])

    assert html.count("<title>") == 1
    assert "<title>speedtype</title>" not in html
    assert seo.PAGES["/"].title in html
    assert "заглушка для dev" not in html


def test_render_keeps_charset_in_first_kilobyte():
    """Кодировку положено объявить до любого текста, а заголовки у нас русские."""
    html = seo.render(SHELL, "/", seo.PAGES["/"])
    assert 0 <= html.index("<meta charset") <= 1024


def test_render_survives_shell_without_head():
    """Оболочки без <head> быть не должно, но теги терять нельзя."""
    html = seo.render("<html><body></body></html>", "/", seo.PAGES["/"])
    assert seo.PAGES["/"].title in html


def test_noindex_pages_are_marked():
    html = seo.render(SHELL, "/profile", seo.PAGES["/profile"])
    assert 'content="noindex, follow"' in html


def test_not_found_has_no_address():
    """У несуществующей страницы нет ни канонического адреса, ни og:url."""
    html = seo.render(SHELL, "/такого-нет", seo.NOT_FOUND)

    assert "rel=\"canonical\"" not in html
    assert 'property="og:url"' not in html


def test_dangerous_path_is_escaped():
    """Путь приходит от клиента и попадать в html как есть не должен."""
    html = seo.render(SHELL, '/"><script>alert(1)</script>', seo.PAGES["/"])
    assert "<script>alert(1)</script>" not in html


# --- сами мета-данные ------------------------------------------------------


@pytest.mark.parametrize("path", list(seo.PAGES))
def test_titles_fit_in_search_results(path):
    """Длиннее 60 символов поиск обрежет многоточием."""
    assert len(seo.PAGES[path].title) <= 60


@pytest.mark.parametrize("path", [p for p, m in seo.PAGES.items() if m.index])
def test_indexed_pages_have_usable_description(path):
    """Для страниц в выдаче описание должно быть содержательным."""
    assert 140 <= len(seo.PAGES[path].description) <= 160


def test_every_page_has_its_own_title():
    """Одинаковые заголовки склеивают страницы в одну с точки зрения поиска."""
    titles = [meta.title for meta in seo.PAGES.values()]
    assert len(titles) == len(set(titles))


def test_canonical_is_absolute_and_normalised():
    assert seo.canonical_url("/") == settings.site_url.rstrip("/") + "/"
    assert seo.canonical_url("/race/") == seo.canonical_url("/race")
    assert seo.canonical_url("/race").startswith("https://")


def test_client_route_list_covers_pages_and_404():
    payload = seo.routes_payload()
    assert set(seo.PAGES) <= set(payload)
    assert "/404" in payload


# --- структурированные данные ---------------------------------------------


def test_home_jsonld_is_valid():
    html = seo.render(SHELL, "/", seo.PAGES["/"])
    raw = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
    assert raw, "на главной нет структурированных данных"

    data = json.loads(raw.group(1))
    assert data["@context"] == "https://schema.org"
    assert data["@type"] == "WebApplication"
    assert data["url"] == seo.canonical_url("/")


def test_jsonld_only_where_there_is_something_to_say():
    """Разметка под каждую страницу подряд — это шум, а не польза."""
    assert seo.jsonld_for("/settings") is None


# --- robots и карта сайта --------------------------------------------------


def test_robots_closes_private_pages(client):
    body = client.get("/robots.txt").text

    for path, meta in seo.PAGES.items():
        if not meta.index:
            assert f"Disallow: {path}" in body

    assert "Disallow: /api/" in body
    assert f"Sitemap: {settings.site_url.rstrip('/')}/sitemap.xml" in body


def test_sitemap_lists_only_indexed_pages(client):
    response = client.get("/sitemap.xml")
    assert response.status_code == 200

    root = ET.fromstring(response.text)
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    listed = {url.findtext("s:loc", namespaces=namespace) for url in root.findall("s:url", namespace)}

    assert listed == {seo.canonical_url(p) for p, m in seo.PAGES.items() if m.index}
    for path, meta in seo.PAGES.items():
        if not meta.index:
            assert seo.canonical_url(path) not in listed


# --- ответы бэкенда --------------------------------------------------------


@needs_dist
@pytest.mark.parametrize("path", list(seo.PAGES))
def test_client_routes_open_directly(client, path):
    """До появления catch-all прямой заход на маршрут отдавал 404 — включая главную."""
    response = client.get(path)

    assert response.status_code == 200
    assert seo.PAGES[path].title in response.text


@needs_dist
def test_unknown_path_is_honestly_404(client):
    """200 на несуществующем адресе — soft 404, за него понижают."""
    response = client.get("/такой-страницы-нет")

    assert response.status_code == 404
    assert seo.NOT_FOUND.title in response.text


@needs_dist
def test_trailing_slash_redirects_once(client):
    response = client.get("/race/", follow_redirects=False)

    assert response.status_code == 301
    assert response.headers["location"] == "/race"


@needs_dist
def test_trailing_slash_keeps_query(client):
    response = client.get("/race/?code=ABC", follow_redirects=False)
    assert response.headers["location"] == "/race?code=ABC"


@needs_dist
def test_index_html_has_one_address(client):
    response = client.get("/index.html", follow_redirects=False)

    assert response.status_code == 301
    assert response.headers["location"] == "/"


@needs_dist
@pytest.mark.parametrize(
    "path",
    ["/../backend/speedtype.db", "/fonts/../../../app/core/config.py"],
)
def test_catch_all_does_not_leave_dist(client, path):
    """full_path приходит от клиента: без проверки отдали бы что угодно с диска."""
    assert client.get(path).status_code == 404


def test_api_still_wins_over_catch_all(client):
    """Catch-all зарегистрирован последним — /api обязан доходить до своего роутера."""
    assert client.get("/api/health").json() == {"status": "ok"}
