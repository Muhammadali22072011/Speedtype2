import { describe, expect, it } from "vitest";

import {
  applyFunboxText,
  conflicts,
  FUNBOX_BY_NAME,
  FUNBOXES,
  funboxVisuals,
  visibleWordLimit,
} from "./funbox";

const WORDS = ["hello", "world", "test"];

describe("список funbox", () => {
  it("содержит режимы всех трёх видов", () => {
    const kinds = new Set(FUNBOXES.map((f) => f.kind));
    expect(kinds).toEqual(new Set(["text", "css", "behavior"]));
  });

  it("имена не повторяются", () => {
    const names = FUNBOXES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("у каждого есть описание", () => {
    for (const box of FUNBOXES) {
      expect(box.hint.length).toBeGreaterThan(3);
      expect(box.label.length).toBeGreaterThan(0);
    }
  });
});

describe("преобразования текста", () => {
  it("backwards переворачивает слова", () => {
    expect(applyFunboxText(["abc"], ["backwards"])).toEqual(["cba"]);
  });

  it("ddoouubblleedd удваивает буквы", () => {
    expect(applyFunboxText(["ab"], ["ddoouubblleedd"])).toEqual(["aabb"]);
  });

  it("capitals делает первую букву заглавной", () => {
    expect(applyFunboxText(["test"], ["capitals"])).toEqual(["Test"]);
  });

  it("rot13 сдвигает на тринадцать", () => {
    expect(applyFunboxText(["abc"], ["rot13"])).toEqual(["nop"]);
  });

  it("rot13 обратим сам к себе", () => {
    const once = applyFunboxText(["hello"], ["rot13"]);
    expect(applyFunboxText(once, ["rot13"])).toEqual(["hello"]);
  });

  it("nospace склеивает всё в одно слово", () => {
    expect(applyFunboxText(WORDS, ["nospace"])).toEqual(["helloworldtest"]);
  });

  it("underscore_spaces соединяет подчёркиваниями", () => {
    expect(applyFunboxText(WORDS, ["underscore_spaces"])).toEqual(["hello_world_test"]);
  });

  it("leet заменяет буквы цифрами", () => {
    expect(applyFunboxText(["oie"], ["leet"])).toEqual(["013"]);
  });

  it("morse переводит в точки и тире", () => {
    expect(applyFunboxText(["sos"], ["morse"])).toEqual([".../---/..."]);
  });

  it("binary выдаёт восемь двоичных цифр", () => {
    const [word] = applyFunboxText(["x"], ["binary"]);
    expect(word).toMatch(/^[01]{8}$/);
  });

  it("hexadecimal выдаёт шестнадцатеричное число", () => {
    const [word] = applyFunboxText(["x"], ["hexadecimal"]);
    expect(word).toMatch(/^0x[0-9a-f]{4}$/);
  });

  it("pseudolang сохраняет длину слова", () => {
    const [word] = applyFunboxText(["typing"], ["pseudolang"]);
    expect(word).toHaveLength("typing".length);
  });

  it("преобразования применяются по очереди", () => {
    // сначала перевернуть, потом удвоить
    expect(applyFunboxText(["ab"], ["backwards", "ddoouubblleedd"])).toEqual(["bbaa"]);
  });

  it("без funbox текст не меняется", () => {
    expect(applyFunboxText(WORDS, [])).toEqual(WORDS);
  });

  it("неизвестное имя игнорируется", () => {
    expect(applyFunboxText(WORDS, ["такого_нет"])).toEqual(WORDS);
  });
});

describe("совместимость", () => {
  it("два генератора текста конфликтуют", () => {
    expect(conflicts(["gibberish"], "binary")).toEqual(["gibberish"]);
  });

  it("генератор и косметика уживаются", () => {
    expect(conflicts(["mirror"], "binary")).toEqual([]);
  });

  it("косметика ни с чем не конфликтует", () => {
    expect(conflicts(["gibberish"], "mirror")).toEqual([]);
  });
});

describe("оформление", () => {
  it("собирает классы и файлы стилей", () => {
    const { classes, cssFiles } = funboxVisuals(["mirror", "crt"]);
    expect(classes).toEqual(["mirror", "crt"]);
    expect(cssFiles).toEqual(["mirror", "crt"]);
  });

  it("текстовые режимы стилей не добавляют", () => {
    expect(funboxVisuals(["backwards"]).cssFiles).toEqual([]);
  });
});

describe("режимы plus", () => {
  it("plus_zero показывает одно слово", () => {
    expect(visibleWordLimit(["plus_zero"])).toBe(1);
  });

  it("plus_three показывает четыре слова", () => {
    expect(visibleWordLimit(["plus_three"])).toBe(4);
  });

  it("без них ограничения нет", () => {
    expect(visibleWordLimit(["mirror"])).toBeNull();
  });
});

describe("поиск по имени", () => {
  it("находит режим", () => {
    expect(FUNBOX_BY_NAME.get("mirror")?.kind).toBe("css");
  });

  it("на неизвестное имя отдаёт undefined", () => {
    expect(FUNBOX_BY_NAME.get("нет")).toBeUndefined();
  });
});
