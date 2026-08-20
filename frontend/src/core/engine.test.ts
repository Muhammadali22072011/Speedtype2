import { beforeEach, describe, expect, it } from "vitest";

import { TypingEngine } from "./engine";
import { calculateAccuracy, calculateConsistency, calculateRaw, calculateWpm } from "./metrics";

function makeEngine(words: string[] = ["the", "quick", "fox"], mode: "words" | "time" = "words") {
  return new TypingEngine({
    mode,
    modeValue: mode === "words" ? words.length : 60,
    language: "english",
    words,
  });
}

/** Набрать строку посимвольно. */
function typeAll(engine: TypingEngine, text: string): void {
  for (const char of text) engine.type(char);
}

describe("метрики", () => {
  it("слово это пять символов", () => {
    expect(calculateWpm(300, 60)).toBeCloseTo(60);
  });

  it("raw считает и ошибочные символы", () => {
    expect(calculateWpm(250, 60)).toBeCloseTo(50);
    expect(calculateRaw(300, 60)).toBeCloseTo(60);
  });

  it("точность считается от нажатий", () => {
    expect(calculateAccuracy(90, 10)).toBeCloseTo(90);
    expect(calculateAccuracy(0, 0)).toBeCloseTo(100);
  });

  it("ровность не случайна и лежит в диапазоне", () => {
    const samples = [40, 55, 61, 48];
    expect(calculateConsistency(samples)).toBe(calculateConsistency(samples));
    expect(calculateConsistency([60, 60, 60])).toBeCloseTo(100);
    expect(calculateConsistency([20, 100, 30])).toBeLessThan(100);
    expect(calculateConsistency([1, 200, 1])).toBeGreaterThanOrEqual(0);
  });
});

describe("движок", () => {
  let engine: TypingEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("до первого нажатия тест не идёт", () => {
    expect(engine.started).toBe(false);
    expect(engine.elapsed).toBe(0);
  });

  it("первое нажатие запускает тест", () => {
    engine.type("t");
    expect(engine.started).toBe(true);
  });

  it("верные символы увеличивают счётчик верных", () => {
    typeAll(engine, "the");
    expect(engine.stats.correctChars).toBe(3);
    expect(engine.stats.incorrectChars).toBe(0);
  });

  it("неверный символ попадает в ошибки", () => {
    typeAll(engine, "tXe");
    expect(engine.stats.correctChars).toBe(2);
    expect(engine.stats.incorrectChars).toBe(1);
  });

  it("исправленная ошибка остаётся в статистике", () => {
    // Иначе точность завышается: набрал мимо, стёр — как будто и не ошибался
    engine.type("t");
    engine.type("X");
    engine.backspace();
    engine.type("h");

    expect(engine.stats.incorrectChars).toBe(1);
    expect(engine.stats.accuracy).toBeLessThan(100);
  });

  it("пробел переводит на следующее слово", () => {
    typeAll(engine, "the ");
    expect(engine.wordIndex).toBe(1);
    expect(engine.words[0]?.done).toBe(true);
  });

  it("недобранные символы считаются ошибками", () => {
    // Набрали "th" вместо "the" и ушли пробелом — один символ пропущен
    typeAll(engine, "th ");
    expect(engine.stats.incorrectChars).toBe(1);
  });

  it("backspace на пустом слове возвращает к ошибочному предыдущему", () => {
    typeAll(engine, "tXe ");
    expect(engine.wordIndex).toBe(1);

    engine.backspace();
    expect(engine.wordIndex).toBe(0);
    expect(engine.words[0]?.done).toBe(false);
  });

  it("к верно набранному слову вернуться нельзя", () => {
    typeAll(engine, "the ");
    engine.backspace();
    expect(engine.wordIndex).toBe(1);
  });

  it("ctrl+backspace стирает слово целиком", () => {
    typeAll(engine, "th");
    engine.backspace(true);
    expect(engine.words[0]?.typed).toBe("");
  });

  it("в режиме words тест кончается на последнем слове", () => {
    typeAll(engine, "the quick fox ");
    expect(engine.finished).toBe(true);
  });

  it("после финиша ввод игнорируется", () => {
    typeAll(engine, "the quick fox ");
    const before = engine.stats.correctChars;
    engine.type("z");
    expect(engine.stats.correctChars).toBe(before);
  });

  it("raw никогда не меньше wpm", () => {
    typeAll(engine, "tXe qXick");
    const { raw, wpm } = engine.stats;
    expect(raw).toBeGreaterThanOrEqual(wpm);
  });
});

describe("раскраска символов", () => {
  it("отмечает верные, неверные и ещё не набранные", () => {
    const engine = makeEngine(["the"]);
    typeAll(engine, "tX");

    expect(engine.charStates(0)).toEqual(["correct", "incorrect", "pending"]);
  });

  it("лишние символы помечаются отдельно", () => {
    const engine = makeEngine(["the"]);
    typeAll(engine, "thereX");

    const states = engine.charStates(0);
    expect(states.slice(0, 3)).toEqual(["correct", "correct", "correct"]);
    expect(states.slice(3)).toEqual(["extra", "extra", "extra"]);
  });
});

describe("подписка", () => {
  it("сообщает об изменениях и умеет отписываться", () => {
    const engine = makeEngine();
    let calls = 0;
    const unsubscribe = engine.subscribe(() => {
      calls += 1;
    });

    engine.type("t");
    expect(calls).toBe(1);

    unsubscribe();
    engine.type("h");
    expect(calls).toBe(1);
  });
});
