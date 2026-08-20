---
name: speedtype
description: Работа над тренажёром печати Speedtype 2 — запуск, добавление настроек, funbox-режимов, тем, языков и раскладок, правка метрик и онлайн-гонок. Используй всегда, когда речь идёт о Speedtype, тренажёре печати, monkeytype-подобном интерфейсе, wpm/raw/consistency, funbox, командной строке ctrl+shift+p, гонках по вебсокету — даже если человек просто пишет «запусти», «добавь настройку» или «почини каретку».
---

# Speedtype 2

Тренажёр слепой печати. FastAPI на бэкенде, SPA на TypeScript без фреймворка.
Оформление и данные взяты из monkeytype (GPL-3.0).

## Запуск

Бэкенд, порт 8000 — обязательно из venv проекта, глобальный Python трогать нельзя:

```bash
cd backend && .venv/Scripts/python -m uvicorn app.main:app --reload
```

Фронтенд, порт 5173:

```bash
cd frontend && npm run dev
```

Открывать `http://127.0.0.1:5173`. Документация API — `http://127.0.0.1:8000/docs`.

## Проверки перед сдачей работы

```bash
cd backend && .venv/Scripts/python -m pytest -q
```

```bash
cd frontend && npm run typecheck && npm test && npx vite build
```

## Главное правило проекта

**Метрики считает сервер.** Клиент присылает только сырые счётчики:
`correct_chars`, `incorrect_chars`, `duration` и посекундные замеры wpm.
Всё остальное вычисляет `backend/app/services/metrics.py`.

Формулы клиента в `frontend/src/core/metrics.ts` дублируют серверные —
только чтобы цифры на экране совпадали с сохранёнными. Менять формулу
нужно в обоих местах сразу, иначе показания разойдутся.

В прошлой версии `consistency` был `Math.random()`, а `wpm` считался по
числу слов. Есть тесты, которые это стерегут — не ослабляй их.

## Как добавить настройку

Одна строка в `frontend/src/state/config-spec.ts` — и настройка сама
появится и на странице настроек, и в командной строке:

```ts
{ key: "myOption", group: "test", label: "моя настройка",
  hint: "описание в четыре слова", kind: "toggle", restart: true, done: true },
```

Затем добавь ключ и значение по умолчанию в `frontend/src/state/settings.ts`
(интерфейс `Settings` и объект `DEFAULTS`).

Поле `done: false` помечает нереализованное — на странице такая настройка
показывается приглушённой с подписью «пока не работает». Не ставь `true`,
пока не написал саму логику.

## Как добавить funbox-режим

В `frontend/src/core/funbox.ts`, в массив `FUNBOXES`. Три вида:

- `kind: "text"` — меняет слова, пиши `transform`;
- `kind: "css"` — меняет вид, поставь `hasCss: true` и положи файл
  в `backend/app/static/funbox/<имя>.css`;
- `kind: "behavior"` — меняет правила, обрабатывается в `pages/test.ts`.

Режимы, которые подменяют генерацию текста целиком, помечай `generator: true` —
такие взаимно исключаются, `conflicts()` снимет предыдущий сам.

## Как добавить язык, тему, раскладку

- **Язык** — json в `backend/app/static/languages/`, формат monkeytype:
  `{ "name": "...", "words": [...] }`. Индекс пересоберётся сам,
  он кэшируется на время работы процесса — перезапусти сервер.
- **Тема** — запись в `backend/app/data/themes.json`: семь CSS-переменных.
  Если нужны анимации, положи css в `backend/app/static/themes/<имя>.css`
  и поставь `hasCss: true`.
- **Раскладка** — json в `backend/app/static/layouts/`, ряды `row1..row5`,
  каждая клавиша парой `[без шифта, с шифтом]`.

## Разметка теста

Имена классов намеренно совпадают с monkeytype:

```html
<div id="words">
  <div class="word" data-wordindex="0">
    <letter class="correct">t</letter>
  </div>
</div>
<div id="caret"></div>
```

**Не переименовывай их.** На этих селекторах держатся 52 файла тем
из репозитория monkeytype — они применяются без единой правки.

## Подводные камни

- **Vite должен проксировать и `/api`, и `/static`.** Без второго правила
  css темы приходит пустым: Vite отдаёт на него свой `index.html`,
  браузер парсит как css и получает ноль правил. Молчаливая поломка.
- **Вебсокету гонок нужен `ws: true`** в том же прокси.
- **Не ставь пакеты в глобальный Python.** Там aiogram для телеграм-ботов,
  ему нужен `pydantic<2.10`.
- **Комнаты гонок живут в памяти процесса.** Для нескольких воркеров
  понадобится Redis — пока сервер один.
- **Heredoc в bash ломается об апострофы** в русских текстах и CSS.
  Для файлов с кавычками используй инструмент Write, а не `cat <<EOF`.

## Где что лежит

```
backend/app/
  services/metrics.py     формулы wpm, raw, accuracy, consistency
  services/anticheat.py   отсев невозможных результатов
  services/rooms.py       комнаты гонок
  api/routes/             auth, results, leaderboard, text, race, assets
  data/themes.json        187 тем
  static/                 языки, цитаты, раскладки, звуки, css тем и funbox

frontend/src/
  core/engine.ts          движок теста, не знает про DOM
  core/funbox.ts          43 режима
  core/sound.ts           звуки нажатий
  state/config-spec.ts    схема всех настроек
  ui/commandline.ts       ctrl+shift+p
  ui/keymap.ts            клавиатура на экране
  pages/test.ts           главная страница
  pages/race.ts           онлайн-гонки
```
