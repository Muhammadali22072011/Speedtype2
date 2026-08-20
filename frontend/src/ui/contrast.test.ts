import { describe, expect, it } from "vitest";

import { contrastRatio, level, parseColor } from "./contrast";

/**
 * Контрольные значения. Ими же проверяет себя design/check-contrast.mjs —
 * там своя реализация на голом node, и разъехаться они не должны.
 */
export const GOLDEN: Array<[string, string, number]> = [
  ["#ffffff", "#000000", 21],
  ["#000000", "#ffffff", 21],
  ["#ffffff", "#ffffff", 1],
  // Пограничный серый: ровно на пороге AA для обычного текста
  ["#767676", "#ffffff", 4.5422],
  // serika_dark: основной текст на фоне — с запасом
  ["#d1d0c5", "#323437", 8.0498],
  // serika_dark: приглушённый текст на фоне — не проходит, ради этого
  // и заведён --fg-muted-readable
  ["#646669", "#323437", 2.1679],
];

describe("контраст по WCAG", () => {
  it.each(GOLDEN)("%s на %s даёт %f", (fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 2);
  });

  it("разбирает и hex, и rgb из getComputedStyle", () => {
    expect(parseColor("#abc")).toEqual([170, 187, 204]);
    expect(parseColor("rgb(50, 52, 55)")).toEqual([50, 52, 55]);
    expect(parseColor("rgba(50, 52, 55, 0.5)")).toEqual([50, 52, 55]);
    expect(parseColor("color(srgb 0.5 0.5 0.5)")).toEqual([128, 128, 128]);
  });

  it("непонятный цвет — это ноль, а не плохой контраст", () => {
    expect(contrastRatio("чёрный", "#fff")).toBe(0);
    expect(level(0)).toBe("?");
  });

  it("пороги AA и AAA", () => {
    expect(level(21)).toBe("AAA");
    expect(level(7)).toBe("AAA");
    expect(level(4.5)).toBe("AA");
    expect(level(3)).toBe("AA-large");
    expect(level(2.1679)).toBe("fail");
  });
});
