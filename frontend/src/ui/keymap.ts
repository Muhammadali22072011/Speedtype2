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
    if (!layout.keys[row]) return false;
    if (row === "row1") return showTopRow || layout.keymapShowTopRow;
    return true;
  });

  const html = rows
    .map((row) => {
      const keys = layout.keys[row] ?? [];
      const cells = keys
        .map(([lower, upper]) => {
          const primary = lower ?? "";
          const secondary = upper ?? "";
          return `<div class="keymapKey" data-key="${escapeAttr(primary)}"
                       data-shift="${escapeAttr(secondary)}">
                    <span>${escapeHtmlChar(primary)}</span>
                  </div>`;
        })
        .join("");
      return `<div class="keymapRow">${cells}</div>`;
    })
    .join("");

  // Пробел отдельным рядом: он есть в любой раскладке, но в файлах не описан
  return `${html}<div class="keymapRow"><div class="keymapKey keymapSpace" data-key=" "><span></span></div></div>`;
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
