import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("посекундные ряды для графика", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Один тик замера — секунда по таймеру движка. */
  function tick(): void {
    vi.advanceTimersByTime(1000);
  }

  it("скорость и raw считаются за секунду, а не с начала теста", () => {
    const engine = makeEngine(["aaaaa", "bbbbb"], "time");

    // Пять верных нажатий за первую секунду — это 5 символов, то есть
    // одно слово в секунду, то есть 60 wpm
    typeAll(engine, "aaaaa");
    tick();

    // Во вторую секунду не нажали ничего: ряд обязан показать ноль,
    // а не унаследовать прошлое значение
    tick();

    const summary = engine.summary;
    expect(summary.speedSamples).toEqual([60, 0]);
    expect(summary.rawSamples).toEqual([60, 0]);
    expect(summary.errorSamples).toEqual([0, 0]);
  });

  it("ошибки попадают в свой ряд и в raw, но не в скорость", () => {
    const engine = makeEngine(["aaaaa"], "time");

    engine.type("a");
    engine.type("x");
    engine.type("x");
    tick();

    const summary = engine.summary;
    expect(summary.speedSamples).toEqual([12]);
    expect(summary.rawSamples).toEqual([36]);
    expect(summary.errorSamples).toEqual([2]);
  });

  it("нарастающий ряд wpm остался прежним — по нему считается ровность", () => {
    const engine = makeEngine(["aaaaa", "bbbbb"], "time");

    typeAll(engine, "aaaaa");
    tick();
    tick();

    // Пять символов за две секунды — это 30 wpm с начала теста.
    // Ряд для consistency обязан остаться нарастающим, иначе смысл
    // сохранённой ровности поменяется задним числом
    const [first, second] = engine.summary.wpmSamples;
    expect(first).toBeCloseTo(60, 0);
    expect(second).toBeCloseTo(30, 0);
  });

  it("время без нажатий считается по секундам", () => {
    const engine = makeEngine(["aaaaa"], "time");

    engine.type("a");
    tick();
    tick();
    tick();

    expect(engine.summary.afkSeconds).toBe(2);
  });
});
