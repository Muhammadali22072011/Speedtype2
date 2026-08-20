"""Мета-данные страниц — один словарь на весь сайт.

Отсюда берут данные четыре места: подстановка ``<head>`` в catch-all,
``robots.txt``, ``sitemap.xml`` и список заголовков для клиентского роутера.
Добавить страницу значит дописать одну запись, а не править четыре файла.

Почему это на бэкенде, а не на клиенте. Фронтенд — SPA: в ``index.html``
лежит пустой ``<div id="app">``, всё рисует js. Краулер Яндекса выполняет
js плохо, а скребки превью в Telegram, WhatsApp, Discord и Twitter
не выполняют его вовсе. Для них существует только то, что пришло
в ответе сервера. Поэтому ``<head>`` собирается здесь.

Домен не хардкодится: он лежит в ``settings.site_url`` и читается
из окружения.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.core.config import settings


@dataclass(frozen=True)
class PageMeta:
    """Что поисковик должен знать о странице."""

    title: str
    description: str
    # index=False убирает страницу и из карты сайта, и из индекса.
    # Приватным и служебным страницам в выдаче делать нечего.
    index: bool = True
    # У страницы 404 канонического адреса нет: указывать им на самих себя
    # значит объявлять несуществующий адрес существующим.
    canonical: bool = True
    changefreq: str = "monthly"
    priority: str = "0.5"


# Порядок записей = порядок в sitemap.xml, поэтому важное сверху.
PAGES: dict[str, PageMeta] = {
    "/": PageMeta(
        title="Тест скорости печати онлайн — Speedtype",
        description=(
            "Проверьте скорость печати вслепую за минуту. Сервер считает wpm, "
            "точность и ровность по каждому нажатию. Больше 400 языков, без регистрации."
        ),
        changefreq="weekly",
        priority="1.0",
    ),
    "/leaderboard": PageMeta(
        title="Рейтинг скорости печати — Speedtype",
        description=(
            "Таблица лучших результатов: скорость, точность и ровность печати. "
            "Посмотрите, как ваш результат выглядит рядом с остальными и куда расти дальше."
        ),
        changefreq="daily",
        priority="0.8",
    ),
    "/race": PageMeta(
        title="Гонки по печати с друзьями — Speedtype",
        description=(
            "Печатайте наперегонки: создайте комнату, отправьте код друзьям и следите "
            "за чужим прогрессом вживую. Один текст на всех, результат считает сервер."
        ),
        changefreq="monthly",
        priority="0.8",
    ),
    "/guide": PageMeta(
        title="Как научиться печатать вслепую — Speedtype",
        description=(
            "Постановка рук на домашнем ряду, распределение пальцев, план занятий "
            "на четыре недели и пять ошибок, из-за которых скорость упирается в потолок."
        ),
        priority="0.9",
    ),
    "/norms": PageMeta(
        title="Какая скорость печати нормальная — Speedtype",
        description=(
            "Таблица уровней от 20 до 120 слов в минуту с пересчётом в знаки. "
            "Средний результат, почему точность важнее скорости и от чего зависит цифра."
        ),
        priority="0.9",
    ),
    "/faq": PageMeta(
        title="Что такое wpm, raw и ровность — Speedtype",
        description=(
            "Как считаются скорость, точность и ровность печати, чем raw отличается "
            "от wpm и почему все показатели вычисляет сервер, а не браузер. Разбор формул."
        ),
        priority="0.7",
    ),
    "/russian": PageMeta(
        title="Тест скорости печати на русском — Speedtype",
        description=(
            "Проверка скорости на раскладке ЙЦУКЕН: словари от 200 слов до 50 тысяч. "
            "Почему на русском результат ниже английского и что мешает именно здесь."
        ),
        priority="0.8",
    ),
    # Текст страницы на узбекском — она ловит узбекские запросы,
    # и заголовок с описанием должны быть на том же языке, что содержимое
    "/uzbek": PageMeta(
        title="Klaviatura tezligi testi o'zbek tilida — Speedtype",
        description=(
            "Yozish tezligingizni o'zbek tilida tekshiring: 196 ta keng tarqalgan so'z, "
            "kengaytirilgan lug'atlar, wpm va aniqlik hisobi. Ro'yxatdan o'tmasdan."
        ),
        priority="0.8",
    ),
    "/about": PageMeta(
        title="О проекте — Speedtype",
        description=(
            "Чем Speedtype отличается от других тренажёров, как считаются wpm, "
            "точность и ровность, и почему все показатели считает сервер, а не браузер."
        ),
        priority="0.6",
    ),
    "/settings": PageMeta(
        title="Настройки — Speedtype",
        description="Язык, режим теста, тема, звук нажатий, раскладка и поведение каретки.",
        index=False,
    ),
    "/profile": PageMeta(
        title="Профиль — Speedtype",
        description="История тестов, средняя скорость и точность, личные рекорды.",
        index=False,
    ),
    "/login": PageMeta(
        title="Вход — Speedtype",
        description="Вход в аккаунт, чтобы результаты сохранялись, а прогресс был виден.",
        index=False,
    ),
    "/register": PageMeta(
        title="Регистрация — Speedtype",
        description="Создайте аккаунт, чтобы сохранять результаты и следить за прогрессом.",
        index=False,
    ),
    # Служебная страница дизайн-системы: все токены и все состояния каждого
    # компонента на текущей теме. Нужна разработке, не читателю, поэтому
    # ни в индексе, ни в карте сайта её быть не должно.
    "/styleguide": PageMeta(
        title="Стайлгайд — Speedtype",
        description="Токены и компоненты интерфейса во всех состояниях. Служебная страница.",
        index=False,
        canonical=False,
    ),
}

# Отдаётся вместе с кодом 404. В индекс, разумеется, не идёт.
NOT_FOUND = PageMeta(
    title="Страница не найдена — Speedtype",
    description="Такой страницы нет. Вернитесь к тесту скорости печати.",
    index=False,
    canonical=False,
)


def canonical_url(path: str) -> str:
    """Абсолютный адрес страницы.

    Без параметров и без слеша на конце — иначе ``/leaderboard``,
    ``/leaderboard/`` и ``/leaderboard?x=1`` станут тремя страницами
    с одинаковым содержимым.
    """
    clean = "/" + path.strip("/")
    return settings.site_url.rstrip("/") + clean


def _attr(value: str) -> str:
    """Экранирование для значения html-атрибута."""
    return html.escape(value, quote=True)


def routes_payload() -> dict[str, dict[str, str]]:
    """Заголовки и описания для клиентского роутера.

    Клиент меняет ``document.title`` при переходах внутри SPA. Держать
    для этого второй список на фронтенде нельзя — разъедется с этим.

    ``/404`` добавлен отдельно: в ``PAGES`` его нет и быть не должно,
    иначе он попадёт в карту сайта, но заголовок клиенту нужен.
    """
    payload = {path: {"title": meta.title, "description": meta.description} for path, meta in PAGES.items()}
    payload["/404"] = {"title": NOT_FOUND.title, "description": NOT_FOUND.description}
    return payload


# Картинка превью. Одна на весь сайт: отдельная под каждую страницу
# имела бы смысл, будь страницы визуально разными, а они не разные.
OG_IMAGE = "/og.png"
OG_IMAGE_WIDTH = "1200"
OG_IMAGE_HEIGHT = "630"
OG_IMAGE_ALT = "Speedtype — тест скорости печати"


DATA_DIR = Path(__file__).resolve().parents[1] / "data"

# Шаги гайда. Дублируют по смыслу текст страницы /guide — разметка обязана
# соответствовать видимому содержимому, иначе она считается недостоверной.
GUIDE_STEPS: list[tuple[str, str]] = [
    (
        "Поставьте руки на домашний ряд",
        "Левая рука на ФЫВА, правая на ОЛДЖ, большие пальцы на пробеле. "
        "На клавишах А и О есть засечки — по ним руки возвращаются на место вслепую.",
    ),
    (
        "Неделя первая: только средний ряд",
        "Отрабатывайте ФЫВА и ОЛДЖ, не глядя на клавиатуру. Скорость не смотрите вообще: "
        "задача — приучить пальцы возвращаться домой после каждого нажатия.",
    ),
    (
        "Неделя вторая: верхний ряд",
        "Добавьте ЙЦУКЕН и НГШЩЗХ. Здесь сильнее всего тянет подглядеть — вместо этого "
        "сбавьте темп до скорости, на которой ошибок почти нет.",
    ),
    (
        "Неделя третья: нижний ряд и знаки",
        "Освойте ЯЧСМИТЬ и БЮ, включите в тесте пунктуацию. Без знаков препинания "
        "навык остаётся неполным, а на них скорость проседает сильнее всего.",
    ),
    (
        "Неделя четвёртая: скорость",
        "Только теперь начинайте следить за wpm. Держите точность выше 95%: "
        "быстро набранный текст с ошибками закрепляет неправильные движения.",
    ),
]


@lru_cache
def _faq_items() -> list[dict[str, str]]:
    """Вопросы и ответы для разметки FAQPage.

    Тот же файл импортирует страница ``/faq`` на сборке фронтенда.
    Держать две копии нельзя: размеченный текст обязан совпадать
    с видимым, а разошлись бы они молча.
    """
    path = DATA_DIR / "faq.json"
    if not path.is_file():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def jsonld_for(path: str) -> dict | None:
    """Структурированные данные страницы.

    Только там, где есть что сказать правдой. Размечать несуществующее
    (например ``SearchAction`` при отсутствии поиска) нельзя: невалидная
    или лживая разметка хуже, чем никакой.

    Оговорка про FAQPage и HowTo: расширенные результаты по ним Google
    в 2023 году убрал — FAQ оставлен только государственным и медицинским
    сайтам, HowTo снят совсем. Разметка здесь валидна и может пригодиться
    другим поисковикам, но обещать по ней «звёздочки в выдаче Google»
    было бы враньём.
    """
    if path == "/guide":
        return {
            "@context": "https://schema.org",
            "@type": "HowTo",
            "name": "Как научиться печатать вслепую",
            "description": PAGES["/guide"].description,
            "inLanguage": "ru",
            "totalTime": "P4W",
            "step": [
                {
                    "@type": "HowToStep",
                    "position": position,
                    "name": name,
                    "text": text,
                    "url": canonical_url("/guide") + f"#step{position}",
                }
                for position, (name, text) in enumerate(GUIDE_STEPS, start=1)
            ],
        }

    if path == "/faq":
        items = _faq_items()
        if not items:
            return None
        return {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "inLanguage": "ru",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": item["q"],
                    "acceptedAnswer": {"@type": "Answer", "text": item["a"]},
                }
                for item in items
            ],
        }

    if path != "/":
        return None

    return {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Speedtype",
        "url": canonical_url("/"),
        "description": PAGES["/"].description,
        "applicationCategory": "EducationalApplication",
        "operatingSystem": "Web",
        "inLanguage": "ru",
        "isAccessibleForFree": True,
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
        "featureList": [
            "Тест скорости печати на время и на количество слов",
            "Подсчёт wpm, точности и ровности на сервере",
            "Онлайн-гонки с друзьями",
            "Больше 400 языков и 187 тем оформления",
        ],
    }


@lru_cache
def _vite_manifest() -> dict[str, dict]:
    """Манифест сборки: исходный файл → имя чанка с хешем.

    Кэшируется на всё время работы процесса, поэтому после пересборки
    фронтенда сервер надо перезапустить. Для прода это нормально —
    выкладка и так перезапускает службу.
    """
    path = settings.frontend_dist / ".vite" / "manifest.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def page_chunk(path: str) -> str | None:
    """Файл сборки, который понадобится этому маршруту.

    Страницы грузятся динамическим ``import()``, поэтому чанк
    запрашивается только после того, как отработал основной бандл —
    контент появляется позже первой отрисовки и двигает вёрстку.
    ``modulepreload`` заставляет браузер начать качать чанк сразу.

    Связь маршрута с файлом выведена из соглашения ``/guide`` →
    ``src/pages/guide.ts``. Если соглашение не соблюдено, в манифесте
    ничего не найдётся и предзагрузки просто не будет — ломаться нечему.
    """
    name = path.strip("/")
    if not name:
        # Страница теста импортирована статически, она уже в основном бандле
        return None

    entry = _vite_manifest().get(f"src/pages/{name}.ts")
    if not entry or "file" not in entry:
        return None
    return "/" + str(entry["file"]).lstrip("/")


def head_tags(path: str, meta: PageMeta) -> list[str]:
    """Теги ``<head>`` конкретной страницы.

    Идут в самое начало ``<head>``: скребки превью читают только первые
    килобайты документа, и то, что оказалось ниже, они могут не увидеть.
    """
    robots = "index, follow" if meta.index else "noindex, follow"
    url = canonical_url(path)
    image = settings.site_url.rstrip("/") + OG_IMAGE

    tags = [
        f"<title>{html.escape(meta.title)}</title>",
        f'<meta name="description" content="{_attr(meta.description)}" />',
        f'<meta name="robots" content="{robots}" />',
    ]

    # На 404 адреса нет — ни канонического, ни в og. Объявлять адресом
    # страницы то, чего по этому адресу нет, значит врать дважды
    if meta.canonical:
        tags.append(f'<link rel="canonical" href="{_attr(url)}" />')
        tags.append(f'<meta property="og:url" content="{_attr(url)}" />')

    # Адреса в og обязаны быть абсолютными — с относительным
    # Telegram и Facebook карточку не соберут
    tags += [
        f'<meta property="og:title" content="{_attr(meta.title)}" />',
        f'<meta property="og:description" content="{_attr(meta.description)}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Speedtype" />',
        '<meta property="og:locale" content="ru_RU" />',
        f'<meta property="og:image" content="{_attr(image)}" />',
        f'<meta property="og:image:width" content="{OG_IMAGE_WIDTH}" />',
        f'<meta property="og:image:height" content="{OG_IMAGE_HEIGHT}" />',
        f'<meta property="og:image:alt" content="{_attr(OG_IMAGE_ALT)}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{_attr(meta.title)}" />',
        f'<meta name="twitter:description" content="{_attr(meta.description)}" />',
        f'<meta name="twitter:image" content="{_attr(image)}" />',
    ]

    chunk = page_chunk(path)
    if chunk:
        tags.append(f'<link rel="modulepreload" href="{_attr(chunk)}" />')

    data = jsonld_for(path)
    if data is not None:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        tags.append(f'<script type="application/ld+json">{payload}</script>')

    return tags


def routes_script() -> str:
    """Список маршрутов инлайном — чтобы не тратить запрос на первом экране.

    Ставится в конец ``<head>``: он самый тяжёлый и нужен только js,
    а не скребкам.
    """
    payload = json.dumps(routes_payload(), ensure_ascii=False, separators=(",", ":"))
    return f'<script type="application/json" id="seoRoutes">{payload}</script>'


# Хвост \r?\n? съедает только собственный перевод строки тега,
# не трогая отступ следующей строки
_TITLE_RE = re.compile(r"[ \t]*<title>.*?</title>[ \t]*\r?\n?", re.IGNORECASE | re.DOTALL)
_DESC_RE = re.compile(r'[ \t]*<meta\s+name="description"[^>]*>[ \t]*\r?\n?', re.IGNORECASE)
_HEAD_OPEN_RE = re.compile(r"<head\b[^>]*>", re.IGNORECASE)
_HEAD_CLOSE_RE = re.compile(r"[ \t]*</head>", re.IGNORECASE)
# Кодировку положено объявить в первых 1024 байтах документа, а заголовки
# у нас на русском. Ставить кириллицу выше charset — напрашиваться на кракозябры
_CHARSET_RE = re.compile(r"<meta\s+charset=[^>]*>", re.IGNORECASE)


def render(shell: str, path: str, meta: PageMeta) -> str:
    """Подставить мета-теги страницы в оболочку ``index.html``.

    Свои ``<title>`` и ``description`` из оболочки убираем: они нужны
    только в dev, где страницу раздаёт Vite и подстановки не происходит.
    Два заголовка на странице — это хуже, чем один неправильный.
    """
    shell = _TITLE_RE.sub("", shell, count=1)
    shell = _DESC_RE.sub("", shell, count=1)

    block = "".join("\n    " + tag for tag in head_tags(path, meta))
    anchor = _CHARSET_RE if _CHARSET_RE.search(shell) else _HEAD_OPEN_RE

    if anchor.search(shell):
        shell = anchor.sub(lambda match: match.group(0) + block, shell, count=1)
    else:
        # Оболочки без <head> быть не должно, но молча терять теги хуже,
        # чем отдать их в начале документа
        shell = block.lstrip() + shell

    # Через lambda, а не строкой: в json бывают обратные слеши,
    # и re.sub принял бы их за группы подстановки
    script = "    " + routes_script() + "\n  </head>"
    return _HEAD_CLOSE_RE.sub(lambda _: script, shell, count=1)
