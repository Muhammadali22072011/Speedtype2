/**
 * Виртуальная клавиатура. Раскладки — файлы monkeytype: каждая клавиша
 * задана парой [без Shift, с Shift], ряды row1..row5.
 *
 * Подсвечиваем следующую клавишу и вспыхиваем на нажатии, как в оригинале.
 */

export interface Layout {
  keymapShowTopRow: boolean;
  type: string;
  keys: Record<string, Array<[string, string]>>;
}

const ROWS = ["row1", "row2", "row3", "row4", "row5"] as const;

/**
 * Раскладка под язык текста.
 *
 * Нужна там, где qwerty на экране просто бесполезна: русский текст на
 * латинской клавиатуре подсветить нечем — таких букв на ней нет.
 * Языки латиницы сюда не входят намеренно: какая под ними физическая
 * раскладка — qwerty, qwertz или azerty — мы знать не можем, а угадывать
 * хуже, чем оставить привычную.
 *
 * Ключ — начало имени языка: файлов вида russian_10k у нас десятки.
 */
const LAYOUT_BY_LANGUAGE: ReadonlyArray<[prefix: string, layout: string]> = [
  ["russian", "russian"],
  ["ukrainian", "ukrainian"],
  ["belarusian", "belarusian"],
  ["bulgarian", "bulgarian"],
  ["macedonian", "macedonian"],
  ["mongolian", "mongolian"],
  ["serbian", "serbian"],
  ["kazakh", "kazakh"],
  ["hebrew", "hebrew"],
  ["arabic", "arabic_101"],
  ["persian", "persian_standard"],
  ["urdu", "urdu_phonetic"],
  ["thai", "thai_kedmanee"],
  ["hindi", "hindi_inscript"],
  ["tamil", "tamil99"],
  ["armenian", "armenian_hm_qwerty"],
  ["korean", "korean"],
  ["japanese", "japanese_hiragana"],
  ["turkish", "turkish_e"],
  ["polish", "polish_programmers"],
];

/**
 * Какую раскладку рисовать. `default` и пустая строка значат «по языку»:
 * это и есть поведение по умолчанию, отдельной настройки под него больше нет.
 */
export function resolveLayoutName(name: string, language: string): string {
  if (name !== "" && name !== "default") return name;

  const lower = language.toLowerCase();
  const match = LAYOUT_BY_LANGUAGE.find(([prefix]) => lower.startsWith(prefix));
  return match ? match[1] : "qwerty";
}

const cache = new Map<string, Layout>();

export async function loadLayout(name: string): Promise<Layout | null> {
  const cached = cache.get(name);
  if (cached) return cached;

  try {
    const response = await fetch(`/static/layouts/${name}.json`);
    if (!response.ok) return null;

    const layout = (await response.json()) as Layout;
    cache.set(name, layout);
    return layout;
  } catch {
    return null;
  }
}

/** Разметка клавиатуры. Верхний ряд цифр показываем только если раскладка просит. */
export function renderKeymap(layout: Layout, showTopRow: boolean): string {
  const rows = ROWS.filter((row) => {
    const keys = layout.keys[row];
    if (!keys || keys.length === 0) return false;
    // Часть раскладок описывает пробел отдельным рядом row5. Свой пробел
    // мы дорисовываем всегда, и без этой проверки их выходило два.
    if (keys.every(([lower]) => (lower ?? "").trim() === "")) return false;
    if (row === "row1") return showTopRow || layout.keymapShowTopRow;
    return true;
  });

  const html = rows
    .map((row) => {
      const keys = layout.keys[row] ?? [];
      // Половины нужны формам split и alice. Остальным они не мешают:
      // .keymapHalf стоит display: contents, и ряд выглядит сплошным.
      const split = Math.floor(keys.length / 2);
      const left = keys.slice(0, split).map(renderKey).join("");
      const right = keys.slice(split).map(renderKey).join("");
      // data-row, а не порядок в разметке: скрытый ряд цифр сдвигал бы
      // ступеньки на ряд выше, и клавиатура переставала походить на себя
      return `<div class="keymapRow" data-row="${row}">
                <div class="keymapHalf">${left}</div>
                <div class="keymapHalf">${right}</div>
              </div>`;
    })
    .join("");

  // Пробел отдельным рядом: он есть в любой раскладке, но в файлах не описан
  return `${html}<div class="keymapRow"><div class="keymapKey keymapSpace" data-key=" "><span class="keymapLegend"></span></div></div>`;
}

/**
 * Клавиша с двумя подписями. Вторая — символ с Shift, её показывает
 * legendStyle: dynamic, пока Shift зажат. Если верхнего символа в раскладке
 * нет, повторяем нижний: пустая клавиша под Shift читалась бы как поломка.
 */
function renderKey([lower, upper]: [string, string]): string {
  const primary = lower ?? "";
  const secondary = upper || primary;
  return `<div class="keymapKey" data-key="${escapeAttr(primary)}"
               data-shift="${escapeAttr(upper ?? "")}">
            <span class="keymapLegend">${escapeHtmlChar(primary)}</span>
            <span class="keymapLegend keymapLegendShift">${escapeHtmlChar(secondary)}</span>
          </div>`;
}

/**
 * Зеркальная раскладка для funbox layout_mirror: каждый ряд разворачивается,
 * и клавиша меняется на симметричную ей относительно середины ряда.
 * Возвращает карту «что нажато → что печатается».
 */
export function mirrorMap(layout: Layout): Record<string, string> {
  const map: Record<string, string> = {};

  for (const row of ROWS) {
    const keys = layout.keys[row];
    if (!keys) continue;

    for (let i = 0; i < keys.length; i += 1) {
      const from = keys[i];
      const to = keys[keys.length - 1 - i];
      if (!from || !to) continue;

      // Обе половины пары: без шифта и с ним
      if (from[0] && to[0]) map[from[0]] = to[0];
      if (from[1] && to[1]) map[from[1]] = to[1];
    }
  }

  return map;
}

/** Подсветить клавишу, которую нужно нажать следующей. */
export function highlightNext(root: HTMLElement, char: string): void {
  root.querySelectorAll(".keymapKey.next").forEach((el) => el.classList.remove("next"));
  if (!char) return;

  const key = findKey(root, char);
  key?.classList.add("next");
}

/** Вспышка на фактическом нажатии. */
export function flashKey(root: HTMLElement, char: string, wrong: boolean): void {
  const key = findKey(root, char);
  if (!key) return;

  const cls = wrong ? "wrong" : "active";
  key.classList.add(cls);
  // Снимаем класс после анимации, иначе следующая вспышка не сработает
  setTimeout(() => key.classList.remove(cls), 120);
}

function findKey(root: HTMLElement, char: string): HTMLElement | null {
  const lower = char.toLowerCase();

  for (const el of root.querySelectorAll<HTMLElement>(".keymapKey")) {
    if (el.dataset["key"] === char || el.dataset["key"] === lower) return el;
    if (el.dataset["shift"] === char) return el;
  }
  return null;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtmlChar(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
