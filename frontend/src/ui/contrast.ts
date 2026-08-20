/**
 * Контраст по WCAG 2.1. Нужен в двух местах: на странице стайлгайда, где
 * рядом с каждым цветом стоит его отношение к фону, и в проверке всех
 * 187 тем (design/check-contrast.mjs).
 *
 * Второй файл — отдельная реализация на голом node, потому что читает
 * themes.json без сборки. Обе привязаны к одним и тем же контрольным
 * значениям: чёрное на белом — ровно 21, серое #767676 на белом — 4.54.
 * Разъедутся — упадёт contrast.test.ts.
 */

/** Цвет как три канала 0..255. null, если формат не разобрали. */
export function parseColor(value: string): [number, number, number] | null {
  const text = value.trim().toLowerCase();

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1]!;
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

  // rgb() и rgba() — в таком виде цвет приходит из getComputedStyle
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!];
    }
  }

  // color(srgb 0.62 0.63 0.61) — в таком виде getComputedStyle отдаёт
  // результат color-mix, которым посчитан --fg-muted-readable
  const srgb = text.match(/^color\(\s*srgb\s+([^)]+)\)$/);
  if (srgb) {
    const parts = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return [
        Math.round(parts[0]! * 255),
        Math.round(parts[1]! * 255),
        Math.round(parts[2]! * 255),
      ];
    }
  }

  return null;
}

/** Относительная яркость канала по формуле WCAG. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Относительная яркость цвета, 0..1. */
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Отношение контраста двух цветов: от 1 (одинаковые) до 21 (чёрное на белом).
 * Возвращает 0, если хотя бы один цвет не разобрался — так вызывающий код
 * отличит «не смогли посчитать» от «плохой контраст».
 */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return 0;

  const light = Math.max(luminance(fg), luminance(bg));
  const dark = Math.min(luminance(fg), luminance(bg));
  return (light + 0.05) / (dark + 0.05);
}

export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail" | "?";

/**
 * Во что укладывается отношение.
 *
 * Пороги WCAG: 4.5 для обычного текста, 3 для крупного (от 24px либо
 * от 19px полужирного) и для границ элементов управления, 7 — уровень AAA.
 */
export function level(ratio: number): ContrastLevel {
  if (ratio <= 0) return "?";
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}
