import { describe, expect, it } from "vitest";

import { TypingEngine, type TestConfig } from "./engine";

function make(overrides: Partial<TestConfig> = {}): TypingEngine {
  return new TypingEngine({
    mode: "words",
    modeValue: 3,
    language: "english",
    words: ["the", "quick", "fox"],
    ...overrides,
  });
}

function typeAll(engine: TypingEngine, text: string): void {
  for (const char of text) engine.type(char);
}

describe("сложность", () => {
  it("обычная: ошибки не обрывают тест", () => {
    const engine = make({ difficulty: "normal" });
    typeAll(engine, "tXe ");
    expect(engine.finished).toBe(false);
    expect(engine.failed).toBe(false);
  });

  it("мастер: обрыв на первой неверной букве", () => {
    const engine = make({ difficulty: "master" });
    typeAll(engine, "tX");
    expect(engine.finished).toBe(true);
    expect(engine.failed).toBe(true);
    expect(engine.failReason).toContain("мастер");
  });

  it("эксперт: буква ошибочна, но тест идёт", () => {
    const engine = make({ difficulty: "expert" });
    typeAll(engine, "tX");
    expect(engine.finished).toBe(false);
  });

  it("эксперт: обрыв на неверном слове после пробела", () => {
    const engine = make({ difficulty: "expert" });
    typeAll(engine, "tXe ");
    expect(engine.finished).toBe(true);
    expect(engine.failed).toBe(true);
    expect(engine.failReason).toContain("эксперт");
  });

  it("оборванный тест попадает в сводку", () => {
    const engine = make({ difficulty: "master" });
    typeAll(engine, "tX");
    expect(engine.summary.failed).toBe(true);
    expect(engine.summary.failReason.length).toBeGreaterThan(0);
  });
});

describe("остановка на ошибке", () => {
  it("letter: неверная буква не принимается", () => {
    const engine = make({ stopOnError: "letter" });
    typeAll(engine, "tX");
    expect(engine.words[0]?.typed).toBe("t");
    expect(engine.stats.incorrectChars).toBe(1);
  });

  it("letter: верная буква после ошибки проходит", () => {
    const engine = make({ stopOnError: "letter" });
    typeAll(engine, "tXh");
    expect(engine.words[0]?.typed).toBe("th");
  });

  it("word: пробел не пускает с неверным словом", () => {
    const engine = make({ stopOnError: "word" });
    typeAll(engine, "tXe ");
    expect(engine.wordIndex).toBe(0);
  });

  it("word: верное слово пропускает дальше", () => {
    const engine = make({ stopOnError: "word" });
    typeAll(engine, "the ");
    expect(engine.wordIndex).toBe(1);
  });
});

describe("режим уверенности", () => {
  it("off: стирать можно", () => {
    const engine = make({ confidenceMode: "off" });
    typeAll(engine, "th");
    engine.backspace();
    expect(engine.words[0]?.typed).toBe("t");
  });

  it("on: буквы стирать нельзя", () => {
    const engine = make({ confidenceMode: "on" });
    typeAll(engine, "th");
    engine.backspace();
    expect(engine.words[0]?.typed).toBe("th");
  });

  it("max: нельзя вернуться и к прошлому слову", () => {
    const engine = make({ confidenceMode: "max" });
    typeAll(engine, "tXe ");
    engine.backspace();
    expect(engine.wordIndex).toBe(1);
  });
});

describe("свободный режим", () => {
  it("выключен: к верному слову не вернуться", () => {
    const engine = make({ freedomMode: false });
    typeAll(engine, "the ");
    engine.backspace();
    expect(engine.wordIndex).toBe(1);
  });

  it("включён: вернуться можно к любому", () => {
    const engine = make({ freedomMode: true });
    typeAll(engine, "the ");
    engine.backspace();
    expect(engine.wordIndex).toBe(0);
  });
});

describe("события для звука", () => {
  it("сообщает, верным было нажатие или нет", () => {
    const engine = make();
    const events: unknown[] = [];
    engine.subscribe((e) => events.push(e));

    engine.type("t");
    engine.type("X");

    expect(events).toEqual(["correct", "error"]);
  });

  it("завершение слова — отдельное событие", () => {
    const engine = make();
    const events: unknown[] = [];
    typeAll(engine, "the");
    engine.subscribe((e) => events.push(e));
    engine.type(" ");

    expect(events).toContain("word");
  });
});

describe("скорость по словам", () => {
  it("у незавершённых слов равна нулю", () => {
    const engine = make();
    typeAll(engine, "th");
    expect(engine.words[0]?.burst).toBe(0);
  });

  it("после пробела становится положительной", () => {
    const engine = make();
    typeAll(engine, "the ");
    expect(engine.words[0]?.burst).toBeGreaterThan(0);
  });
});
