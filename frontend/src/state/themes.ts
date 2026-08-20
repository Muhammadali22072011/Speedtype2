/**
 * Темы monkeytype: 187 наборов цветов, у 52 из них есть дополнительный
 * css с анимациями. Цвета проставляем в :root, css подгружаем тегом link
 * с бэкенда — файлы лежат там нетронутыми.
 */

import { iconPath } from "../ui/icons";

export interface Theme {
  name: string;
  colors: Record<string, string>;
  hasCss: boolean;
}

const THEME_LINK_ID = "themeCss";
const THEME_STYLE_ID = "themeColors";

/**
 * Значок вкладки и цвет её обрамления. Иконка в public/favicon.svg
 * нарисована цветами serika_dark намертво — она нужна до того, как
 * заработает скрипт. Как только тема известна, подменяем значок таким
 * же, но перекрашенным: во вкладке рядом с заголовком стоит логотип
 * тем же цветом, что и в шапке страницы.
 */
function paintFavicon(colors: Record<string, string>): void {
  const glyph = iconPath("keyboard");
  if (!glyph) return;

  const bg = colors["--bg-color"] ?? "#323437";
  const main = colors["--main-color"] ?? "#e2b714";

  // viewBox глифа — 576x512, вписываем его в квадрат 64x64 со скруглением
  const body = glyph.d.map((d) => `<path fill="${main}" d="${d}"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<svg x="8" y="14" width="48" height="43" viewBox="${glyph.viewBox}">${body}</svg>` +
    `</svg>`;

  // Тег заводим заново, а не правим href у старого: Chrome читает значок
  // один раз и на изменение адреса у того же тега не реагирует — иконка
  // застывала на теме, которая стояла при загрузке страницы. Заодно
  // убираем ссылку на favicon.ico: она объявлена первой, растровая,
  // с прежним рисунком клавиатуры, и браузер выбирал её.
  document.querySelectorAll('link[rel~="icon"]').forEach((el) => el.remove());

  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.head.appendChild(link);

  // Обрамление вкладки на телефоне красится этим тегом, а не css
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = bg;
}

/**
 * Тег со стилями темы. Именно тег, а не inline-стили на <html>:
 * inline сильнее любого правила из файла, и тогда css темы или funbox
 * не может перекрасить :root — так, например, space_balls переставал
 * менять цвета. monkeytype по той же причине держит <style id="theme">.
 *
 * Тег уже лежит в index.html со значениями serika_dark — здесь мы только
 * переписываем его содержимое. Если тега нет (тесты, чужая оболочка),
 * добавляем его в конец <head>: раньше он вставлялся в начало, и наш
 * собственный css с теми же переменными в :root перебивал любую тему —
 * вес селекторов равный, выигрывал тот, что ниже по документу.
 * Файлы тем и funbox подключаются уже во время работы, то есть ниже
 * этого тега, и по-прежнему могут его перебить.
 */
function colorsStyle(): HTMLStyleElement {
  let style = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = THEME_STYLE_ID;
    document.head.append(style);
  }
  return style;
}

// Цвета последней применённой темы. Список тем весит 62 КБ, и держать
// на нём первую отрисовку нельзя — но и мигать чужой темой не годится.
// Поэтому выбранную тему запоминаем и ставим синхронно, до запроса.
const THEME_CACHE_KEY = "speedtype_theme_cache";

function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
  } catch {
    // Приватный режим или переполненное хранилище — не повод падать
  }
}

/**
 * Применить тему из кэша, не дожидаясь сети.
 *
 * Возвращает false, если кэша нет или в нём другая тема — тогда до
 * ответа сервера страница рисуется цветами по умолчанию из monkeytype.css.
 */
export function applyCachedTheme(name: string): boolean {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw) as Theme;
    if (cached?.name !== name || !cached.colors) return false;

    applyTheme(cached);
    return true;
  } catch {
    return false;
  }
}

let cache: Theme[] | null = null;

export async function loadThemes(): Promise<Theme[]> {
  if (cache) return cache;

  const response = await fetch("/api/themes");
  if (!response.ok) throw new Error("Не удалось загрузить темы");

  cache = (await response.json()) as Theme[];
  return cache;
}

export function findTheme(name: string): Theme | undefined {
  return cache?.find((t) => t.name === name);
}

/**
 * Светлая тема или тёмная. В themes.json такого поля нет, поэтому судим
 * по яркости фона — того же способа хватает и для случайной темы,
 * и для переключения вслед за системой.
 */
export function isLight(theme: Theme): boolean {
  const hex = theme.colors["--bg-color"] ?? "#000000";
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;

  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;

  // Относительная яркость по коэффициентам ITU-R BT.601
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

/** Случайная тема нужного вида. Возвращает имя или null, если выбирать не из чего. */
export async function pickRandomTheme(
  kind: string,
  favourites: readonly string[] = [],
): Promise<string | null> {
  const themes = await loadThemes();

  let pool = themes;
  if (kind === "light") pool = themes.filter(isLight);
  else if (kind === "dark") pool = themes.filter((t) => !isLight(t));
  else if (kind === "fav") pool = themes.filter((t) => favourites.includes(t.name));

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!.name;
}

/** Система просит светлую тему? */
export function systemPrefersLight(): boolean {
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** Подписка на смену системной темы. Возвращает функцию отписки. */
export function onSystemThemeChange(listener: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: light)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Проставить цвета и подключить css темы, если он у неё есть. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  const body = Object.entries(theme.colors)
    .map(([variable, value]) => `  ${variable}: ${value};`)
    .join("\n");
  colorsStyle().textContent = `:root {\n${body}\n}`;

  // Остатки прежнего способа: если переменная осталась inline, она перебьёт
  // и тег, и файл темы
  for (const variable of Object.keys(theme.colors)) {
    root.style.removeProperty(variable);
  }

  root.dataset["theme"] = theme.name;
  paintFavicon(theme.colors);
  rememberTheme(theme);

  let link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;

  if (!theme.hasCss) {
    link?.remove();
    return;
  }

  if (!link) {
    link = document.createElement("link");
    link.id = THEME_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = `/static/themes/${theme.name}.css`;
}

/**
 * Порядок цветов своей темы. Тот же набор и в том же порядке, в каком его
 * держит monkeytype: их редактор своей темы и наш обмениваются одним
 * списком, и человек может перенести палитру оттуда сюда.
 */
export const CUSTOM_COLOR_KEYS = [
  "--bg-color",
  "--main-color",
  "--caret-color",
  "--sub-color",
  "--sub-alt-color",
  "--text-color",
  "--error-color",
  "--error-extra-color",
  "--colorful-error-color",
  "--colorful-error-extra-color",
] as const;

/** Понятные подписи для редактора — по одной на цвет. */
export const CUSTOM_COLOR_LABELS: Record<string, string> = {
  "--bg-color": "фон",
  "--main-color": "основной",
  "--caret-color": "каретка",
  "--sub-color": "приглушённый",
  "--sub-alt-color": "подложка",
  "--text-color": "текст",
  "--error-color": "ошибка",
  "--error-extra-color": "лишняя буква",
  "--colorful-error-color": "ошибка, цветной режим",
  "--colorful-error-extra-color": "лишняя, цветной режим",
};

/** Своя тема из строки настроек. Пустые места добираем из темы по умолчанию. */
export function customTheme(colors: string): Theme {
  const values = colors.split(",").map((value) => value.trim());

  return {
    name: "custom",
    hasCss: false,
    colors: Object.fromEntries(
      CUSTOM_COLOR_KEYS.map((key, index) => [key, values[index] || FALLBACK_COLORS[index]!]),
    ),
  };
}

/** Цвета serika_dark — с них начинается редактор, если своих ещё нет. */
const FALLBACK_COLORS = [
  "#323437",
  "#e2b714",
  "#e2b714",
  "#646669",
  "#2c2e31",
  "#d1d0c5",
  "#ca4754",
  "#7e2a33",
  "#ca4754",
  "#7e2a33",
];

/** Цвета темы, которая сейчас на экране, — заготовка для редактора. */
export function currentColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  return CUSTOM_COLOR_KEYS.map(
    (key, index) => css.getPropertyValue(key).trim() || FALLBACK_COLORS[index]!,
  );
}

/** Применить тему по имени, загрузив список при необходимости. */
export async function applyThemeByName(name: string): Promise<void> {
  const themes = await loadThemes();
  const theme = themes.find((t) => t.name === name) ?? themes.find((t) => t.name === "serika_dark");
  if (theme) applyTheme(theme);
}
