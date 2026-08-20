/**
 * Страница теста. Разметка повторяет monkeytype: #words с .word и <letter>,
 * отдельный #caret, три видимые строки с прокруткой.
 *
 * Здесь же применяются настройки отображения: лента, подсветка, эффект
 * набранного, вид таймера, шрифт, фон, клавиатура и funbox.
 */

import { api, ApiError, getToken, type Result, type Stats } from "../api/client";
import { TypingEngine } from "../core/engine";
import {
  applyFunboxText,
  ARROW_KEYS,
  FUNBOX_BODY_CLASSES,
  funboxVisuals,
  visibleWordLimit,
} from "../core/funbox";
import { configureSound, playClick, playError, playTimeWarning } from "../core/sound";
import { navigate, type PageContext } from "../router";
import {
  getSettings,
  modeValue,
  onSettingsChange,
  TIME_OPTIONS,
  updateSettings,
  WORD_OPTIONS,
  type TestMode,
} from "../state/settings";
import { openCommandline, setRestartHook } from "../ui/commandline";
import { escapeHtml, formatDuration } from "../ui/format";
import { icon } from "../ui/icons";
import { flashKey, highlightNext, loadLayout, mirrorMap, renderKeymap } from "../ui/keymap";
import { askNumber, askText, notify } from "../ui/modal";
import { openFunboxPicker, openLanguagePicker } from "../ui/pickers";
import { applyThemeByName, pickRandomTheme } from "../state/themes";

/** Сколько строк слов видно сразу — как у monkeytype, три. */
const VISIBLE_LINES = 3;

/** Свой текст режима custom. Живёт отдельно от настроек — см. openCustomText. */
const CUSTOM_TEXT_KEY = "speedtype_custom_text";

/** Счётчик ошибок по буквам — для funbox weakspot. */
const WEAKSPOT_KEY = "speedtype_weakspot";

/** Сколько секунд показывают текст в режиме memory, прежде чем спрятать. */
const MEMORY_SECONDS = 3;

/**
 * Текст для следующего запуска страницы: кнопки «повторить тот же текст»
 * и «практика ошибочных слов» пересоздают страницу целиком, потому что
 * экран результата заменяет разметку теста — писать в старые узлы нельзя,
 * они уже отсоединены от документа.
 */
let presetWords: string[] | null = null;

/** Множители перевода wpm в выбранную единицу. */
const SPEED_UNITS: Record<string, { factor: number; label: string }> = {
  wpm: { factor: 1, label: "wpm" },
  cpm: { factor: 5, label: "cpm" },
  wps: { factor: 1 / 60, label: "wps" },
  cps: { factor: 5 / 60, label: "cps" },
  wph: { factor: 60, label: "wph" },
};

export async function testPage({ container }: PageContext): Promise<() => void> {
  container.innerHTML = `
    <!-- data-ui-element нужен файлам тем: две из 52 целятся именно в него,
         id оставляем, на нём держатся наши собственные правила -->
    <div id="testConfig" data-ui-element="testConfig"></div>
    <div id="typingTest">
      <div id="testModesNotice"></div>
      <div id="memoryTimer" hidden></div>
      <div id="liveStatsTextTop"></div>
      <div id="liveStatsMini"></div>
      <div id="wordsWrapper">
        <div id="words"></div>
        <div id="caret"></div>
        <div id="focusHint" hidden>${icon("cursor")} нажмите сюда или любую клавишу</div>
      </div>
      <div id="liveStatsTextBottom"></div>
      <input id="wordsInput" autocomplete="off" autocapitalize="off" autocorrect="off"
             spellcheck="false" aria-label="Поле ввода теста" tabindex="0">
      <div id="capsWarning" hidden>${icon("bolt")} Caps Lock</div>
      <button id="restartButton" aria-label="Начать заново" title="начать заново">
        ${icon("rotate")}
      </button>
      <div id="keymap" hidden></div>
    </div>
  `;

  const configEl = container.querySelector<HTMLElement>("#testConfig")!;
  const testEl = container.querySelector<HTMLElement>("#typingTest")!;
  const topEl = container.querySelector<HTMLElement>("#liveStatsTextTop")!;
  const bottomEl = container.querySelector<HTMLElement>("#liveStatsTextBottom")!;
  const miniEl = container.querySelector<HTMLElement>("#liveStatsMini")!;

  // Полоса времени приклеена к верху окна, поэтому живёт в body, а не
  // внутри страницы — иначе она уехала бы вместе с содержимым
  const barEl = (() => {
    let el = document.getElementById("timerBar");
    if (!el) {
      el = document.createElement("div");
      el.id = "timerBar";
      document.body.appendChild(el);
    }
    el.hidden = true;
    return el;
  })();
  const wrapperEl = container.querySelector<HTMLElement>("#wordsWrapper")!;
  const wordsEl = container.querySelector<HTMLElement>("#words")!;
  const caretEl = container.querySelector<HTMLElement>("#caret")!;
  const focusEl = container.querySelector<HTMLElement>("#focusHint")!;
  const inputEl = container.querySelector<HTMLInputElement>("#wordsInput")!;
  const keymapEl = container.querySelector<HTMLElement>("#keymap")!;
  // Подсказки клавиш живут над футером, а не внутри теста — как у них.
  // Блок общий на всё приложение, поэтому ищем его в документе.
  const hintEl = document.querySelector<HTMLElement>("#testHint")!;
  const noticeEl = container.querySelector<HTMLElement>("#testModesNotice")!;
  const memoryEl = container.querySelector<HTMLElement>("#memoryTimer")!;

  let engine: TypingEngine | null = null;
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  let submitting = false;
  let lineOffset = 0;
  /** Догоняющая каретка: доля пройденного текста. */
  let paceProgress = 0;
  let paceTimer: ReturnType<typeof setInterval> | null = null;
  let blinkTimer: ReturnType<typeof setTimeout> | null = null;
  let memoryTimer: ReturnType<typeof setInterval> | null = null;
  /** Карта зеркальной раскладки — funbox layout_mirror. */
  let mirror: Record<string, string> | null = null;
  /** Раскладки, между которыми переключает layoutfluid, и текущая ступень. */
  let fluidStep = -1;
  /** Сигнал о конце времени звучит один раз за тест. */
  let timeWarned = false;
  /** Последняя выданная цитата — для настройки «повторять цитату». */
  let lastQuote: string[] | null = null;
  /** Источник цитаты. Сервер его отдаёт, и на результате ему самое место. */
  let quoteSource: string | null = null;
  /** Готовая подпись со средними значениями для строки режимов. */
  let averageText = "";
  /** Кэш для режимов average / pb / last / daily — по одному запросу на страницу. */
  let paceStats: Stats | null = null;
  let paceResults: Result[] | null = null;

  /**
   * Режим набора: шапка, футер и подсказки приглушаются, пока человек печатает.
   * Атрибут именно на <header data-focused> — на нём завязаны 7 файлов тем.
   */
  function setFocused(on: boolean): void {
    document.querySelector("header")?.toggleAttribute("data-focused", on);
    document.body.classList.toggle("typing", on);
  }

  // ---------- оформление, зависящее от настроек ----------

  function applyLook(): void {
    const s = getSettings();

    // Размер и гарнитуру ставим обёртке — каретка её сосед и должна
    // считать свою ширину от того же кегля
    wrapperEl.style.fontSize = `${s.fontSize}rem`;
    wrapperEl.style.fontFamily = `"${s.fontFamily}", monospace`;
    wordsEl.style.maxWidth = s.maxLineWidth > 0 ? `${s.maxLineWidth}ch` : "";
    // Плавная прокрутка строк: с настройкой строки едут, без неё — прыгают
    wordsEl.style.transition = s.smoothLineScroll ? "transform 0.15s ease" : "none";

    // Классы режимов отображения — их читает css
    const { classes, bodyClasses, cssFiles } = funboxVisuals(s.funbox);

    // Часть их css целится в body (crt.css — целиком в body.crtmode)
    document.body.classList.remove(...FUNBOX_BODY_CLASSES);
    if (bodyClasses.length) document.body.classList.add(...bodyClasses);

    // crt.css рисует бегущую полосу по отдельному элементу
    const scanline = document.getElementById("scanline");
    if (bodyClasses.includes("crtmode")) {
      if (!scanline) {
        const el = document.createElement("div");
        el.id = "scanline";
        document.body.appendChild(el);
      }
    } else {
      scanline?.remove();
    }

    // Имена классов ровно те же, что у monkeytype: blind, hideExtraLetters,
    // highlight-next-three-words (через дефис), typed-effect-*. На них
    // напрямую целятся 52 файла тем — свои имена ломали половину из них.
    wordsEl.className = [
      // Размытие держим здесь же: applyLook пересобирает класс целиком,
      // и добавленный по blur класс blurred иначе слетал — подсказка
      // «нажмите сюда» оставалась лежать на чётких словах
      focusEl.hidden ? "" : "blurred",
      s.blindMode ? "blind" : "",
      s.colorfulMode ? "colorfulMode" : "",
      s.flipTestColors ? "flipped" : "",
      s.hideExtraLetters ? "hideExtraLetters" : "",
      s.showAllLines ? "allLines" : "",
      s.indicateTypos !== "off" ? `indicate-${s.indicateTypos}` : "",
      s.tapeMode !== "off" ? `tape tape-${s.tapeMode}` : "",
      `highlight-${s.highlightMode.replace(/_/g, "-")}`,
      `typed-effect-${s.typedEffect}`,
      ...classes,
    ]
      .filter(Boolean)
      .join(" ");

    // У них часть классов дублируется на обёртке — css funbox и тем
    // целится то в #words, то в #wordsWrapper
    wrapperEl.className = [
      s.blindMode ? "blind" : "",
      s.hideExtraLetters ? "hideExtraLetters" : "",
      s.tapeMode !== "off" ? "tape" : "",
    ]
      .filter(Boolean)
      .join(" ");

    caretEl.className = `${s.caretStyle} smooth-${s.smoothCaret}`;

    // Стили funbox лежат отдельными файлами, подключаем нужные
    document.querySelectorAll("link[data-funbox]").forEach((el) => el.remove());
    for (const name of cssFiles) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset["funbox"] = name;
      link.href = `/static/funbox/${name}.css`;
      document.head.appendChild(link);
    }

    // Своя картинка фоном
    if (s.customBackground) {
      document.body.style.backgroundImage = `url("${s.customBackground}")`;
      document.body.style.backgroundSize = s.customBackgroundSize;
      document.body.style.backgroundPosition = "center";
      if (s.customBackgroundFilter) document.body.style.filter = s.customBackgroundFilter;
    } else {
      document.body.style.backgroundImage = "";
      document.body.style.filter = "";
    }

    // Подсказки как в monkeytype: рестарт и командная строка. Если клавиша
    // рестарта выключена, про неё не пишем — раньше подсказка врала «tab».
    // Если рестарт занял esc, командная строка остаётся на ctrl+shift+p.
    hintEl.hidden = !s.showKeyTips;
    hintEl.innerHTML = [
      s.quickRestart === "off"
        ? ""
        : `<span><kbd>${s.quickRestart}</kbd> начать заново</span>`,
      `<span><kbd>${
        s.quickRestart === "esc" ? "ctrl+shift+p" : "esc"
      }</kbd> командная строка</span>`,
    ]
      .filter(Boolean)
      .join("");

    configureSound({
      click: s.soundOnClick,
      error: s.soundOnError,
      volume: s.soundVolume,
    });
  }

  // ---------- клавиатура на экране ----------

  /**
   * Раскладки, между которыми переключает layoutfluid. Меняются на трети
   * и на двух третях теста — как у monkeytype, только список у нас
   * фиксированный: своего `customLayoutfluid` мы пока не завели.
   */
  const FLUID_LAYOUTS = ["qwerty", "dvorak", "colemak"];

  /** Готовим зеркальную карту, если включён layout_mirror. */
  async function prepareMirror(): Promise<void> {
    const s = getSettings();
    if (!s.funbox.includes("layout_mirror")) {
      mirror = null;
      return;
    }

    const layout = await loadLayout(s.layout);
    mirror = layout ? mirrorMap(layout) : null;
  }

  /** layoutfluid: раскладка на экране меняется по ходу теста. */
  function updateFluidLayout(): void {
    const s = getSettings();
    if (!s.funbox.includes("layoutfluid") || !engine) {
      fluidStep = -1;
      return;
    }

    const step = Math.min(
      FLUID_LAYOUTS.length - 1,
      Math.floor(engine.stats.progress * FLUID_LAYOUTS.length),
    );
    if (step === fluidStep) return;

    fluidStep = step;
    const next = FLUID_LAYOUTS[step]!;
    notify(`раскладка: ${next}`);
    updateSettings({ keymapLayout: next });
  }

  async function drawKeymap(): Promise<void> {
    const s = getSettings();

    if (s.keymapMode === "off") {
      keymapEl.hidden = true;
      keymapEl.innerHTML = "";
      return;
    }

    const layout = await loadLayout(s.keymapLayout || s.layout);
    if (!layout) {
      keymapEl.hidden = true;
      return;
    }

    keymapEl.hidden = false;
    keymapEl.className = `keymap-${s.keymapStyle} legend-${s.keymapLegendStyle}`;
    keymapEl.style.setProperty("--keymap-size", String(s.keymapSize));
    keymapEl.innerHTML = renderKeymap(layout, s.keymapKeys !== "minimal");
  }

  /**
   * memory: текст дают запомнить несколько секунд, потом прячут.
   * Отсчёт показываем строкой над словами — иначе непонятно, сколько осталось.
   */
  function startMemory(): void {
    stopMemory();
    wordsEl.classList.remove("memoryHidden");

    if (!getSettings().funbox.includes("memory")) {
      memoryEl.hidden = true;
      return;
    }

    let left = MEMORY_SECONDS;
    memoryEl.hidden = false;
    memoryEl.textContent = `запоминайте: ${left}`;

    memoryTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        memoryEl.textContent = `запоминайте: ${left}`;
        return;
      }

      stopMemory();
      memoryEl.hidden = true;
      wordsEl.classList.add("memoryHidden");
    }, 1000);
  }

  function stopMemory(): void {
    if (memoryTimer !== null) {
      clearInterval(memoryTimer);
      memoryTimer = null;
    }
  }

  /** Языки для polyglot: выбранный плюс два самых ходовых, кроме него самого. */
  function polyglotLanguages(current: string): string[] {
    const others = ["english", "russian", "spanish"].filter((name) => name !== current);
    return [current, ...others].slice(0, 3);
  }

  function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * weakspot: чаще подсовываем слова с буквами, на которых человек ошибается.
   * Статистику по буквам копим сами — сервер про неё ничего не знает.
   */
  function weakspotSort(words: string[]): string[] {
    const misses = readWeakspot();
    if (Object.keys(misses).length === 0) return words;

    const score = (word: string): number =>
      [...word.toLowerCase()].reduce((sum, ch) => sum + (misses[ch] ?? 0), 0);

    // Не сортируем жёстко: тогда текст стал бы одинаковым от теста к тесту.
    // Берём половину самых «трудных» и подмешиваем к ним обычные.
    const ranked = [...words].sort((a, b) => score(b) - score(a));
    const hard = ranked.slice(0, Math.ceil(ranked.length / 2));
    return shuffle([...hard, ...hard, ...ranked.slice(hard.length)]).slice(0, words.length);
  }

  function readWeakspot(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(WEAKSPOT_KEY) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  }

  /** Запомнить букву, на которой ошиблись. */
  function rememberMiss(char: string): void {
    const key = char.toLowerCase();
    if (key.trim() === "") return;

    const misses = readWeakspot();
    misses[key] = (misses[key] ?? 0) + 1;

    try {
      localStorage.setItem(WEAKSPOT_KEY, JSON.stringify(misses));
    } catch {
      // приватный режим — просто не копим статистику
    }
  }

  /**
   * Свой текст теста. Хранится в localStorage, а не в настройках:
   * это не настройка на 84 ключа, а содержимое одного режима, и таскать
   * его в каждом сохранении конфига незачем.
   */
  function openCustomText(): void {
    askText({
      title: "свой текст",
      label: "что печатать. переносы строк станут пробелами",
      value: localStorage.getItem(CUSTOM_TEXT_KEY) ?? "",
      placeholder: "вставьте сюда любой текст",
      onPick: (text) => {
        localStorage.setItem(CUSTOM_TEXT_KEY, text);
        updateSettings({ mode: "custom" });
        renderConfig();
        void startTest();
      },
    });
  }

  // ---------- строка активных режимов ----------

  /**
   * Что сейчас включено: язык, funbox, сложность, пороги, темп.
   * У monkeytype это отдельная строка под панелью режимов, и именно
   * там живут язык и funbox — в самой панели их нет.
   */
  function renderNotice(): void {
    const s = getSettings();
    const parts: string[] = [];

    const item = (
      ico: string,
      text: string,
      action = "",
      cls = "",
    ): string =>
      `<button class="notice${cls ? ` ${cls}` : ""}"${action ? ` data-notice="${action}"` : ""}>
         ${icon(ico)}<span>${escapeHtml(text)}</span>
       </button>`;

    if (!s.resultSaving) parts.push(item("save", "сохранение выключено", "", "error"));
    parts.push(item("globe", s.language.replace(/_/g, " "), "language"));

    if (s.difficulty !== "normal") {
      parts.push(item("star", s.difficulty === "expert" ? "эксперт" : "мастер", "difficulty"));
    }
    if (s.blindMode) parts.push(item("eyeSlash", "слепой режим", "blindMode"));
    if (s.lazyMode) parts.push(item("couch", "без диакритики", "lazyMode"));
    if (s.paceCaret !== "off") {
      parts.push(item("tachometer", `темп: ${paceLabel(s.paceCaret)}`, "paceCaret"));
    }
    if (s.showAverage !== "off" && averageText) parts.push(item("chart", averageText));
    if (s.minWpm !== "off") parts.push(item("bomb", `не ниже ${s.minWpmCustomSpeed} wpm`, "minWpm"));
    if (s.minAcc !== "off") parts.push(item("bomb", `не ниже ${s.minAccCustom}%`, "minAcc"));
    if (s.minBurst !== "off") {
      parts.push(
        item("bomb", `слово не ниже ${s.minBurstCustomSpeed} wpm`, "minBurst"),
      );
    }
    if (s.funbox.length) {
      parts.push(item("gamepad", s.funbox.map((n) => n.replace(/_/g, " ")).join(", "), "funbox"));
    }
    if (s.confidenceMode !== "off") {
      parts.push(
        item("bolt", s.confidenceMode === "max" ? "полная уверенность" : "уверенность", "confidenceMode"),
      );
    }
    if (s.stopOnError !== "off") {
      parts.push(item("hand", `стоп на ${s.stopOnError === "word" ? "слове" : "букве"}`, "stopOnError"));
    }
    if (s.deleteOnError !== "off") {
      parts.push(
        item("eraser", `стирать ${s.deleteOnError === "word" ? "слово" : "букву"}`, "deleteOnError"),
      );
    }
    if (s.layout !== "qwerty") parts.push(item("keyboard", `раскладка ${s.layout}`, "layout"));

    noticeEl.innerHTML = parts.join("");
  }

  function paceLabel(mode: string): string {
    const names: Record<string, string> = {
      average: "средний",
      pb: "рекорд",
      last: "прошлый",
      daily: "лучший за день",
      custom: `${getSettings().paceCaretCustomSpeed} wpm`,
    };
    return names[mode] ?? mode;
  }

  /** Средние значения для строки режимов — один запрос на страницу. */
  async function loadAverage(): Promise<void> {
    const s = getSettings();
    if (s.showAverage === "off" || !getToken()) {
      averageText = "";
      return;
    }

    try {
      paceStats ??= await api.myStats();
      const speed = `${Math.round(paceStats.avg_wpm)} ${
        SPEED_UNITS[s.typingSpeedUnit]?.label ?? "wpm"
      }`;
      const accuracy = `${Math.round(paceStats.avg_accuracy)}%`;

      if (s.showAverage === "speed") averageText = `в среднем ${speed}`;
      else if (s.showAverage === "acc") averageText = `в среднем ${accuracy}`;
      else averageText = `в среднем ${speed} · ${accuracy}`;
    } catch {
      averageText = "";
    }
    renderNotice();
  }

  noticeEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-notice]");
    const action = button?.dataset["notice"];
    if (!action) return;

    if (action === "language") {
      void openLanguagePicker((language) => {
        updateSettings({ language: language as string });
        void startTest();
      });
      return;
    }
    if (action === "funbox") {
      openFunboxPicker((chosen) => updateSettings({ funbox: chosen as string[] }));
      return;
    }
    // Остальное правится там же, где и всё прочее
    navigate("/settings");
  });

  // ---------- панель настроек теста ----------

  function renderConfig(): void {
    const s = getSettings();

    const modes: Array<[TestMode, string, string]> = [
      ["time", "clock", "время"],
      ["words", "font", "слова"],
      ["quote", "quote", "цитата"],
      ["zen", "bolt", "zen"],
      ["custom", "alignLeft", "свой текст"],
    ];

    // Пунктуация и цифры не действуют на цитату, zen и свой текст —
    // у них текст задан, подмешивать в него нечего
    const textModes = s.mode === "time" || s.mode === "words";
    const values = s.mode === "time" ? TIME_OPTIONS : WORD_OPTIONS;
    const active = modeValue(s);
    // «Своё» значение подсвечено, когда оно не из списка
    const custom = textModes && !values.includes(active);

    configEl.innerHTML = `
      ${
        s.mode === "zen"
          ? ""
          : `<div class="group">
               <button class="button${s.punctuation ? " active" : ""}"
                       data-toggle="punctuation"${textModes ? "" : " disabled"}>
                 ${icon("at")} пункт.
               </button>
               <button class="button${s.numbers ? " active" : ""}"
                       data-toggle="numbers"${textModes ? "" : " disabled"}>
                 ${icon("hashtag")} цифры
               </button>
             </div>
             <div class="divider"></div>`
      }
      <div class="group">
        ${modes
          .map(
            ([key, ico, label]) =>
              `<button class="button${s.mode === key ? " active" : ""}" data-mode="${key}">
                 ${icon(ico)} ${label}
               </button>`,
          )
          .join("")}
      </div>
      ${
        textModes
          ? `<div class="divider"></div>
             <div class="group">
               ${values
                 .map(
                   (v) =>
                     `<button class="button${active === v ? " active" : ""}" data-value="${v}">${v}</button>`,
                 )
                 .join("")}
               <button class="button${custom ? " active" : ""}" data-custom-value
                       aria-label="своё значение" data-balloon-pos="up">
                 ${icon("gear")}${custom ? ` ${active}` : ""}
               </button>
             </div>`
          : ""
      }
      ${
        s.mode === "custom"
          ? `<div class="divider"></div>
             <div class="group">
               <button class="button" data-custom-text>${icon("alignLeft")} изменить</button>
             </div>`
          : ""
      }
    `;
  }

  configEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!button) return;

    const { mode, value, toggle } = button.dataset;
    const s = getSettings();

    // Своё значение времени или числа слов
    if (button.hasAttribute("data-custom-value")) {
      const isTime = s.mode === "time";
      askNumber({
        title: isTime ? "своя длительность" : "своё число слов",
        label: isTime ? "секунд" : "слов",
        value: modeValue(s),
        min: isTime ? 1 : 1,
        max: isTime ? 3600 : 500,
        onPick: (picked) => {
          updateSettings(isTime ? { timeValue: picked } : { wordsValue: picked });
          renderConfig();
          void startTest();
        },
      });
      return;
    }

    // Свой текст
    if (button.hasAttribute("data-custom-text")) {
      openCustomText();
      return;
    }

    if (mode) updateSettings({ mode: mode as TestMode });
    else if (value) {
      updateSettings(s.mode === "time" ? { timeValue: +value } : { wordsValue: +value });
    } else if (toggle === "punctuation") updateSettings({ punctuation: !s.punctuation });
    else if (toggle === "numbers") updateSettings({ numbers: !s.numbers });
    else return;

    renderConfig();
    void startTest();
  });

  // ---------- отрисовка слов ----------

  function renderWords(): void {
    if (!engine) return;

    const s = getSettings();
    const limit = visibleWordLimit(s.funbox);

    const parts: string[] = [];

    for (let index = 0; index < engine.words.length; index += 1) {
      // Режимы plus_* показывают лишь несколько слов вперёд
      if (limit !== null && (index < engine.wordIndex || index >= engine.wordIndex + limit)) {
        continue;
      }

      const word = engine.words[index]!;
      const states = engine.charStates(index);

      const letters: string[] = [];
      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]!;
        // Лишние буквы можно не показывать вовсе
        if (state === "extra" && s.hideExtraLetters) continue;

        const char = i < word.target.length ? word.target[i]! : word.typed[i]!;
        // Лишняя буква у них помечена сразу двумя классами — есть темы,
        // которые красят именно .incorrect.extra
        const name = state === "extra" ? "incorrect extra" : state;
        const cls = state === "pending" ? "" : ` class="${name}"`;

        // Показ опечаток: что именно было набрано вместо нужной буквы.
        // below — подписью снизу, replace — вместо самой буквы.
        const typed = state === "incorrect" ? word.typed[i] : undefined;
        const shown = s.indicateTypos === "replace" && typed ? typed : char;
        const data =
          s.indicateTypos === "below" && typed ? ` data-typed="${escapeHtml(typed)}"` : "";

        letters.push(`<letter${cls}${data}>${escapeHtml(shown)}</letter>`);
      }

      const error = word.done && word.typed !== word.target;
      const active = index === engine.wordIndex;

      // Тепловая карта: цвет слова по скорости его набора
      const heat = s.burstHeatmap && word.done ? ` data-heat="${heatLevel(word.burst)}"` : "";

      parts.push(
        `<div class="word${error ? " error" : ""}${word.done ? " typed" : ""}${
          active ? " active" : ""
        }" data-wordindex="${index}"${heat}>${letters.join("")}</div>`,
      );
    }

    wordsEl.innerHTML = parts.join("");
    fitWrapper();
    scrollLines();
    moveCaret();
    updateKeymapHint();
  }

  function heatLevel(burst: number): number {
    if (burst <= 0) return 0;
    if (burst < 40) return 1;
    if (burst < 70) return 2;
    if (burst < 100) return 3;
    return 4;
  }

  /**
   * Шаг строки — расстояние между двумя соседними строками слов.
   *
   * Меряем его по разнице offsetTop первого слова и первого слова второй
   * строки, а не собираем из offsetHeight и полей. Собранное значение
   * расходится с настоящим на доли пикселя от округления offsetHeight,
   * а с рамкой или своим line-height из css темы либо funbox — и на
   * несколько пикселей. Прокрутка от такого шага сдвигает текст не на
   * целую строку: верхняя уезжает наполовину, нижняя не доходит.
   *
   * Пока строка одна (узкое окно, лента, самое начало отрисовки), считать
   * нечего — возвращаемся к прежнему счёту по полям.
   */
  function lineHeight(): number {
    const words = wordsEl.querySelectorAll<HTMLElement>(".word");
    const first = words[0];
    if (!first) return 0;

    for (const word of words) {
      const step = word.offsetTop - first.offsetTop;
      if (step > 0) return step;
    }

    const style = getComputedStyle(first);
    return first.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }

  function fitWrapper(): void {
    const s = getSettings();

    if (s.showAllLines && s.tapeMode === "off") {
      wrapperEl.style.height = "";
      return;
    }

    const height = lineHeight();
    if (!height) return;

    const lines = s.tapeMode === "off" ? VISIBLE_LINES : 1;
    wrapperEl.style.height = `${height * lines}px`;
  }

  /** Прокрутка строк: текущее слово держим на второй строке из трёх. */
  function scrollLines(): void {
    if (!engine) return;
    if (getSettings().showAllLines || getSettings().tapeMode !== "off") {
      wordsEl.style.transform = "";
      return;
    }

    const activeEl = wordsEl.querySelector<HTMLElement>(`.word[data-wordindex="${engine.wordIndex}"]`);
    const firstEl = wordsEl.querySelector<HTMLElement>(`.word[data-wordindex="0"]`);
    if (!activeEl || !firstEl) return;

    const step = lineHeight();
    if (step === 0) return;

    const activeLine = Math.round((activeEl.offsetTop - firstEl.offsetTop) / step);

    // Ниже последней строки прокручивать нечего. Без этой границы короткий
    // тест (25 слов — это ровно три строки) уезжал вверх на пустое место:
    // первая строка уходила, четвёртой не существовало, и внизу оставалась
    // дыра, а к концу текста область слов пустела совсем.
    const lastEl = wordsEl.querySelector<HTMLElement>(".word:last-child");
    const lastLine = lastEl ? Math.round((lastEl.offsetTop - firstEl.offsetTop) / step) : 0;
    const maxOffset = Math.max(0, lastLine - (VISIBLE_LINES - 1));

    const desired = Math.min(Math.max(0, activeLine - 1), maxOffset);

    if (desired !== lineOffset) {
      lineOffset = desired;
      wordsEl.style.transform = `translateY(${-lineOffset * step}px)`;
    }
  }

  /** Пока идёт набор, каретка не мигает — как в monkeytype. */
  function holdCaret(): void {
    caretEl.classList.add("typing");
    if (blinkTimer !== null) clearTimeout(blinkTimer);
    stopMemory();
    blinkTimer = setTimeout(() => caretEl.classList.remove("typing"), 600);
  }

  function moveCaret(): void {
    if (!engine) return;

    const s = getSettings();
    if (s.caretStyle === "off") {
      caretEl.hidden = true;
      return;
    }

    const wordEl = wordsEl.querySelector<HTMLElement>(`.word[data-wordindex="${engine.wordIndex}"]`);
    if (!wordEl) {
      caretEl.hidden = true;
      return;
    }

    const word = engine.words[engine.wordIndex]!;
    const letters = wordEl.querySelectorAll<HTMLElement>("letter");
    const target = letters[word.typed.length];
    const anchor = target ?? letters[letters.length - 1] ?? wordEl;

    const box = wrapperEl.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();

    caretEl.hidden = false;
    caretEl.style.left = `${(target ? rect.left : rect.right) - box.left}px`;
    caretEl.style.top = `${rect.top - box.top}px`;
    caretEl.style.height = `${rect.height || 24}px`;
    caretEl.style.width = s.caretStyle === "block" || s.caretStyle === "outline"
      ? `${rect.width || 12}px`
      : "";

    // Лента: вместо движения каретки двигаем сам текст
    if (s.tapeMode !== "off") {
      const shift = rect.left - box.left - (box.width * s.tapeMargin) / 100;
      wordsEl.style.transform = `translateX(${-shift}px)`;
      caretEl.style.left = `${(box.width * s.tapeMargin) / 100}px`;
    }
  }

  function updateKeymapHint(): void {
    if (!engine || keymapEl.hidden) return;

    const s = getSettings();
    if (s.keymapMode !== "next") return;

    const word = engine.words[engine.wordIndex];
    const next = word?.target[word.typed.length] ?? "";
    highlightNext(keymapEl, next);
  }

  // ---------- показатели ----------

  function formatSpeed(wpm: number): string {
    const s = getSettings();
    const unit = SPEED_UNITS[s.typingSpeedUnit] ?? SPEED_UNITS["wpm"]!;
    const value = wpm * unit.factor;
    return s.alwaysShowDecimalPlaces ? value.toFixed(2) : String(Math.round(value));
  }

  /**
   * Живые показатели. Раскладка повторяет monkeytype, а не собирает всё
   * в одну строку над словами:
   *   text — огромные цифры, таймер над словами, скорость и точность под;
   *   mini — мелкой строкой над словами слева (в ленте — по отступу ленты);
   *   bar  — полоса во всю ширину экрана, приклеенная к его верху.
   */
  function renderLive(): void {
    if (!engine) return;

    const s = getSettings();
    const stats = engine.stats;

    const timerText =
      s.mode === "time"
        ? String(Math.ceil(stats.remaining))
        : `${engine.wordIndex}/${engine.words.length}`;

    const unit = SPEED_UNITS[s.typingSpeedUnit]?.label ?? "wpm";
    const values: Array<[style: string, html: string]> = [
      [s.liveSpeedStyle, `${formatSpeed(stats.wpm)}<span class="label">${unit}</span>`],
      [s.liveAccStyle, `${stats.accuracy.toFixed(0)}<span class="label">%</span>`],
      [
        s.liveBurstStyle,
        `${formatSpeed(engine.currentBurst)}<span class="label">${unit}</span>`,
      ],
    ];

    // Полоса времени: у них она приклеена к верху окна, а не живёт в потоке
    barEl.hidden = s.timerStyle !== "bar";
    barEl.className = `timer-${s.timerColor}`;
    barEl.style.opacity = s.timerOpacity;
    barEl.style.setProperty("--progress", `${stats.progress * 100}%`);

    // Мелкая строка сверху: таймер и те показатели, что выбраны mini
    const mini: string[] = [];
    if (s.timerStyle === "mini") mini.push(`<span class="value">${timerText}</span>`);
    for (const [style, html] of values) {
      if (style === "mini" && engine.started) mini.push(`<span class="value">${html}</span>`);
    }

    miniEl.innerHTML = mini.join("");
    miniEl.className = `timer-${s.timerColor}`;
    miniEl.style.opacity = s.timerOpacity;
    miniEl.style.fontSize = `${s.fontSize}rem`;
    // В ленте счётчик стоит там же, где каретка
    miniEl.style.marginLeft = s.tapeMode === "off" ? "0.25em" : `${s.tapeMargin}%`;

    // Крупный таймер над словами
    topEl.innerHTML = s.timerStyle === "text" ? timerText : "";
    // Класс wrap оставляем: className переписывает список целиком,
    // а по нему находят этот блок при отрисовке
    topEl.className = `wrap timer-${s.timerColor}`;
    topEl.style.opacity = s.timerOpacity;

    // Крупные показатели под словами
    const bottom: string[] = [];
    for (const [style, html] of values) {
      if (style === "text" && engine.started) bottom.push(`<span class="value">${html}</span>`);
    }
    bottomEl.innerHTML = bottom.join("");
  }

  /** Сигнал за N секунд до конца — один раз за тест. */
  function warnAboutTime(): void {
    const s = getSettings();
    if (s.playTimeWarning === "off" || s.mode !== "time") return;
    if (timeWarned || !engine || !engine.started || engine.finished) return;

    const left = Math.ceil(engine.stats.remaining);
    if (left > 0 && left <= Number(s.playTimeWarning)) {
      timeWarned = true;
      playTimeWarning();
    }
  }

  // ---------- каретка-соперник ----------

  /**
   * Скорость соперника. Раньше сюда всегда подставлялось своё значение,
   * и режимы average/pb/last были неотличимы от custom.
   * Ответ сервера кэшируем: иначе запрос уходил бы на каждый рестарт.
   */
  async function paceTargetWpm(): Promise<number> {
    const s = getSettings();
    const fallback = s.paceCaretCustomSpeed;

    if (s.paceCaret === "custom" || !getToken()) return fallback;

    try {
      if (s.paceCaret === "average" || s.paceCaret === "pb") {
        paceStats ??= await api.myStats();
        const value = s.paceCaret === "average" ? paceStats.avg_wpm : paceStats.best_wpm;
        return value > 0 ? value : fallback;
      }

      if (s.paceCaret === "last" || s.paceCaret === "daily") {
        paceResults ??= await api.myResults(100);
        if (s.paceCaret === "last") return paceResults[0]?.wpm || fallback;

        const today = new Date().toDateString();
        const best = paceResults
          .filter((r) => new Date(r.created_at).toDateString() === today)
          .reduce((max, r) => Math.max(max, r.wpm), 0);
        return best > 0 ? best : fallback;
      }
    } catch {
      // нет сети или нет истории — идём по своему значению
    }

    return fallback;
  }

  async function startPaceCaret(): Promise<void> {
    const s = getSettings();
    if (s.paceCaret === "off" || !engine) return;

    const targetWpm = await paceTargetWpm();
    if (!engine || engine.finished) return;

    const totalChars = engine.words.reduce((sum, w) => sum + w.target.length + 1, 0);

    stopPaceCaret();
    paceTimer = setInterval(() => {
      if (!engine || engine.finished) return;
      // Соперник печатает ровно targetWpm: пять символов на слово
      const charsPerTick = (targetWpm * 5) / 60 / 10;
      paceProgress = Math.min(1, paceProgress + charsPerTick / totalChars);
      drawPaceCaret();
    }, 100);
  }

  function stopPaceCaret(): void {
    if (paceTimer !== null) {
      clearInterval(paceTimer);
      paceTimer = null;
    }
  }

  function drawPaceCaret(): void {
    let pace = wrapperEl.querySelector<HTMLElement>("#paceCaret");
    if (!pace) {
      pace = document.createElement("div");
      pace.id = "paceCaret";
      wrapperEl.appendChild(pace);
    }

    const letters = wordsEl.querySelectorAll<HTMLElement>("letter");
    if (letters.length === 0) return;

    const index = Math.min(letters.length - 1, Math.floor(paceProgress * letters.length));
    const rect = letters[index]!.getBoundingClientRect();
    const box = wrapperEl.getBoundingClientRect();

    pace.style.left = `${rect.left - box.left}px`;
    pace.style.top = `${rect.top - box.top}px`;
    pace.style.height = `${rect.height}px`;
  }

  // ---------- жизненный цикл ----------

  /** Случайная тема на каждый тест. Настройку theme при этом не трогаем —
   *  выбранная человеком тема должна пережить выключение режима. */
  async function maybeRandomTheme(): Promise<void> {
    const s = getSettings();
    if (s.randomTheme === "off") return;

    const favourites = s.favThemes
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    const name = await pickRandomTheme(s.randomTheme, favourites);
    if (name) await applyThemeByName(name);
  }

  /**
   * @param options.words готовый текст — для кнопок «повторить тот же»
   *        и «практика ошибочных слов». Тогда за словами не ходим.
   */
  async function startTest(options: { words?: string[] } = {}): Promise<void> {
    engine?.dispose();
    unsubscribe?.();
    stopPaceCaret();

    submitting = false;
    lineOffset = 0;
    paceProgress = 0;
    timeWarned = false;
    wordsEl.style.transform = "";

    const s = getSettings();
    const count = s.mode === "time" ? Math.max(120, s.timeValue * 4) : s.wordsValue;

    miniEl.innerHTML = `<span class="value sub">…</span>`;
    wordsEl.innerHTML = "";

    let words: string[];
    try {
      if (options.words) {
        // Готовый текст funbox-преобразованиям больше не подвергаем:
        // он уже прошёл их в тесте, из которого пришёл
        words = [...options.words];
      } else if (s.mode === "zen") {
        // В zen текста нет вовсе: движок дописывает пустые слова по ходу
        words = [""];
      } else if (s.mode === "custom") {
        const stored = (localStorage.getItem(CUSTOM_TEXT_KEY) ?? "").trim();
        if (stored === "") {
          wordsEl.innerHTML = `<span class="sub">нажмите «изменить» и вставьте свой текст</span>`;
          miniEl.innerHTML = "";
          return;
        }
        words = stored.split(/\s+/).filter(Boolean);
      } else if (s.funbox.includes("polyglot")) {
        // polyglot: слова из нескольких языков вперемешку. Языки берём
        // соседние по списку, чтобы набор был предсказуемым, а не случайным
        const languages = polyglotLanguages(s.language);
        const perLanguage = Math.ceil(count / languages.length);

        const batches = await Promise.all(
          languages.map((language) =>
            api
              .words(language, perLanguage, s.punctuation, s.numbers)
              .then((r) => r.words)
              .catch(() => [] as string[]),
          ),
        );

        // Перемешиваем, иначе получится три языка подряд, а не вперемешку
        words = shuffle(batches.flat()).slice(0, count);
        if (words.length === 0) throw new ApiError("Не удалось собрать текст", 500);
      } else if (s.mode === "quote") {
        // «повторять цитату»: при рестарте отдаём ту же самую, а не новую
        if (s.repeatQuotes === "typing" && lastQuote !== null) {
          words = [...lastQuote];
        } else {
          const response = await api.text(s.language, count, "quote");
          words = response.words;
          lastQuote = [...words];
          quoteSource = response.source;
        }
      } else {
        // zipf просит у сервера выборку, смещённую к началу словаря:
        // файлы monkeytype отсортированы по убыванию частоты слова
        const response = await api.words(
          s.language,
          count,
          s.punctuation,
          s.numbers,
          s.funbox.includes("zipf"),
        );
        words = response.words;
        quoteSource = null;
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Сервер недоступен";
      wordsEl.innerHTML = `<span class="error">${escapeHtml(message)}</span>`;
      miniEl.innerHTML = "";
      return;
    }

    if (disposed) return;

    if (s.funbox.includes("weakspot")) words = weakspotSort(words);
    words = applyFunboxText(words, s.funbox);

    engine = new TypingEngine({
      mode: s.mode,
      // У цитаты и своего текста длина известна только после загрузки,
      // у zen её нет вовсе
      modeValue:
        s.mode === "quote" || s.mode === "custom"
          ? words.length
          : s.mode === "zen"
            ? 0
            : modeValue(s),
      language: s.language,
      words,
      difficulty: s.difficulty,
      stopOnError: s.stopOnError,
      freedomMode: s.freedomMode,
      confidenceMode: s.confidenceMode,
      quickEnd: s.quickEnd,
      strictSpace: s.strictSpace,
      deleteOnError: s.deleteOnError,
      minWpm: s.minWpm,
      minWpmCustomSpeed: s.minWpmCustomSpeed,
      minAcc: s.minAcc,
      minAccCustom: s.minAccCustom,
      minBurst: s.minBurst,
      minBurstCustomSpeed: s.minBurstCustomSpeed,
    });

    unsubscribe = engine.subscribe((event) => {
      if (event === "correct") playClick();
      else if (event === "error") {
        playError();
        // Копим статистику по буквам для funbox weakspot
        const word = engine?.words[engine.wordIndex];
        const expected = word?.target[word.typed.length];
        if (expected) rememberMiss(expected);
      }

      renderWords();
      renderLive();

      const typing = engine?.started === true && engine.finished === false;
      configEl.classList.toggle("hidden", typing);
      setFocused(typing);
      warnAboutTime();
      updateFluidLayout();

      if (getSettings().keymapMode === "react" && event) {
        const word = engine?.words[engine.wordIndex];
        flashKey(keymapEl, word?.typed.slice(-1) ?? "", event === "error");
      }

      if (engine?.finished) void finishTest();
    });

    applyLook();
    await drawKeymap();
    void maybeRandomTheme();
    startMemory();
    await prepareMirror();
    fluidStep = -1;

    inputEl.value = "";
    renderWords();
    renderLive();
    configEl.classList.remove("hidden");
    setFocused(false);
    inputEl.focus();
  }

  async function finishTest(): Promise<void> {
    if (!engine || submitting) return;
    submitting = true;
    stopPaceCaret();
    setFocused(false);

    const s = getSettings();
    const summary = engine.summary;

    /**
     * Прошлый рекорд спрашиваем до сохранения. После него в статистике уже
     * лежит нынешний результат, и показать, что было раньше, нечем —
     * а плашка рекорда без старого значения ничего не сообщает.
     */
    let before: Stats | null = null;
    if (getToken() && s.showPb) {
      try {
        before = await api.myStats();
      } catch {
        // Не критично: просто не покажем ни рекорд, ни «сегодня»
      }
    }

    let saved: Result | null = null;
    let message = "";
    /** Обрыв связи, а не отказ сервера: такую отправку можно повторить. */
    let retryable = false;

    async function trySave(): Promise<void> {
      if (!s.resultSaving) {
        message = "сохранение выключено в настройках";
        return;
      }
      if (summary.failed) {
        message = summary.failReason;
        return;
      }

      try {
        saved = await api.submitResult(summary);
        message = "";
        retryable = false;
      } catch (error) {
        message = error instanceof ApiError ? error.message : "Сервер недоступен";
        // 4xx повторять бессмысленно: сервер понял запрос и отказал
        retryable = !(error instanceof ApiError) || error.status >= 500;
        // Текстом внизу результата такое легко пропустить
        notify(message, "error");
      }
    }

    await trySave();

    const previousBest = before && before.tests > 0 ? before.best_wpm : null;
    const isBest =
      saved !== null &&
      getToken() !== null &&
      s.showPb &&
      (previousBest === null || Math.round(summary.wpm) > Math.round(previousBest));

    // Место в дневном лидерборде — тот же эндпоинт, что и на самой странице
    let dailyRank: number | null = null;
    if (saved && getToken()) {
      try {
        dailyRank = (await api.leaderboardMe({ period: "daily" })).rank;
      } catch {
        // Не критично — просто не покажем строку про место
      }
    }

    if (disposed) return;

    const unit = SPEED_UNITS[s.typingSpeedUnit]?.label ?? "wpm";
    const other = otherText();
    // Сегодняшнее время: то, что было до теста, плюс он сам — второй запрос
    // ради одного числа не нужен
    const todaySeconds = before ? before.time_today + summary.elapsed : null;

    testEl.innerHTML = `
      <div id="result">
        ${summary.failed ? `<div class="failed">${icon("xmark")} ${escapeHtml(summary.failReason)}</div>` : ""}
        ${
          isBest
            ? `<div class="personalBest" aria-label="${
                previousBest === null
                  ? "первый сохранённый результат"
                  : `прошлый рекорд — ${Math.round(previousBest)} ${unit}`
              }" data-balloon-pos="down">${icon("crown")} новый личный рекорд${
                previousBest === null
                  ? ""
                  : ` <span class="was">было ${Math.round(previousBest)}</span>`
              }</div>`
            : ""
        }
        <div class="stats">
          <div class="group">
            <div class="top">${unit}</div>
            <div class="bottom">${formatSpeed(summary.wpm)}</div>
          </div>
          <div class="group">
            <div class="top">точность</div>
            <div class="bottom">${summary.accuracy.toFixed(0)}%</div>
          </div>
          <div class="group small">
            <div class="top">raw</div>
            <div class="bottom">${formatSpeed(summary.raw)}</div>
          </div>
          <div class="group small">
            <div class="top">ровность</div>
            <div class="bottom">${summary.consistency.toFixed(0)}%</div>
          </div>
          <div class="group small">
            <div class="top">тип теста</div>
            <div class="bottom testType">${escapeHtml(testTypeText(summary))}</div>
          </div>
          ${
            other
              ? `<div class="group small">
                   <div class="top">прочее</div>
                   <div class="bottom testType">${escapeHtml(other)}</div>
                 </div>`
              : ""
          }
          <div class="group small">
            <div class="top">символы</div>
            <div class="bottom chars"
                 aria-label="верные / неверные / лишние / пропущенные"
                 data-balloon-pos="up">${charBreakdown(summary)}</div>
          </div>
          <div class="group small">
            <div class="top">время</div>
            <div class="bottom">${summary.elapsed.toFixed(1)}с${
              summary.afkSeconds > 0
                ? `<span class="afk" aria-label="время без нажатий" data-balloon-pos="up">afk ${summary.afkSeconds}с</span>`
                : ""
            }</div>
          </div>
          ${
            todaySeconds !== null
              ? `<div class="group small">
                   <div class="top">сегодня</div>
                   <div class="bottom">${formatDuration(todaySeconds)}</div>
                 </div>`
              : ""
          }
          ${
            dailyRank !== null
              ? `<div class="group small">
                   <div class="top">за сутки</div>
                   <div class="bottom">${dailyRank} место</div>
                 </div>`
              : ""
          }
        </div>
        ${
          quoteSource && s.mode === "quote"
            ? `<p class="quoteSource sub">${icon("quote")} ${escapeHtml(quoteSource)}</p>`
            : ""
        }
        <div class="chart">${renderChart(summary.wpmSamples, s.startGraphsAtZero)}</div>
        <div id="resultWordsHistory"${s.alwaysShowWordsHistory ? "" : " hidden"}>
          ${renderWordsHistory()}
        </div>
        <div id="saveNote"></div>
        ${
          getToken()
            ? ""
            : `<p class="sub center">
                 <a href="/login" class="main">войдите</a>, чтобы результат попал в лидерборд
               </p>`
        }
        <div class="actions">
          <button class="button" id="again" aria-label="следующий тест" data-balloon-pos="down">
            ${icon("chevronRight")}
          </button>
          <button class="button" id="repeat" aria-label="повторить тот же текст" data-balloon-pos="down">
            ${icon("sync")}
          </button>
          <button class="button" id="practise" aria-label="практика ошибочных слов" data-balloon-pos="down">
            ${icon("triangleExclamation")}
          </button>
          <button class="button" id="toggleHistory" aria-label="разбор слов" data-balloon-pos="down">
            ${icon("alignLeft")}
          </button>
          <button class="button" id="shot" aria-label="картинка результата" data-balloon-pos="down">
            ${icon("save")}
          </button>
          <a class="button" href="/leaderboard" aria-label="лидерборд" data-balloon-pos="down">
            ${icon("crown")}
          </a>
        </div>
      </div>
    `;

    const noteEl = testEl.querySelector<HTMLElement>("#saveNote")!;

    /** Подпись о сохранении, а при обрыве связи — кнопка повтора. */
    function drawNote(): void {
      if (saved) {
        noteEl.className = "sub center";
        noteEl.textContent = getToken()
          ? "результат сохранён"
          : "сохранено как гостевой — войдите, чтобы попасть в лидерборд";
        return;
      }

      noteEl.className = "center saveFailed";
      noteEl.innerHTML = `
        <span class="error">${escapeHtml(message)}</span>
        ${
          retryable
            ? `<button class="button" id="retrySave">${icon("sync")} повторить</button>`
            : ""
        }
      `;

      noteEl.querySelector<HTMLElement>("#retrySave")?.addEventListener("click", () => {
        noteEl.innerHTML = `<span class="sub">отправляем…</span>`;
        void trySave().then(drawNote);
      });
    }

    drawNote();

    // Слова прошлого теста нужны для «повторить» и «практики» — сам движок
    // к этому моменту уже будет заменён новым
    const wordsOfThisTest = engine.words.map((w) => w.target);
    const missedWords = engine.words
      .filter((w) => w.done && w.typed !== w.target)
      .map((w) => w.target);

    // Без обёртки в слушатель прилетел бы Event вместо списка слов
    testEl.querySelector<HTMLElement>("#again")?.addEventListener("click", () => restart());

    testEl.querySelector<HTMLElement>("#repeat")?.addEventListener("click", () => {
      restart(wordsOfThisTest);
    });

    const practise = testEl.querySelector<HTMLButtonElement>("#practise");
    if (practise) {
      practise.disabled = missedWords.length === 0;
      practise.addEventListener("click", () => {
        // Слова с ошибками повторяем по кругу, пока не наберётся полный тест
        const target = Math.max(missedWords.length, modeValue(getSettings()));
        const words = Array.from(
          { length: target },
          (_, i) => missedWords[i % missedWords.length]!,
        );
        restart(words);
      });
    }

    testEl.querySelector<HTMLElement>("#toggleHistory")?.addEventListener("click", () => {
      const history = testEl.querySelector<HTMLElement>("#resultWordsHistory");
      if (history) history.hidden = !history.hidden;
    });

    testEl.querySelector<HTMLElement>("#shot")?.addEventListener("click", () => {
      saveResultCard(summary, unit);
    });

    // Копирование слов и тепловая карта скоростей — обе кнопки живут
    // внутри разбора, поэтому слушатель один на весь блок
    testEl.querySelector<HTMLElement>("#resultWordsHistory")?.addEventListener("click", (event) => {
      const copyButton = (event.target as HTMLElement).closest<HTMLElement>("button[data-copy]");
      if (copyButton) {
        void copyWords(copyButton.dataset["copy"]!, copyButton);
        return;
      }

      if ((event.target as HTMLElement).closest("[data-heatmap]")) {
        testEl.querySelector<HTMLElement>(".wordsHistory")?.classList.toggle("heat");
        const legend = testEl.querySelector<HTMLElement>(".heatLegend");
        if (legend) legend.hidden = !legend.hidden;
      }
    });
  }

  /** Копирование разбора: все слова, только ошибочные или то, что набрано. */
  async function copyWords(what: string, button: HTMLElement): Promise<void> {
    if (!engine) return;

    const done = engine.words.filter((w) => w.done);
    const words =
      what === "missed"
        ? done.filter((w) => w.typed !== w.target).map((w) => w.target)
        : what === "typed"
          ? done.map((w) => w.typed)
          : done.map((w) => w.target);

    try {
      await navigator.clipboard.writeText(words.join(" "));
      const was = button.getAttribute("aria-label") ?? "";
      button.setAttribute("aria-label", "скопировано");
      setTimeout(() => button.setAttribute("aria-label", was), 1200);
    } catch {
      // Буфер обмена может быть закрыт политикой браузера — молча выходим
    }
  }

  /**
   * Картинка результата: рисуем сами на canvas.
   *
   * Библиотеки снимка DOM весят под сотню килобайт и всё равно не знают
   * про наши переменные тем. А показать человек хочет ровно то же самое —
   * скорость, точность, режим и цвета своей темы.
   */
  function saveResultCard(
    summary: {
      wpm: number;
      raw: number;
      accuracy: number;
      consistency: number;
      mode: string;
      modeValue: number;
      language: string;
    },
    unit: string,
  ): void {
    const css = getComputedStyle(document.documentElement);
    const colors = {
      bg: css.getPropertyValue("--bg-color").trim() || "#111",
      main: css.getPropertyValue("--main-color").trim() || "#e2b714",
      text: css.getPropertyValue("--text-color").trim() || "#eee",
      sub: css.getPropertyValue("--sub-color").trim() || "#888",
    };

    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = colors.sub;
    ctx.font = "32px Roboto Mono, monospace";
    ctx.fillText("speedtype", 80, 100);
    ctx.fillText(testTypeText(summary), 80, 150);

    ctx.fillStyle = colors.main;
    ctx.font = "bold 180px Roboto Mono, monospace";
    ctx.fillText(formatSpeed(summary.wpm), 80, 380);

    ctx.fillStyle = colors.sub;
    ctx.font = "48px Roboto Mono, monospace";
    ctx.fillText(unit, 80, 450);

    ctx.fillStyle = colors.text;
    ctx.font = "56px Roboto Mono, monospace";
    ctx.fillText(`${summary.accuracy.toFixed(0)}% точность`, 620, 300);
    ctx.fillText(`${formatSpeed(summary.raw)} raw`, 620, 380);
    ctx.fillText(`${summary.consistency.toFixed(0)}% ровность`, 620, 460);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "speedtype.png";
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  /** Строка «прочее»: funbox и режимы, которые не влезли в тип теста. */
  function otherText(): string {
    const s = getSettings();
    const parts: string[] = [];

    if (s.funbox.length > 0) parts.push(s.funbox.join(", ").replace(/_/g, " "));
    if (s.lazyMode) parts.push("без диакритики");
    if (s.blindMode) parts.push("слепой режим");

    return parts.join(" · ");
  }

  /** «время 30 english пунктуация» — как в их строке test type. */
  function testTypeText(summary: { mode: string; modeValue: number; language: string }): string {
    const names: Record<string, string> = {
      time: "время",
      words: "слова",
      quote: "цитата",
      zen: "zen",
      custom: "свой текст",
    };
    const s = getSettings();

    const parts = [names[summary.mode] ?? summary.mode];

    // У цитаты, zen и своего текста числового значения нет: у первых двух
    // длина известна только по факту, у zen её нет вовсе
    if (summary.mode === "time" || summary.mode === "words") {
      parts.push(String(summary.modeValue));
    }
    // В zen язык ни при чём — текста из словаря там не бывает
    if (summary.mode !== "zen") parts.push(summary.language.replace(/_/g, " "));
    if (s.punctuation) parts.push("пунктуация");
    if (s.numbers) parts.push("цифры");
    if (s.difficulty !== "normal") parts.push(s.difficulty === "expert" ? "эксперт" : "мастер");

    return parts.join(" ");
  }

  /**
   * Четыре числа вместо двух: верные, неверные, лишние, пропущенные.
   * Лишние и пропущенные входят в incorrectChars — вычитаем их, чтобы
   * разбивка читалась так же, как у monkeytype, а сумма сходилась.
   */
  function charBreakdown(summary: {
    correctChars: number;
    incorrectChars: number;
    extraChars: number;
    missedChars: number;
  }): string {
    const wrong = Math.max(0, summary.incorrectChars - summary.extraChars - summary.missedChars);
    return `${summary.correctChars}/${wrong}/${summary.extraChars}/${summary.missedChars}`;
  }

  /**
   * Разбор слов: три кнопки копирования, тепловая карта скоростей и её
   * легенда — как у monkeytype. Тепло берём из burst каждого слова:
   * движок его уже считает, отдельных замеров не нужно.
   */
  function renderWordsHistory(): string {
    if (!engine) return "";

    const done = engine.words.filter((w) => w.done);
    if (done.length === 0) return "";

    const bursts = done.map((w) => w.burst).filter((b) => b > 0);
    const fastest = Math.max(1, ...bursts);
    const slowest = Math.min(...bursts, fastest);

    /** Пять ступеней от медленного к быстрому — как у их тепловой карты. */
    function heatLevel(burst: number): number {
      if (burst <= 0 || fastest === slowest) return 2;
      return Math.min(4, Math.floor(((burst - slowest) / (fastest - slowest)) * 5));
    }

    const words = done
      .map(
        (w) =>
          `<span class="${w.typed === w.target ? "ok" : "bad"} heat-${heatLevel(w.burst)}"
                 aria-label="${Math.round(w.burst)} wpm" data-balloon-pos="up">${escapeHtml(
                   w.target,
                 )}</span>`,
      )
      .join(" ");

    const legend = [0, 1, 2, 3, 4]
      .map((level) => `<span class="heat-${level}"></span>`)
      .join("");

    return `
      <div class="historyTools">
        <button class="button" data-copy="all" aria-label="скопировать слова" data-balloon-pos="up">
          ${icon("copy")} слова
        </button>
        <button class="button" data-copy="missed" aria-label="скопировать слова с ошибками" data-balloon-pos="up">
          ${icon("copy")} ошибки
        </button>
        <button class="button" data-copy="typed" aria-label="скопировать набранное" data-balloon-pos="up">
          ${icon("copy")} набрано
        </button>
        <button class="button" data-heatmap aria-label="тепловая карта скорости" data-balloon-pos="up">
          ${icon("chart")} тепло
        </button>
      </div>
      <div class="wordsHistory${getSettings().burstHeatmap ? " heat" : ""}">${words}</div>
      <div class="heatLegend sub"${getSettings().burstHeatmap ? "" : " hidden"}>
        медленно ${legend} быстро
      </div>`;
  }

  /**
   * Перезапуск страницы целиком. Именно страницы, а не теста: экран
   * результата заменил разметку, и старые ссылки на #words и #caret
   * указывают на узлы, которых в документе уже нет.
   */
  function restart(words?: string[]): void {
    presetWords = words ?? null;
    container.innerHTML = "";
    void testPage({ container, params: new URLSearchParams() });
  }

  // ---------- ввод ----------

  /** Имя клавиши в терминах настройки quickRestart. */
  function restartKeyName(event: KeyboardEvent): string | null {
    if (event.key === "Escape") return "esc";
    if (event.key === "Tab") return "tab";
    if (event.key === "Enter") return "enter";
    return null;
  }

  /**
   * Обработчик висит на документе, а не на поле ввода. На поле его держать
   * нельзя: экран результата заменяет разметку теста целиком, вместе с полем
   * пропадал и обработчик — и рестарт с клавиатуры переставал работать.
   */
  function onKeydown(event: KeyboardEvent): void {
    // Открыта командная строка или пикер — там свои клавиши
    if (document.querySelector(".picker")) return;

    const active = document.activeElement;
    const tag = active?.tagName;
    if (active !== inputEl && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")) {
      return;
    }

    const s = getSettings();

    // Caps Lock ловим на любом нажатии
    const caps = container.querySelector<HTMLElement>("#capsWarning");
    if (caps) caps.hidden = !(s.capsLockWarning && event.getModifierState?.("CapsLock"));

    const pressed = restartKeyName(event);

    if (pressed !== null && pressed === s.quickRestart) {
      event.preventDefault();
      // no_quit: пока тест идёт, бросить его нельзя
      if (s.funbox.includes("no_quit") && engine?.started && !engine.finished) return;

      if (engine?.finished) restart();
      else void startTest();
      return;
    }

    // esc открывает командную строку — как в monkeytype. Если esc занят
    // рестартом, командная строка остаётся на ctrl+shift+p.
    if (event.key === "Escape") {
      event.preventDefault();
      openCommandline();
      return;
    }

    // zen сам не заканчивается — его завершают shift+enter, как у них
    if (event.key === "Enter" && event.shiftKey && s.mode === "zen") {
      event.preventDefault();
      engine?.finish();
      return;
    }

    if (!engine || engine.finished) return;

    // Клик мимо теста не должен заставлять тянуться к мыши
    if (active !== inputEl && !event.ctrlKey && !event.metaKey && !event.altKey) {
      inputEl.focus();
    }

    // Поле фокус не теряло — событие focus не придёт, а подсказка висит
    // поверх слов ещё с потери фокуса окном. Снимаем её сами.
    if (!focusEl.hidden && !event.ctrlKey && !event.metaKey && !event.altKey) {
      showFocusHint(false);
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      engine.backspace(event.ctrlKey || event.altKey);
      holdCaret();
      return;
    }

    // arrows: клавиши-стрелки печатают стрелки, а не двигают курсор
    const arrow = ARROW_KEYS[event.key];
    if (arrow && s.funbox.includes("arrows")) {
      event.preventDefault();
      engine.type(arrow);
      holdCaret();
      if (engine.started && paceTimer === null) void startPaceCaret();
      return;
    }

    // Только печатаемые символы: length === 1 отсекает Shift, стрелки и прочее
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      // layout_mirror: клавиша печатает симметричную себе относительно
      // середины ряда — руки приходится вести в другую сторону
      engine.type(mirror ? (mirror[event.key] ?? event.key) : event.key);
      holdCaret();

      if (s.keymapMode === "react") flashKey(keymapEl, event.key, false);
      if (engine.started && paceTimer === null) void startPaceCaret();
    }
  }

  wrapperEl.addEventListener("click", () => inputEl.focus());
  document.addEventListener("keydown", onKeydown);

  container.querySelector<HTMLElement>("#restartButton")?.addEventListener("click", () => {
    void startTest();
    inputEl.focus();
  });

  /**
   * Подсказка «нажмите сюда» и размытие слов — всегда вместе. Порознь их
   * ставить нельзя: надпись без размытия ложится прямо на чёткий текст,
   * и читать нельзя ни то, ни другое.
   */
  function showFocusHint(on: boolean): void {
    if (on && !getSettings().showOutOfFocusWarning) return;
    focusEl.hidden = !on;
    wordsEl.classList.toggle("blurred", on);
    if (on) setFocused(false);
  }

  inputEl.addEventListener("blur", () => showFocusHint(true));
  inputEl.addEventListener("focus", () => showFocusHint(false));

  // Окно потеряло фокус целиком — слова тоже гасим, иначе подсказка
  // висит поверх чёткого текста
  const onWindowBlur = (): void => showFocusHint(true);
  window.addEventListener("blur", onWindowBlur);

  /*
   * Окно вернулось — подсказку надо снять вручную. Само поле ввода фокус
   * не теряло (браузер гасит окно целиком, не элемент), поэтому событие
   * focus на нём не придёт, и надпись висела бы поверх слов до конца теста.
   */
  const onWindowFocus = (): void => {
    if (document.activeElement === inputEl) showFocusHint(false);
  };
  window.addEventListener("focus", onWindowFocus);

  const onResize = (): void => {
    lineOffset = -1;
    fitWrapper();
    scrollLines();
    moveCaret();
  };
  window.addEventListener("resize", onResize);

  // Настройки могут поменяться из командной строки — сразу применяем
  const offSettings = onSettingsChange((_, changed) => {
    applyLook();
    void drawKeymap();
    renderConfig();
    renderNotice();
    renderWords();
    renderLive();

    if (changed.includes("showAverage")) void loadAverage();

    if (changed.some((k) => ["language", "mode", "punctuation", "numbers", "funbox"].includes(k))) {
      void startTest();
    }
  });

  setRestartHook(() => void startTest());

  renderConfig();
  renderNotice();
  applyLook();
  void loadAverage();
  // Текст мог прийти от кнопок «повторить» и «практика» — забираем его
  // один раз, чтобы обычный рестарт снова брал слова с сервера
  const preset = presetWords;
  presetWords = null;
  await startTest(preset ? { words: preset } : {});

  return () => {
    disposed = true;
    engine?.dispose();
    unsubscribe?.();
    offSettings();
    stopPaceCaret();
    setRestartHook(null);
    setFocused(false);
    document.getElementById("timerBar")?.remove();
    if (blinkTimer !== null) clearTimeout(blinkTimer);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("focus", onWindowFocus);
    document.removeEventListener("keydown", onKeydown);
    document.body.classList.remove(...FUNBOX_BODY_CLASSES);
    document.getElementById("scanline")?.remove();
    document.querySelectorAll("link[data-funbox]").forEach((el) => el.remove());
    // Подсказки клавиш общие на всё приложение — уходя, за собой убираем
    hintEl.innerHTML = "";
    hintEl.hidden = true;
  };
}

/** График скорости по секундам — простой svg, без библиотек. */
function renderChart(samples: readonly number[], fromZero: boolean): string {
  if (samples.length < 2) {
    return `<p class="sub" style="text-align:center">тест слишком короткий для графика</p>`;
  }

  const width = 800;
  const height = 200;
  const padding = 32;

  const max = Math.max(...samples, 1);
  const min = fromZero ? 0 : Math.min(...samples);
  const span = max - min || 1;
  const step = (width - padding * 2) / (samples.length - 1);

  const x = (i: number): number => padding + i * step;
  const y = (v: number): number => height - padding - ((v - min) / span) * (height - padding * 2);

  const line = samples.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${padding},${height - padding} ${line} ${x(samples.length - 1)},${height - padding}`;

  let grid = "";
  for (let i = 0; i <= 4; i += 1) {
    const gy = padding + (i * (height - padding * 2)) / 4;
    grid +=
      `<line x1="${padding}" y1="${gy}" x2="${width - padding}" y2="${gy}"
             stroke="var(--sub-alt-color)" stroke-width="1"/>` +
      `<text x="${padding - 8}" y="${gy + 4}" text-anchor="end" font-size="11"
             fill="var(--sub-color)">${Math.round(max - (i * span) / 4)}</text>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${grid}
      <polygon points="${area}" fill="var(--main-color)" opacity="0.12"/>
      <polyline points="${line}" fill="none" stroke="var(--main-color)"
                stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  `;
}
