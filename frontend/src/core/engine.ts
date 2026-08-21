/**
 * Движок теста печати.
 *
 * Ничего не знает про DOM: принимает нажатия, хранит состояние,
 * сообщает подписчикам об изменениях. Рендер и ввод живут отдельно —
 * благодаря этому движок можно тестировать без браузера.
 */

import { calculateAccuracy, calculateConsistency, calculateRaw, calculateWpm } from "./metrics";

export type TestMode = "time" | "words" | "quote" | "custom" | "zen";

/**
 * Сложность, как в monkeytype:
 * normal — ошибайся сколько угодно;
 * expert — тест обрывается, если уйти пробелом с неверным словом;
 * master — тест обрывается на первой же неверной букве.
 */
export type Difficulty = "normal" | "expert" | "master";

export interface TestConfig {
  mode: TestMode;
  /** Для time — секунды, для words — количество слов. */
  modeValue: number;
  language: string;
  words: string[];
  difficulty?: Difficulty;
  /** off — как обычно; letter — не пускать дальше ошибки; word — не пускать на следующее слово. */
  stopOnError?: string;
  /** Разрешить возвращаться к любым прошлым словам. */
  freedomMode?: boolean;
  /** off — стирать можно; on — нельзя стирать буквы; max — нельзя и слова. */
  confidenceMode?: string;
  /** Не ждать пробел после последнего слова — тест закончится сам. */
  quickEnd?: boolean;
  /** Пробел завершает слово всегда, даже пустое или недобранное. */
  strictSpace?: boolean;
  /** off — ничего; letter — стирать неверную букву; word — всё слово. */
  deleteOnError?: string;
  /** off | custom — обрывать тест, если скорость упала ниже порога. */
  minWpm?: string;
  minWpmCustomSpeed?: number;
  /** off | custom — то же для точности. */
  minAcc?: string;
  minAccCustom?: number;
  /** off | fixed | flex — порог скорости на отдельное слово. */
  minBurst?: string;
  minBurstCustomSpeed?: number;
}

/** Состояние одного символа для раскраски. */
export type CharState = "pending" | "correct" | "incorrect" | "extra";

export interface WordState {
  readonly target: string;
  typed: string;
  /** Слово завершено пробелом и больше не редактируется. */
  done: boolean;
  /** Скорость набора именно этого слова, wpm. */
  burst: number;
}

/** Что произошло — нужно, чтобы страница проиграла нужный звук. */
export type EngineEvent = "correct" | "error" | "word" | null;

export interface LiveStats {
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  correctChars: number;
  incorrectChars: number;
  /** Лишние буквы сверх длины слова. Часть incorrectChars, показывается отдельно. */
  extraChars: number;
  /** Недобранные буквы: ушли пробелом, не дописав слово. Тоже часть incorrectChars. */
  missedChars: number;
  /** Секунды без нажатий. Только для показа — в расчёт скорости не входят. */
  afkSeconds: number;
  elapsed: number;
  /** Сколько осталось: секунд в режиме time, слов в режиме words. */
  remaining: number;
  progress: number;
}

export interface TestSummary extends LiveStats {
  mode: TestMode;
  modeValue: number;
  language: string;
  /** Нарастающий wpm по секундам. Из него сервер считает consistency. */
  wpmSamples: number[];
  /** Скорость ЗА каждую секунду — для графика, а не для метрик. */
  speedSamples: number[];
  /** То же по всем нажатиям, включая ошибочные. */
  rawSamples: number[];
  /** Скорость слова, которое набиралось в эту секунду. */
  burstSamples: number[];
  /** Сколько ошибочных нажатий пришлось на каждую секунду. */
  errorSamples: number[];
  failed: boolean;
  failReason: string;
}

type Listener = (event: EngineEvent) => void;

export class TypingEngine {
  readonly config: TestConfig;

  words: WordState[];
  wordIndex = 0;

  started = false;
  finished = false;
  /** Тест оборван правилом сложности, а не доигран до конца. */
  failed = false;
  failReason = "";

  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  /** Когда началось текущее слово — для скорости по словам. */
  private wordStartedAt: number | null = null;

  /** Замер wpm раз в секунду — из них считается consistency. */
  private readonly wpmSamples: number[] = [];
  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Конец теста на время. Раньше его не было вовсе: время выходило, а тест
   * заканчивался только на СЛЕДУЮЩЕМ нажатии — то есть если человек
   * дописал и убрал руки, экран результата не появлялся, пока он не
   * тронет клавишу. Секундный замер тоже не спасал: он проверяет пределы
   * скорости и точности, но не конец.
   */
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Верные и ошибочные нажатия считаем по мере ввода, а не по финальному
   * тексту: иначе исправленная ошибка исчезнет из статистики и точность
   * окажется завышенной.
   */
  private correctKeystrokes = 0;
  private incorrectKeystrokes = 0;

  /**
   * Разбивка ошибок для экрана результата. На метрики не влияет:
   * сервер по-прежнему считает всё по паре correct/incorrect, а эти два
   * счётчика существуют только чтобы показать, из чего сложились ошибки.
   */
  private extraKeystrokes = 0;
  private missedKeystrokes = 0;

  /**
   * Время без нажатий. Секунда считается afk, если за неё не нажали ни
   * одной клавиши — так же считает monkeytype. На метрики не влияет:
   * это подпись на экране результата, а не поправка к скорости.
   */
  private afkSeconds = 0;
  /**
   * Нажатия с прошлого замера. Считаем их, а не время последнего нажатия:
   * по времени секунда, в которую нажали на самой её границе, выходила
   * пустой — от нажатия до замера ровно 1000 мс, и проверка срабатывала.
   */
  private keysSinceSample = 0;

  /**
   * Посекундные ряды для графика результата.
   *
   * Отличаются от wpmSamples тем, что показывают скорость ЗА секунду,
   * а не с начала теста. Нарастающий ряд идёт гладкой дугой, и на графике
   * по нему не видно ни провалов, ни рывков — а видеть их и есть смысл
   * графика.
   *
   * На сохраняемые метрики не влияют и на сервер не уходят: consistency
   * по-прежнему считается из wpmSamples, и её смысл не меняется.
   */
  private readonly speedSamples: number[] = [];
  private readonly rawSamples: number[] = [];
  private readonly burstSamples: number[] = [];
  private readonly errorSamples: number[] = [];

  /** Счётчики на границе прошлой секунды — из них берётся разница. */
  private atLastSecond = { correct: 0, incorrect: 0 };

  private readonly listeners = new Set<Listener>();

  constructor(config: TestConfig) {
    this.config = config;
    this.words = config.words.map((target) => ({ target, typed: "", done: false, burst: 0 }));
  }

  // --- подписка ---

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent = null): void {
    for (const listener of this.listeners) listener(event);
  }

  // --- настройки поведения ---

  private get difficulty(): Difficulty {
    return this.config.difficulty ?? "normal";
  }

  private get stopOnError(): string {
    return this.config.stopOnError ?? "off";
  }

  private get confidenceMode(): string {
    return this.config.confidenceMode ?? "off";
  }

  private get deleteOnError(): string {
    return this.config.deleteOnError ?? "off";
  }

  // --- ввод ---

  /** Обычный символ. */
  type(char: string): void {
    if (this.finished) return;
    this.ensureStarted();
    this.keysSinceSample += 1;

    if (char === " ") {
      this.commitWord();
      return;
    }

    const word = this.words[this.wordIndex];
    if (!word) return;

    // В zen сверять не с чем: что набрано, то и верно
    if (this.config.mode === "zen") {
      word.typed += char;
      this.correctKeystrokes += 1;
      this.emit("correct");
      return;
    }

    const expected = word.target[word.typed.length];
    const correct = expected === char;

    if (correct) {
      this.correctKeystrokes += 1;
    } else {
      this.incorrectKeystrokes += 1;
      // Символ сверх длины слова — это «лишний», а не «неверный»
      if (expected === undefined) this.extraKeystrokes += 1;

      // Не пускаем дальше неверной буквы
      if (this.stopOnError === "letter") {
        this.emit("error");
        return;
      }

      if (this.difficulty === "master") {
        word.typed += char;
        this.fail("неверная буква — режим мастера");
        return;
      }

      // Ошибка стирается сама: буквой или словом целиком.
      // Нажатие уже посчитано ошибочным — статистика не занижается.
      if (this.deleteOnError === "letter") {
        this.emit("error");
        return;
      }
      if (this.deleteOnError === "word") {
        word.typed = "";
        this.emit("error");
        return;
      }
    }

    word.typed += char;

    // Быстрый конец: последнее слово набрано целиком — ждать пробел незачем
    if (
      this.config.quickEnd === true &&
      this.config.mode !== "time" &&
      this.wordIndex === this.words.length - 1 &&
      word.typed === word.target
    ) {
      word.done = true;
      this.wordIndex += 1;
      this.emit(correct ? "correct" : "error");
      this.finish();
      return;
    }

    this.checkFinish();
    this.emit(correct ? "correct" : "error");
  }

  /** Backspace. Возврат к предыдущему слову разрешён, если оно с ошибкой. */
  backspace(wholeWord = false): void {
    // Правка — тоже работа: пока человек стирает, он не afk
    this.keysSinceSample += 1;
    if (this.finished) return;
    if (this.confidenceMode === "max") return;

    const word = this.words[this.wordIndex];
    if (!word) return;

    if (word.typed.length === 0) {
      if (this.confidenceMode !== "off") return;

      const previous = this.words[this.wordIndex - 1];
      // В свободном режиме можно вернуться к любому слову, иначе только к ошибочному
      const allowed = previous && (this.config.freedomMode || previous.typed !== previous.target);

      if (allowed) {
        previous.done = false;
        this.wordIndex -= 1;
      }
      this.emit();
      return;
    }

    if (this.confidenceMode === "on") return;

    word.typed = wholeWord ? "" : word.typed.slice(0, -1);
    this.emit();
  }

  /** Пробел: закрыть текущее слово и перейти к следующему. */
  private commitWord(): void {
    const word = this.words[this.wordIndex];
    if (!word) return;

    // zen: пробел просто переводит на следующее слово, ошибок здесь нет
    if (this.config.mode === "zen") {
      if (word.typed.length === 0) return;
      word.done = true;
      this.wordIndex += 1;
      this.growZen();
      this.emit("word");
      return;
    }

    // Обычно пробел в пустом слове ничего не делает. Строгий пробел
    // завершает слово всегда — недобранные буквы уйдут в ошибки.
    if (word.typed.length === 0 && this.config.strictSpace !== true) return;

    const correct = word.typed === word.target;

    // Не пускаем на следующее слово, пока текущее неверно
    if (this.stopOnError === "word" && !correct) {
      this.emit("error");
      return;
    }

    // Недобранные символы — это пропуски, они считаются ошибками
    if (word.typed.length < word.target.length) {
      const missed = word.target.length - word.typed.length;
      this.incorrectKeystrokes += missed;
      this.missedKeystrokes += missed;
    }

    // Скорость этого слова: длина в символах за время его набора
    if (this.wordStartedAt !== null) {
      const seconds = (performance.now() - this.wordStartedAt) / 1000;
      word.burst = calculateWpm(word.typed.length, seconds);
    }
    this.wordStartedAt = performance.now();

    word.done = true;

    // Порог на слово проверяем здесь: раньше слово не закончено
    if (!this.checkBurst(word.burst)) {
      this.wordIndex += 1;
      return;
    }

    if (this.difficulty !== "normal" && !correct) {
      this.wordIndex += 1;
      this.fail("слово набрано неверно — режим эксперта");
      return;
    }

    this.wordIndex += 1;
    this.checkFinish();
    this.emit("word");
  }

  /** Скорость текущего слова прямо сейчас. */
  get currentBurst(): number {
    const word = this.words[this.wordIndex];
    if (!word || this.wordStartedAt === null) return 0;

    const seconds = (performance.now() - this.wordStartedAt) / 1000;
    return calculateWpm(word.typed.length, seconds);
  }

  // --- жизненный цикл ---

  private ensureStarted(): void {
    if (this.started) return;

    this.started = true;
    this.startedAt = performance.now();
    this.wordStartedAt = this.startedAt;

    this.sampleTimer = setInterval(() => {
      if (this.finished) return;
      this.wpmSamples.push(calculateWpm(this.correctKeystrokes, this.elapsed));
      this.sampleSecond();
      this.checkLimits();
      // Страховка на случай, если точный таймер не сработал: вкладку
      // могли усыпить, и setTimeout проснётся позже срока
      this.checkFinish();
      this.emit();
    }, 1000);

    // Тест на время кончается сам, ровно в срок, а не по нажатию
    if (this.config.mode === "time") {
      this.endTimer = setTimeout(() => {
        if (!this.finished) this.finish();
      }, this.config.modeValue * 1000);
    }
  }

  /**
   * Что произошло за последнюю секунду: сколько верных и всего нажатий,
   * сколько ошибок, с какой скоростью шло текущее слово.
   *
   * Множитель 12 — это 60/5: слово считается за пять символов, а секунда
   * составляет шестидесятую минуты.
   */
  private sampleSecond(): void {
    const correct = this.correctKeystrokes - this.atLastSecond.correct;
    const incorrect = this.incorrectKeystrokes - this.atLastSecond.incorrect;

    // Секунда без единого нажатия — afk. Стирание тоже считается работой
    if (this.keysSinceSample === 0) this.afkSeconds += 1;
    this.keysSinceSample = 0;

    this.speedSamples.push(correct * 12);
    this.rawSamples.push((correct + incorrect) * 12);
    this.errorSamples.push(incorrect);
    this.burstSamples.push(this.currentBurst);

    this.atLastSecond = {
      correct: this.correctKeystrokes,
      incorrect: this.incorrectKeystrokes,
    };
  }

  private checkFinish(): void {
    // zen кончается только по shift+enter — сам он не заканчивается
    if (this.config.mode === "zen") return;

    if (this.config.mode === "time") {
      if (this.elapsed >= this.config.modeValue) this.finish();
      return;
    }
    if (this.wordIndex >= this.words.length) this.finish();
  }

  /**
   * В zen текста нет: слова появляются по мере набора. Дописываем пустое
   * слово всякий раз, когда человек уходит с последнего — иначе печатать
   * будет некуда.
   */
  private growZen(): void {
    if (this.config.mode !== "zen") return;
    while (this.wordIndex >= this.words.length - 1) {
      this.words.push({ target: "", typed: "", done: false, burst: 0 });
    }
  }

  /**
   * Пороги минимальной скорости и точности. Проверяем раз в секунду,
   * вместе с замером wpm: чаще незачем, а реже человек успеет уехать
   * далеко за порог и не поймёт, за что тест оборвался.
   *
   * Первую секунду не трогаем: на ней wpm ещё скачет от одного нажатия.
   */
  private checkLimits(): void {
    if (this.elapsed < 1.5) return;

    if (this.config.minWpm === "custom") {
      const limit = this.config.minWpmCustomSpeed ?? 0;
      const wpm = calculateWpm(this.correctKeystrokes, this.elapsed);
      if (limit > 0 && wpm < limit) {
        this.fail(`скорость упала ниже ${Math.round(limit)} wpm`);
        return;
      }
    }

    if (this.config.minAcc === "custom") {
      const limit = this.config.minAccCustom ?? 0;
      const accuracy = calculateAccuracy(this.correctKeystrokes, this.incorrectKeystrokes);
      if (limit > 0 && accuracy < limit) {
        this.fail(`точность упала ниже ${Math.round(limit)}%`);
      }
    }
  }

  /**
   * Порог скорости на отдельное слово.
   * fixed — каждое слово должно быть не медленнее порога;
   * flex — прощаем медленное слово, пока средняя скорость держится.
   */
  private checkBurst(burst: number): boolean {
    const mode = this.config.minBurst ?? "off";
    if (mode === "off") return true;

    const limit = this.config.minBurstCustomSpeed ?? 0;
    if (limit <= 0 || burst >= limit) return true;

    if (mode === "flex") {
      const average = calculateWpm(this.correctKeystrokes, this.elapsed);
      if (average >= limit) return true;
    }

    this.fail(`слово набрано медленнее ${Math.round(limit)} wpm`);
    return false;
  }

  /** Оборвать тест по правилу сложности. */
  private fail(reason: string): void {
    this.failed = true;
    this.failReason = reason;
    this.finish();
  }

  finish(): void {
    if (this.finished) return;

    this.finished = true;
    this.finishedAt = performance.now();

    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.emit();
  }

  /** Освободить таймер, если тест бросили на середине. */
  dispose(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.listeners.clear();
  }

  // --- расчёты ---

  get elapsed(): number {
    if (this.startedAt === null) return 0;
    const end = this.finishedAt ?? performance.now();
    return (end - this.startedAt) / 1000;
  }

  get stats(): LiveStats {
    const elapsed = this.elapsed;
    const total = this.correctKeystrokes + this.incorrectKeystrokes;

    // В zen считать нечего: конца у теста нет, поэтому счётчик показывает
    // набранное время, а полоса прогресса стоит на нуле
    const remaining =
      this.config.mode === "zen"
        ? elapsed
        : this.config.mode === "time"
          ? Math.max(0, this.config.modeValue - elapsed)
          : Math.max(0, this.words.length - this.wordIndex);

    const progress =
      this.config.mode === "zen"
        ? 0
        : this.config.mode === "time"
          ? Math.min(1, elapsed / this.config.modeValue)
          : Math.min(1, this.wordIndex / Math.max(1, this.words.length));

    return {
      wpm: calculateWpm(this.correctKeystrokes, elapsed),
      raw: calculateRaw(total, elapsed),
      accuracy: calculateAccuracy(this.correctKeystrokes, this.incorrectKeystrokes),
      consistency: calculateConsistency(this.wpmSamples),
      correctChars: this.correctKeystrokes,
      incorrectChars: this.incorrectKeystrokes,
      extraChars: this.extraKeystrokes,
      missedChars: this.missedKeystrokes,
      afkSeconds: this.afkSeconds,
      elapsed,
      remaining,
      progress,
    };
  }

  get summary(): TestSummary {
    return {
      ...this.stats,
      mode: this.config.mode,
      modeValue: this.config.modeValue,
      language: this.config.language,
      wpmSamples: [...this.wpmSamples],
      speedSamples: [...this.speedSamples],
      rawSamples: [...this.rawSamples],
      burstSamples: [...this.burstSamples],
      errorSamples: [...this.errorSamples],
      failed: this.failed,
      failReason: this.failReason,
    };
  }

  /** Состояние символов текущего слова — для раскраски. */
  charStates(wordIndex: number): CharState[] {
    const word = this.words[wordIndex];
    if (!word) return [];

    // В zen сравнивать не с чем — всё набранное верно
    if (this.config.mode === "zen") {
      return Array.from({ length: word.typed.length }, () => "correct" as CharState);
    }

    const states: CharState[] = [];
    for (let i = 0; i < word.target.length; i += 1) {
      const typed = word.typed[i];
      if (typed === undefined) {
        states.push("pending");
      } else {
        states.push(typed === word.target[i] ? "correct" : "incorrect");
      }
    }
    // Лишние символы сверх длины слова
    for (let i = word.target.length; i < word.typed.length; i += 1) {
      states.push("extra");
    }
    return states;
  }
}
