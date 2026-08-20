/** Модалки выбора: темы, языки, раскладки, шрифты, funbox — со строкой поиска. */

import { api } from "../api/client";
import { conflicts, FUNBOXES } from "../core/funbox";
import { getSettings, updateSettings } from "../state/settings";
import {
  applyTheme,
  currentColors,
  customTheme,
  CUSTOM_COLOR_KEYS,
  CUSTOM_COLOR_LABELS,
  loadThemes,
} from "../state/themes";
import { escapeHtml } from "./format";
import { icon } from "./icons";

interface Item {
  value: string;
  label: string;
  hint?: string;
  /** Кружки с цветами — только для тем. */
  swatches?: string[];
  /**
   * Собственные цвета пункта: строка красится ими же. Так список тем
   * выглядит как у monkeytype — каждая тема показана собой, а не подписью.
   */
  paint?: { bg: string; main: string; text: string };
  /** Семейство: пункты одного семейства идут вместе под общим заголовком. */
  family?: string;
  /** Уже выбран: в множественном выборе — один из отмеченных,
   *  в обычном — то значение, которое стоит сейчас. */
  checked?: boolean;
  /** Приглушить и подписать: режим объявлен, но не работает. */
  pending?: boolean;
}

interface PickerOptions {
  title: string;
  items: Item[];
  multi?: boolean;
  /** Звёздочка избранного: вернёт новое состояние списка избранных. */
  favourites?: {
    has: (value: string) => boolean;
    toggle: (value: string) => void;
  };
  onPick: (value: string & string[]) => void;
  /**
   * Примерить значение, не выбирая его: курсор наводится на тему — она
   * сразу видна на странице. null означает «вернуть как было».
   */
  preview?: (value: string | null) => void;
}

/** Сколько совпадений показываем разом. Больше — и список начинает тормозить. */
const MAX_SHOWN = 300;

function openPicker({ title, items, multi, favourites, onPick, preview }: PickerOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "picker";
  overlay.innerHTML = `
    <div class="box">
      <div class="pickerHead">
        <h2>${escapeHtml(title)}</h2>
        <span class="sub" data-count></span>
        <button class="button" data-close>${icon("xmark")}</button>
      </div>
      <input class="input" data-search placeholder="поиск…" autocomplete="off">
      <div class="list" data-list></div>
    </div>
  `;

  const listEl = overlay.querySelector<HTMLElement>("[data-list]")!;
  const searchEl = overlay.querySelector<HTMLInputElement>("[data-search]")!;
  const countEl = overlay.querySelector<HTMLElement>("[data-count]")!;

  const selected = new Set(items.filter((i) => i.checked).map((i) => i.value));

  /** Что примеряется прямо сейчас, и выбрал ли человек хоть что-то.
   *  Если ушёл, ничего не выбрав, примерку надо снять. */
  let previewed: string | null = null;
  let picked = false;

  function showPreview(value: string | null): void {
    if (!preview || previewed === value) return;
    previewed = value;
    preview(value);
  }

  /** То, что видно сейчас, и куда указывает курсор клавиатуры.
   *  −1 значит «ещё не ставили» — первая отрисовка наведёт его
   *  на то значение, которое стоит сейчас. */
  let shown: Item[] = [];
  let cursor = -1;

  function draw(): void {
    const needle = searchEl.value.trim().toLowerCase();
    let list = needle
      ? items.filter((i) => i.label.toLowerCase().includes(needle))
      : items;

    // Избранное — наверх, как в командной строке monkeytype
    if (favourites) {
      const fav = favourites;
      list = [...list].sort(
        (a, b) => Number(fav.has(b.value)) - Number(fav.has(a.value)),
      );
    }

    // Семейства держим вместе: 432 языка плоским списком не читаются
    if (items.some((item) => item.family)) {
      list = [...list].sort((a, b) =>
        (a.family ?? "").localeCompare(b.family ?? "") || a.label.localeCompare(b.label),
      );
    }

    // Список большой, показываем первые 300 совпадений
    const truncated = list.length > MAX_SHOWN;
    shown = list.slice(0, MAX_SHOWN);

    // Порядок пунктов зависит от избранного и поиска, поэтому наводимся
    // по значению, а не по номеру в исходном списке
    if (cursor < 0) cursor = shown.findIndex((item) => item.checked);
    cursor = Math.min(Math.max(cursor, 0), Math.max(0, shown.length - 1));

    // Обрезание должно быть видно: раньше список молча заканчивался
    // на трёхсотом пункте, и человек считал, что остальных просто нет
    countEl.textContent = truncated
      ? `показаны первые ${MAX_SHOWN} из ${list.length}`
      : `${list.length} из ${items.length}`;

    listEl.innerHTML =
      shown.length === 0
        ? `<p class="sub">ничего не найдено</p>`
        : shown
            .map(
              (item, index) => `
        ${
          item.family && item.family !== shown[index - 1]?.family
            ? `<div class="pickerGroup sub">${escapeHtml(item.family)}</div>`
            : ""
        }
        <div class="pickerRow${item.pending ? " pending" : ""}">
          <button class="button pickerItem${
            selected.has(item.value) ? " active" : ""
          }${index === cursor ? " cursor" : ""}" data-value="${escapeHtml(item.value)}"
            ${
              item.paint
                ? `style="background-color:${escapeHtml(item.paint.bg)};color:${escapeHtml(
                    item.paint.text,
                  )}"`
                : ""
            }>
            ${multi ? (selected.has(item.value) ? icon("check") : icon("xmark")) : ""}
            <span class="pickerLabel">${escapeHtml(item.label)}</span>
            ${item.hint ? `<span class="pickerHint">${escapeHtml(item.hint)}</span>` : ""}
            ${
              item.pending ? `<span class="pickerPending">пока не работает</span>` : ""
            }
            ${
              item.paint
                ? `<span class="themeDot" style="background-color:${escapeHtml(
                    item.paint.main,
                  )}"></span>`
                : ""
            }
            ${
              item.swatches
                ? `<span class="themeDots">${item.swatches
                    .map((c) => `<span style="background:${escapeHtml(c)}"></span>`)
                    .join("")}</span>`
                : ""
            }
          </button>
          ${
            favourites
              ? `<button class="pickerFav${
                  favourites.has(item.value) ? " on" : ""
                }" data-fav="${escapeHtml(item.value)}"
                 aria-label="в избранное" data-balloon-pos="left">${icon("star")}</button>`
              : ""
          }
        </div>`,
            )
            .join("");
  }

  function close(): void {
    // Закрыли, ничего не выбрав, — возвращаем то, что стояло до примерки
    if (!picked) showPreview(null);

    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  /** Двигает курсор и подтягивает пункт в видимую часть списка. */
  function moveCursor(delta: number): void {
    if (shown.length === 0) return;
    cursor = Math.min(Math.max(cursor + delta, 0), shown.length - 1);
    draw();
    listEl.querySelector(".pickerItem.cursor")?.scrollIntoView({ block: "nearest" });
    showPreview(shown[cursor]?.value ?? null);
  }

  /** Выбор пункта под курсором — то же, что клик по нему. */
  function pickCursor(): void {
    const item = shown[cursor];
    if (!item) return;

    if (multi) {
      toggle(item.value);
      return;
    }

    picked = true;
    onPick(item.value as string & string[]);
    close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    // Стрелки и enter — как в командной строке: список большой, мышью
    // искать в нём свою тему среди 187 штук неудобно
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveCursor(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      pickCursor();
    }
  }

  /** Переключение в множественном выборе — из клика и из enter. */
  function toggle(value: string): void {
    if (selected.has(value)) {
      selected.delete(value);
    } else {
      // Взаимоисключающие режимы снимаем сами
      for (const other of conflicts([...selected], value)) selected.delete(other);
      selected.add(value);
    }
    draw();
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target === overlay || target.closest("[data-close]")) {
      if (multi) onPick([...selected] as string & string[]);
      close();
      return;
    }

    const favButton = target.closest<HTMLElement>("button[data-fav]");
    if (favButton && favourites) {
      favourites.toggle(favButton.dataset["fav"]!);
      draw();
      return;
    }

    const button = target.closest<HTMLElement>("button[data-value]");
    if (!button) return;

    const value = button.dataset["value"]!;

    // Курсор идёт за мышью — иначе после клика стрелки прыгают от старого места
    const clicked = shown.findIndex((item) => item.value === value);
    if (clicked >= 0) cursor = clicked;

    if (multi) {
      toggle(value);
      return;
    }

    picked = true;
    onPick(value as string & string[]);
    close();
  });

  /*
   * Примерка мышью. Слушаем mouseover на всём списке, а не вешаем
   * обработчик на каждую кнопку: список перерисовывается на каждое
   * нажатие в поиске, и обработчики пришлось бы вешать заново.
   */
  listEl.addEventListener("mouseover", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-value]");
    if (button) showPreview(button.dataset["value"]!);
  });

  // Курсор ушёл со списка — примерку снимаем, даже если он ещё
  // над модалкой: иначе тема осталась бы висеть чужая
  listEl.addEventListener("mouseleave", () => showPreview(null));

  // Новый поиск — курсор снова на первое совпадение
  searchEl.addEventListener("input", () => {
    cursor = 0;
    draw();
    listEl.scrollTop = 0;
  });
  document.addEventListener("keydown", onKey, true);

  document.body.appendChild(overlay);

  // Открываемся на том, что стоит сейчас: список из 187 тем иначе
  // начинается с начала, и найти в нём текущую можно только глазами
  draw();
  listEl.querySelector(".pickerItem.cursor")?.scrollIntoView({ block: "center" });
  searchEl.focus();
}

// ---------- конкретные списки ----------

export async function openLanguagePicker(onPick: (v: string & string[]) => void): Promise<void> {
  const languages = await api.languageIndex();
  const current = getSettings().language;
  openPicker({
    title: "язык",
    items: languages.map((l) => ({
      value: l.name,
      label: l.name.replace(/_/g, " "),
      hint: `${l.words} слов`,
      checked: l.name === current,
      // english, english_1k, english_10k — одно семейство. Иначе 432 языка
      // идут вперемешку, и варианты своего языка приходится искать по всему списку
      family: familyOf(l.name),
    })),
    onPick,
  });
}

/**
 * Семейство языка — то, что стоит до первого суффикса. Суффиксы у файлов
 * monkeytype повторяются: размер словаря (1k, 10k), пунктуация, диакритика.
 */
function familyOf(name: string): string {
  const parts = name.split("_");
  if (parts.length === 1) return parts[0]!;

  const tail = parts[parts.length - 1]!;
  const isSuffix = /^\d+k$/.test(tail) || SUFFIXES.has(tail);
  return (isSuffix ? parts.slice(0, -1).join("_") : name).replace(/_/g, " ");
}

const SUFFIXES = new Set([
  "punctuation",
  "diacritics",
  "commonly",
  "misspelled",
  "contractions",
  "doubleletter",
  "shuffled",
  "sorted",
  "lowercase",
  "uppercase",
  "words",
  "quotes",
]);

const favouriteThemes = (): string[] =>
  getSettings()
    .favThemes.split(",")
    .map((name) => name.trim())
    .filter(Boolean);

export async function openThemePicker(onPick: (v: string & string[]) => void): Promise<void> {
  const themes = await loadThemes();
  const current = getSettings().theme;

  // То, что стоит на странице прямо сейчас: с включённой случайной темой
  // это не то же самое, что записано в настройках
  const applied = document.documentElement.dataset["theme"] ?? current;

  openPicker({
    title: "тема",
    // Список уже загружен, поэтому примеряем сразу, без похода на сервер:
    // иначе при быстром движении мыши ответы возвращаются вперемешку
    // и на странице остаётся не та тема, на которой стоит курсор
    preview: (name) => {
      const theme = themes.find((t) => t.name === (name ?? applied));
      if (theme) applyTheme(theme);
    },
    items: themes.map((t) => ({
      value: t.name,
      label: t.name.replace(/_/g, " "),
      checked: t.name === current,
      // Тема показана собой: подложка её фоном, буквы её текстом, точка
      // основным цветом. Трёх кружков сбоку для выбора не хватало
      paint: {
        bg: t.colors["--bg-color"] ?? "#000",
        main: t.colors["--main-color"] ?? "#fff",
        text: t.colors["--text-color"] ?? "#fff",
      },
    })),
    // Избранное нужно не для красоты: из него берёт темы режим
    // «случайная тема: избранные»
    favourites: {
      has: (name) => favouriteThemes().includes(name),
      toggle: (name) => {
        const current = favouriteThemes();
        const next = current.includes(name)
          ? current.filter((item) => item !== name)
          : [...current, name];
        updateSettings({ favThemes: next.join(", ") });
      },
    },
    onPick,
  });
}

export async function openLayoutPicker(onPick: (v: string & string[]) => void): Promise<void> {
  const layouts = await api.layoutIndex();
  const current = getSettings().layout;
  openPicker({
    title: "раскладка",
    items: layouts.map((name) => ({
      value: name,
      label: name.replace(/_/g, " "),
      checked: name === current,
    })),
    onPick,
  });
}

/** Моноширинные гарнитуры, которые есть в системе или подключены. */
const FONTS = [
  "Roboto Mono", "JetBrains Mono", "Cascadia Mono", "Consolas",
  "Courier New", "IBM Plex Mono", "Fira Code", "Source Code Pro",
  "Ubuntu Mono", "Inconsolata", "Menlo", "Monaco", "system-ui",
];

export function openFontPicker(onPick: (v: string & string[]) => void): void {
  const current = getSettings().fontFamily;

  openPicker({
    title: "шрифт",
    items: FONTS.map((name) => ({ value: name, label: name, checked: name === current })),
    // Гарнитуру видно только на самом тексте, поэтому примеряем её там же,
    // где она будет жить. null возвращает выбранную в настройках
    preview: (name) => {
      const wrapper = document.querySelector<HTMLElement>("#wordsWrapper");
      if (wrapper) wrapper.style.fontFamily = `"${name ?? current}", monospace`;
    },
    onPick,
  });
}

/**
 * Редактор своей темы: десять цветов, те же и в том же порядке, что в
 * themes.json. Меняешь — видно сразу, отменяешь — возвращается прежнее.
 */
export function openCustomThemePicker(onPick: (v: string & string[]) => void): void {
  const saved = getSettings().customThemeColors;
  const before = saved || currentColors().join(", ");
  let colors = before.split(",").map((c) => c.trim());

  const overlay = document.createElement("div");
  overlay.className = "picker";
  overlay.innerHTML = `
    <div class="box">
      <div class="pickerHead">
        <h2>своя тема</h2>
        <span class="sub">десять цветов</span>
        <button class="button" data-close>${icon("xmark")}</button>
      </div>
      <div class="customColors">
        ${CUSTOM_COLOR_KEYS.map(
          (key, index) => `
          <label class="customColor">
            <input type="color" data-index="${index}" value="${escapeHtml(colors[index] ?? "#000000")}">
            <span>${escapeHtml(CUSTOM_COLOR_LABELS[key] ?? key)}</span>
          </label>`,
        ).join("")}
      </div>
      <div class="customActions">
        <button class="button" data-from-theme>${icon("palette")} взять из текущей темы</button>
        <button class="button" data-save>${icon("check")} сохранить</button>
      </div>
    </div>
  `;

  /** Показать то, что набрано сейчас, не сохраняя. */
  function show(): void {
    applyTheme(customTheme(colors.join(", ")));
  }

  function close(saveIt: boolean): void {
    if (saveIt) {
      updateSettings({ customThemeColors: colors.join(", "), customTheme: true });
      onPick(colors.join(", ") as string & string[]);
    } else {
      // Не сохранили — возвращаем то, что было до открытия редактора
      updateSettings({ customThemeColors: saved });
    }

    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(false);
  }

  overlay.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== "color") return;

    colors[Number(input.dataset["index"])] = input.value;
    show();
  });

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target === overlay || target.closest("[data-close]")) {
      close(false);
      return;
    }

    if (target.closest("[data-save]")) {
      close(true);
      return;
    }

    if (target.closest("[data-from-theme]")) {
      colors = currentColors();
      overlay.querySelectorAll<HTMLInputElement>("input[type=color]").forEach((input, index) => {
        input.value = colors[index] ?? "#000000";
      });
      show();
    }
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  show();
}

export function openFunboxPicker(onPick: (v: string & string[]) => void): void {
  const active = getSettings().funbox;
  openPicker({
    title: "funbox",
    multi: true,
    // Нереализованные режимы помечаем так же, как настройки: приглушением
    // и подписью. Раньше они были неотличимы от рабочих.
    items: FUNBOXES.map((f) => ({
      value: f.name,
      label: f.label,
      hint: f.hint,
      checked: active.includes(f.name),
      ...(f.done === false ? { pending: true } : {}),
    })),
    onPick,
  });
}
