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
  /** Подпись вместо «пока не работает» — например «нет в системе». */
  note?: string;
  /** Показать название его же гарнитурой: шрифт видно, а не читаешь имя. */
  font?: string;
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

    // Семейства держим вместе: 432 языка плоским списком не читаются.
    // Порядок групп — тот, в каком они впервые встретились в списке, а не
    // по алфавиту: у шрифтов «нет в системе» должно стоять последним,
    // хотя по алфавиту попало бы в середину.
    if (items.some((item) => item.family)) {
      const order = new Map<string, number>();
      for (const item of items) {
        const family = item.family ?? "";
        if (!order.has(family)) order.set(family, order.size);
      }

      list = [...list].sort(
        (a, b) =>
          (order.get(a.family ?? "") ?? 0) - (order.get(b.family ?? "") ?? 0) ||
          a.label.localeCompare(b.label),
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
            <span class="pickerLabel"${
              item.font ? ` style="font-family: ${escapeHtml(item.font)}"` : ""
            }>${escapeHtml(item.label)}</span>
            ${item.hint ? `<span class="pickerHint">${escapeHtml(item.hint)}</span>` : ""}
            ${
              item.pending
                ? `<span class="pickerPending">${escapeHtml(item.note ?? "пока не работает")}</span>`
                : ""
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
    items: [
      // Первым пунктом то, что стоит по умолчанию: клавиатура идёт за
      // языком текста, и выбирать вручную ничего не нужно
      {
        value: "default",
        label: "по языку",
        hint: "русскому тексту — русская клавиатура",
        checked: current === "default",
      },
      ...layouts.map((name) => ({
        value: name,
        label: name.replace(/_/g, " "),
        checked: name === current,
      })),
    ],
    onPick,
  });
}

/**
 * Гарнитуры на выбор. Своих файлов шрифтов проект не возит — кроме одного
 * встроенного Roboto Mono, — поэтому список честно делится на два: что
 * стоит в системе и что нет.
 *
 * Раньше здесь было тринадцать имён без всякой проверки, и на обычной
 * Windows восемь из них не работали: выбираешь Fira Code, а текст
 * остаётся прежним, потому что подставляется запасной monospace.
 */
const FONTS: Array<{ name: string; kind: "mono" | "prose" }> = [
  // Моноширинные — то, чем набирают
  { name: "Roboto Mono", kind: "mono" },
  { name: "Consolas", kind: "mono" },
  { name: "Cascadia Mono", kind: "mono" },
  { name: "Cascadia Code", kind: "mono" },
  { name: "Courier New", kind: "mono" },
  { name: "Lucida Console", kind: "mono" },
  { name: "JetBrains Mono", kind: "mono" },
  { name: "Fira Code", kind: "mono" },
  { name: "IBM Plex Mono", kind: "mono" },
  { name: "Source Code Pro", kind: "mono" },
  { name: "Ubuntu Mono", kind: "mono" },
  { name: "Inconsolata", kind: "mono" },
  { name: "Hack", kind: "mono" },
  { name: "Iosevka", kind: "mono" },
  { name: "Geist Mono", kind: "mono" },
  { name: "Space Mono", kind: "mono" },
  { name: "Overpass Mono", kind: "mono" },
  { name: "Noto Sans Mono", kind: "mono" },
  { name: "DejaVu Sans Mono", kind: "mono" },
  { name: "Liberation Mono", kind: "mono" },
  { name: "MS Gothic", kind: "mono" },
  { name: "SimSun", kind: "mono" },
  { name: "Menlo", kind: "mono" },
  { name: "Monaco", kind: "mono" },
  { name: "SF Mono", kind: "mono" },
  { name: "Andale Mono", kind: "mono" },

  // Пропорциональные: у monkeytype они тоже есть — набирать ими труднее,
  // но кому-то так привычнее, а Open Dyslexic и вовсе про доступность
  { name: "Segoe UI", kind: "prose" },
  { name: "Bahnschrift", kind: "prose" },
  { name: "Calibri", kind: "prose" },
  { name: "Candara", kind: "prose" },
  { name: "Corbel", kind: "prose" },
  { name: "Constantia", kind: "prose" },
  { name: "Georgia", kind: "prose" },
  { name: "Tahoma", kind: "prose" },
  { name: "Verdana", kind: "prose" },
  { name: "Arial", kind: "prose" },
  { name: "Comic Sans MS", kind: "prose" },
  { name: "Ink Free", kind: "prose" },
  { name: "Sitka Text", kind: "prose" },
  { name: "Impact", kind: "prose" },
  { name: "Roboto", kind: "prose" },
  { name: "Inter", kind: "prose" },
  { name: "Lato", kind: "prose" },
  { name: "Montserrat", kind: "prose" },
  { name: "Nunito", kind: "prose" },
  { name: "Open Dyslexic", kind: "prose" },
  { name: "Atkinson Hyperlegible", kind: "prose" },
  { name: "system-ui", kind: "prose" },
];

/**
 * Есть ли гарнитура в системе.
 *
 * document.fonts.check для этого не годится: в Chrome он отвечает «да»
 * даже на выдуманное имя — проверяет пригодность записи, а не наличие
 * шрифта. Поэтому меряем ширину строки: если с нужной гарнитурой она
 * отличается от запасной хотя бы в одном из трёх семейств, шрифт есть.
 */
const installed = new Map<string, boolean>();

function hasFont(name: string): boolean {
  const known = installed.get(name);
  if (known !== undefined) return known;

  // system-ui и monospace — не имена шрифтов, а обещания браузера
  if (name === "system-ui") {
    installed.set(name, true);
    return true;
  }

  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;

  // Строка со смесью широких и узких букв: на ней разница заметнее
  const sample = "mmmmmmmmmmlli WW08";
  const width = (family: string): number => {
    context.font = `72px ${family}`;
    return context.measureText(sample).width;
  };

  const result = ["monospace", "sans-serif", "serif"].some(
    (base) => width(`"${name}", ${base}`) !== width(base),
  );

  installed.set(name, result);
  return result;
}

export function openFontPicker(onPick: (v: string & string[]) => void): void {
  const current = getSettings().fontFamily;

  // Установленные сверху, отсутствующие — вниз и приглушённо. Прятать их
  // совсем не стоит: человек ставит шрифт в систему и возвращается
  const items = FONTS.map((font) => {
    const available = hasFont(font.name);
    return {
      value: font.name,
      label: font.name,
      font: `"${font.name}", ${font.kind === "mono" ? "monospace" : "sans-serif"}`,
      checked: font.name === current,
      hint: font.name === "Roboto Mono" ? "встроенный" : font.kind === "mono" ? "" : "непечатная",
      family: available
        ? font.kind === "mono"
          ? "моноширинные"
          : "пропорциональные"
        : "нет в системе",
      ...(available ? {} : { pending: true, note: "нет в системе" }),
    };
  });

  // Порядок групп задаём здесь: пикер расставит их так, как они впервые
  // встретились. Установленные моноширинные — первыми, отсутствующие — в конец
  const groups = ["моноширинные", "пропорциональные", "нет в системе"];
  items.sort((a, b) => groups.indexOf(a.family) - groups.indexOf(b.family));

  openPicker({
    title: "шрифт",
    items,
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

/**
 * Поиск цитаты — ctrl+shift+f, как у них.
 *
 * Список здесь живой: ищет сервер по тексту и по источнику, а не мы по
 * загруженному куску. Пустой запрос отдаёт начало списка, чтобы окно не
 * выглядело сломанным, пока в него ничего не ввели.
 *
 * Выбранную цитату отдаём словами от сервера, а не бьём текст сами —
 * разбивка должна быть одна на проект.
 */
export function openQuoteSearch(
  language: string,
  onPick: (words: string[]) => void,
): void {
  const overlay = document.createElement("div");
  overlay.className = "picker quoteSearch";
  overlay.innerHTML = `
    <div class="box">
      <div class="pickerHead">
        <h2>поиск цитаты</h2>
        <span class="sub" data-count></span>
        <button class="button" data-close>${icon("xmark")}</button>
      </div>
      <input class="input" data-search placeholder="слово из цитаты или автор…"
             autocomplete="off" spellcheck="false">
      <div class="list" data-list></div>
    </div>
  `;

  const listEl = overlay.querySelector<HTMLElement>("[data-list]")!;
  const searchEl = overlay.querySelector<HTMLInputElement>("[data-search]")!;
  const countEl = overlay.querySelector<HTMLElement>("[data-count]")!;

  /** Номер последнего запроса: ответы приходят вперемешку. */
  let request = 0;

  async function load(): Promise<void> {
    const mine = ++request;
    const query = searchEl.value.trim();

    try {
      const rows = await api.searchQuotes(language, query);

      // Пока ждали, человек дописал буквы и ушёл следующий запрос —
      // старый ответ рисовать нельзя, он перетрёт свежий
      if (mine !== request) return;

      countEl.textContent = rows.length === 0 ? "" : `${rows.length}`;
      listEl.innerHTML =
        rows.length === 0
          ? `<p class="sub">ничего не нашлось</p>`
          : rows
              .map(
                (row) => `
        <button class="button quoteRow" data-id="${row.id}">
          <span class="quoteText">${escapeHtml(row.text)}</span>
          <span class="quoteMeta sub">${escapeHtml(row.source ?? "без источника")} · ${
            row.length
          } знаков</span>
        </button>`,
              )
              .join("");
    } catch {
      if (mine === request) listEl.innerHTML = `<p class="error">не удалось загрузить цитаты</p>`;
    }
  }

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target === overlay || target.closest("[data-close]")) {
      close();
      return;
    }

    const row = target.closest<HTMLElement>("button[data-id]");
    if (!row) return;

    const id = Number(row.dataset["id"]);
    row.classList.add("active");

    void api
      .quoteById(language, id)
      .then((quote) => {
        close();
        onPick(quote.words);
      })
      .catch(() => {
        row.classList.remove("active");
        listEl.insertAdjacentHTML(
          "afterbegin",
          `<p class="error">не удалось взять эту цитату</p>`,
        );
      });
  });

  // Ждём паузу в наборе: иначе на каждую букву уходит запрос
  let timer: ReturnType<typeof setTimeout> | null = null;
  searchEl.addEventListener("input", () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void load(), 200);
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  searchEl.focus();
  void load();
}

/**
 * Метки результата. Набор заменяется целиком — сервер принимает список
 * id, а не разницу: интерфейс отмечает галочками весь список сразу,
 * и присылать разницу ему неоткуда.
 */
export async function openTagPicker(
  chosen: readonly number[],
  onPick: (ids: number[]) => void,
): Promise<void> {
  const tags = await api.tags();

  if (tags.length === 0) {
    // Пустой список меток выглядел бы как поломка. Говорим, где их завести
    openPicker({
      title: "метки",
      items: [
        {
          value: "",
          label: "меток пока нет",
          hint: "завести можно в настройках аккаунта",
          pending: true,
          note: "нет меток",
        },
      ],
      onPick: () => undefined,
    });
    return;
  }

  openPicker({
    title: "метки",
    multi: true,
    items: tags.map((tag) => ({
      value: String(tag.id),
      label: tag.name,
      checked: chosen.includes(tag.id),
    })),
    onPick: (values) => onPick((values as unknown as string[]).map(Number)),
  });
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
