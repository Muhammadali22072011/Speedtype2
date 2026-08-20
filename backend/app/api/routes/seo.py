"""robots.txt, sitemap.xml и список маршрутов для клиентского роутера.

Всё генерируется из ``app.core.seo.PAGES``, а не пишется руками: иначе
при добавлении страницы карта сайта устаревает молча, и заметить это
можно только через месяц в Search Console.

Роутер подключается без префикса — ``/robots.txt`` и ``/sitemap.xml``
поисковики ищут строго в корне.
"""

from __future__ import annotations

from xml.etree import ElementTree as ET

from fastapi import APIRouter, Response

from app.core import seo
from app.core.config import settings

router = APIRouter(tags=["seo"])


@router.get("/robots.txt", include_in_schema=False)
def robots_txt() -> Response:
    """Что можно обходить, а что незачем.

    Закрываем приватное (профиль), служебное (вход, регистрация,
    настройки) и техническое (api и его документация). Всё это не контент,
    и в индексе ему делать нечего.
    """
    base = settings.site_url.rstrip("/")

    lines = ["User-agent: *", "Allow: /"]
    lines += [f"Disallow: {path}" for path, meta in seo.PAGES.items() if not meta.index]
    lines += ["Disallow: /api/", "Disallow: /docs", "Disallow: /redoc", "Disallow: /openapi.json"]
    lines += ["", f"Sitemap: {base}/sitemap.xml", ""]

    return Response("\n".join(lines), media_type="text/plain; charset=utf-8")


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml() -> Response:
    """Карта сайта: только те страницы, которым место в индексе."""
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    for path, meta in seo.PAGES.items():
        if not meta.index:
            continue
        url = ET.SubElement(urlset, "url")
        ET.SubElement(url, "loc").text = seo.canonical_url(path)
        ET.SubElement(url, "changefreq").text = meta.changefreq
        ET.SubElement(url, "priority").text = meta.priority

    body = ET.tostring(urlset, encoding="unicode", xml_declaration=True)
    return Response(body, media_type="application/xml; charset=utf-8")


@router.get("/api/seo/routes", include_in_schema=False)
def seo_routes() -> dict[str, dict[str, str]]:
    """Заголовки страниц для клиентского роутера.

    В продакшене этот список приходит инлайном в html и запроса не
    требует. Эндпоинт нужен только в dev, где страницу раздаёт Vite
    и подстановки в ``<head>`` не происходит.
    """
    return seo.routes_payload()
