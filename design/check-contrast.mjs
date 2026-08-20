/**
 * Проверка контраста по всем 187 темам.
 *
 * Запуск из корня проекта:
 *   node design/check-contrast.mjs
 *
 * Пишет design/contrast.md — сводку и список тем, не дотягивающих до порога,
 * и design/contrast.csv — полные числа по каждой теме.
 *
 * Зачем. У monkeytype темы проверены глазами: их присылают люди, автор
 * смотрит скриншот и принимает. 187 наборов цветов руками не проверяет
 * никто, и в коллекции есть темы, где приглушённый текст на фоне даёт 1.5
 * при норме 4.5 — читать нельзя, а понять это можно только измерив.
 *
 * Формула та же, что в frontend/src/ui/contrast.ts. Реализации две, потому
 * что этот файл читает themes.json без сборки; чтобы они не разъехались,
 * обе привязаны к одним контрольным значениям — GOLDEN ниже и такой же
 * массив в contrast.test.ts.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ---------- контраст ----------

function parseColor(value) {
  const text = String(value).trim().toLowerCase();

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((c) => c + c)
            .join("")
        : digits;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) return parts.slice(0, 3);
  }

  return null;
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrastRatio(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return 0;
  const light = Math.max(luminance(fg), luminance(bg));
  const dark = Math.min(luminance(fg), luminance(bg));
  return (light + 0.05) / (dark + 0.05);
}

/** То же, что color-mix(in srgb, a share%, b) — так считает браузер. */
function mix(a, b, share) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const channels = ca.map((v, i) => Math.round(v * share + cb[i] * (1 - share)));
  return `#${channels.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- самопроверка ----------

const GOLDEN = [
  ["#ffffff", "#000000", 21],
  ["#000000", "#ffffff", 21],
  ["#ffffff", "#ffffff", 1],
  ["#767676", "#ffffff", 4.5422],
  ["#d1d0c5", "#323437", 8.0498],
  ["#646669", "#323437", 2.1679],
];

for (const [fg, bg, expected] of GOLDEN) {
  const got = contrastRatio(fg, bg);
  if (Math.abs(got - expected) > 0.005) {
    throw new Error(`контроль не сошёлся: ${fg} на ${bg} = ${got.toFixed(4)}, ждали ${expected}`);
  }
}

// ---------- что проверяем ----------

/**
 * Пары «что на чём» и порог. Порог 4.5 — обычный текст, 3 — крупный текст
 * и границы элементов управления (WCAG 1.4.3 и 1.4.11).
 */
const CHECKS = [
  {
    key: "текст на фоне",
    fg: "--text-color",
    bg: "--bg-color",
    min: 4.5,
    why: "основной текст страницы и набранные буквы",
  },
  {
    key: "приглушённый на фоне",
    fg: "--sub-color",
    bg: "--bg-color",
    min: 4.5,
    why: "ненабранные буквы, подписи, футер — самый мелкий текст",
  },
  {
    key: "приглушённый после подмешивания",
    fg: "--sub-color",
    bg: "--bg-color",
    mixWith: "--text-color",
    mixShare: 0.45,
    min: 4.5,
    why: "то же место, но цветом --fg-muted-readable из слоя 2",
  },
  {
    key: "акцент на фоне",
    fg: "--main-color",
    bg: "--bg-color",
    min: 4.5,
    why: "цифры результата, активный пункт меню, каретка",
  },
  {
    key: "текст на приподнятом",
    fg: "--text-color",
    bg: "--sub-alt-color",
    min: 4.5,
    why: "надписи на кнопках, в полях ввода и карточках",
  },
  {
    key: "фон на акценте",
    fg: "--bg-color",
    bg: "--main-color",
    min: 4.5,
    why: "текст на кнопке под курсором и на активной кнопке",
  },
  {
    key: "ошибка на фоне",
    fg: "--error-color",
    bg: "--bg-color",
    min: 3,
    // Буквы теста набраны кеглем 32px — это крупный текст, для него
    // WCAG требует 3, а не 4.5
    why: "неверно набранные буквы, кегль 32px — порог крупного текста",
  },
  {
    key: "приподнятое на фоне",
    fg: "--sub-alt-color",
    bg: "--bg-color",
    min: 1.5,
    informational: true,
    why: "видна ли вообще граница кнопки и панели",
  },
];

// ---------- считаем ----------

const themes = JSON.parse(readFileSync(join(ROOT, "backend/app/data/themes.json"), "utf8"));
const names = Object.keys(themes).sort();

const rows = [];
for (const name of names) {
  const colors = themes[name].colors ?? {};
  const row = { name, values: {} };

  for (const check of CHECKS) {
    let fg = colors[check.fg];
    if (check.mixWith) fg = mix(fg, colors[check.mixWith], check.mixShare);
    row.values[check.key] = contrastRatio(fg ?? "", colors[check.bg] ?? "");
  }

  rows.push(row);
}

const light = (name) => {
  const bg = parseColor(themes[name].colors?.["--bg-color"] ?? "#000") ?? [0, 0, 0];
  // Та же формула, по которой светлую тему от тёмной отличает state/themes.ts
  return (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000 > 128;
};

const failing = (check) =>
  rows.filter((r) => r.values[check.key] > 0 && r.values[check.key] < check.min);

const fmt = (n) => (n > 0 ? n.toFixed(2) : "—");

// ---------- отчёт ----------

const lines = [];
lines.push("# Контраст по всем 187 темам");
lines.push("");
lines.push(
  "Считает `design/check-contrast.mjs` по формуле WCAG 2.1. " +
    "Перезапуск: `node design/check-contrast.mjs`.",
);
lines.push("");
lines.push(
  "Порог 4.5 — обычный текст, 3 — крупный текст и границы элементов управления. " +
    "Тема, не прошедшая проверку, не «сломана»: она просто требует от глаз " +
    "больше, чем допускает норма, и хуже всего это заметно на мелком тексте.",
);
lines.push("");

lines.push("## Что проверяется");
lines.push("");
lines.push("| пара | порог | где это видно |");
lines.push("|---|---|---|");
for (const c of CHECKS) lines.push(`| ${c.key} | ${c.min} | ${c.why} |`);
lines.push("");

lines.push("## Сводка");
lines.push("");
lines.push("| пара | не проходят | из них светлых | худшая тема |");
lines.push("|---|---|---|---|");
for (const c of CHECKS) {
  const bad = failing(c).sort((a, b) => a.values[c.key] - b.values[c.key]);
  const worst = bad[0];
  lines.push(
    `| ${c.key} | ${bad.length} из ${rows.length} | ${bad.filter((r) => light(r.name)).length} | ` +
      `${worst ? `\`${worst.name}\` (${fmt(worst.values[c.key])})` : "—"} |`,
  );
}
lines.push("");

// Главный вывод — насколько помогает подмешивание
const subFail = failing(CHECKS[1]).length;
const mixFail = failing(CHECKS[2]).length;
lines.push(
  `Приглушённый текст напрямую на \`--sub-color\` не проходит в **${subFail}** темах ` +
    `из ${rows.length}. Тот же текст цветом \`--fg-muted-readable\` (подмешано 55% ` +
    `основного) не проходит в **${mixFail}**. Одна строка в слое 2 чинит ` +
    `${subFail - mixFail} тем.`,
);
lines.push("");

for (const c of CHECKS) {
  if (c.informational) continue;
  const bad = failing(c).sort((a, b) => a.values[c.key] - b.values[c.key]);
  if (bad.length === 0) continue;

  lines.push(`## Не проходят: ${c.key}`);
  lines.push("");
  lines.push(`Порог ${c.min}. Где это видно: ${c.why}. Всего ${bad.length}.`);
  lines.push("");
  lines.push("| тема | отношение | вид |");
  lines.push("|---|---|---|");
  for (const r of bad) {
    lines.push(`| \`${r.name}\` | ${fmt(r.values[c.key])} | ${light(r.name) ? "светлая" : "тёмная"} |`);
  }
  lines.push("");
}

lines.push("## Что с этим делать");
lines.push("");
lines.push(
  "Править чужие темы нельзя: их узнают именно такими, а имена и значения — " +
    "внешний контракт. Поэтому чинится это на нашей стороне, в слое 2:",
);
lines.push("");
lines.push(
  "- мелкий служебный текст уже берёт `--fg-muted-readable`, а не `--sub-color` напрямую;",
);
lines.push(
  "- ненабранные буквы теста оставлены на `--sub-color`: там кегль 32px, " +
    "для крупного текста порог 3, и это другая задача — буквы должны быть " +
    "заметно бледнее набранных;",
);
lines.push(
  "- темы из списка выше имеет смысл пометить в пикере, чтобы выбор был осознанным.",
);
lines.push("");
lines.push(`Полные числа по каждой теме — в [contrast.csv](contrast.csv).`);
lines.push("");

writeFileSync(join(HERE, "contrast.md"), lines.join("\n"), "utf8");

// ---------- полные числа ----------

const csv = [["тема", "вид", ...CHECKS.map((c) => c.key)].join(",")];
for (const r of rows) {
  csv.push([r.name, light(r.name) ? "светлая" : "тёмная", ...CHECKS.map((c) => fmt(r.values[c.key]))].join(","));
}
writeFileSync(join(HERE, "contrast.csv"), csv.join("\n"), "utf8");

console.log(`тем проверено: ${rows.length}`);
for (const c of CHECKS) console.log(`  ${c.key}: не проходят ${failing(c).length}`);
console.log("отчёт: design/contrast.md, полные числа: design/contrast.csv");
