/**
 * Раскладка на экране должна идти за языком текста: на русских словах
 * латинская клавиатура бесполезна — подсвечивать на ней нечего.
 */

import { describe, expect, it } from "vitest";

import { resolveLayoutName } from "./keymap";

describe("resolveLayoutName", () => {
  it("по умолчанию берёт раскладку под язык", () => {
    expect(resolveLayoutName("default", "russian")).toBe("russian");
    expect(resolveLayoutName("", "russian")).toBe("russian");
  });

  it("узнаёт язык по началу имени файла", () => {
    // Языковых файлов вида russian_10k у нас десятки
    expect(resolveLayoutName("default", "russian_10k")).toBe("russian");
    expect(resolveLayoutName("default", "ukrainian_50k")).toBe("ukrainian");
  });

  it("для латиницы оставляет qwerty", () => {
    // Какая под ней физическая раскладка — qwerty, qwertz или azerty —
    // знать неоткуда, и угадывать хуже, чем оставить привычную
    expect(resolveLayoutName("default", "english")).toBe("qwerty");
    expect(resolveLayoutName("default", "french")).toBe("qwerty");
  });

  it("выбранную вручную раскладку не трогает", () => {
    expect(resolveLayoutName("dvorak", "russian")).toBe("dvorak");
    expect(resolveLayoutName("colemak", "english")).toBe("colemak");
  });

  it("незнакомый язык не роняет выбор", () => {
    expect(resolveLayoutName("default", "klingon")).toBe("qwerty");
  });
});
