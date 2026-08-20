/**
 * Значения настроек. Состав задаётся в config-spec.ts, здесь — типы,
 * значения по умолчанию и хранение в localStorage.
 */

export type TestMode = "time" | "words" | "quote" | "zen" | "custom";
export type Difficulty = "normal" | "expert" | "master";

export interface Settings {
  // тест
  mode: TestMode;
  timeValue: number;
  wordsValue: number;
  quoteLength: string;
  language: string;
  punctuation: boolean;
  numbers: boolean;
  difficulty: Difficulty;
  britishEnglish: boolean;
  lazyMode: boolean;
  repeatQuotes: string;
  funbox: string[];

  // ввод
  quickRestart: string;
  quickEnd: boolean;
  stopOnError: string;
  deleteOnError: string;
  freedomMode: boolean;
  strictSpace: boolean;
  confidenceMode: string;
  oppositeShiftMode: string;
  hideExtraLetters: boolean;
  codeUnindentOnBackspace: boolean;
  indicateTypos: string;
  minWpm: string;
  minWpmCustomSpeed: number;
  minAcc: string;
  minAccCustom: number;
  minBurst: string;
  minBurstCustomSpeed: number;

  // каретка и подсветка
  caretStyle: string;
  smoothCaret: string;
  paceCaret: string;
  paceCaretCustomSpeed: number;
  highlightMode: string;
  typedEffect: string;
  tapeMode: string;
  tapeMargin: number;
  flipTestColors: boolean;
  colorfulMode: boolean;
  blindMode: boolean;
  smoothLineScroll: boolean;
  showAllLines: boolean;
  maxLineWidth: number;

  // показатели
  timerStyle: string;
  timerColor: string;
  timerOpacity: string;
  liveSpeedStyle: string;
  liveAccStyle: string;
  liveBurstStyle: string;
  typingSpeedUnit: string;
  alwaysShowDecimalPlaces: boolean;
  startGraphsAtZero: boolean;
  showAverage: string;
  showPb: boolean;
  burstHeatmap: boolean;
  alwaysShowWordsHistory: boolean;
  resultSaving: boolean;

  // оформление
  theme: string;
  themeLight: string;
  themeDark: string;
  autoSwitchTheme: boolean;
  randomTheme: string;
  favThemes: string;
  /** Своя тема вместо готовой. */
  customTheme: boolean;
  /** Десять цветов своей темы через запятую — тот же набор, что в themes.json. */
  customThemeColors: string;
  fontFamily: string;
  fontSize: number;
  customBackground: string;
  customBackgroundSize: string;
  customBackgroundFilter: string;

  // клавиатура
  keymapMode: string;
  keymapStyle: string;
  keymapLegendStyle: string;
  keymapKeys: string;
  keymapSize: number;
  layout: string;
  keymapLayout: string;

  // звук
  soundOnClick: string;
  soundOnError: string;
  playTimeWarning: string;
  soundVolume: number;

  // интерфейс
  showKeyTips: boolean;
  showOutOfFocusWarning: boolean;
  capsLockWarning: boolean;
  singleListCommandLine: string;
  monkey: boolean;
  ads: string;
}

const STORAGE_KEY = "speedtype_settings";

const DEFAULTS: Settings = {
  mode: "time",
  timeValue: 30,
  wordsValue: 25,
  quoteLength: "medium",
  language: "english",
  punctuation: false,
  numbers: false,
  difficulty: "normal",
  britishEnglish: false,
  lazyMode: false,
  repeatQuotes: "off",
  funbox: [],

  quickRestart: "tab",
  quickEnd: false,
  stopOnError: "off",
  deleteOnError: "off",
  freedomMode: false,
  strictSpace: false,
  confidenceMode: "off",
  oppositeShiftMode: "off",
  hideExtraLetters: false,
  codeUnindentOnBackspace: false,
  indicateTypos: "off",
  minWpm: "off",
  minWpmCustomSpeed: 100,
  minAcc: "off",
  minAccCustom: 90,
  minBurst: "off",
  minBurstCustomSpeed: 100,

  caretStyle: "default",
  smoothCaret: "medium",
  paceCaret: "off",
  paceCaretCustomSpeed: 100,
  highlightMode: "letter",
  typedEffect: "keep",
  tapeMode: "off",
  tapeMargin: 50,
  flipTestColors: false,
  colorfulMode: false,
  blindMode: false,
  smoothLineScroll: false,
  showAllLines: false,
  maxLineWidth: 0,

  timerStyle: "mini",
  timerColor: "main",
  timerOpacity: "1",
  liveSpeedStyle: "off",
  liveAccStyle: "off",
  liveBurstStyle: "off",
  typingSpeedUnit: "wpm",
  alwaysShowDecimalPlaces: false,
  startGraphsAtZero: true,
  showAverage: "off",
  showPb: true,
  burstHeatmap: false,
  alwaysShowWordsHistory: false,
  resultSaving: true,

  theme: "serika_dark",
  themeLight: "serika",
  themeDark: "serika_dark",
  autoSwitchTheme: false,
  randomTheme: "off",
  favThemes: "",
  customTheme: false,
  // Пустая строка значит «ещё не трогали»: редактор возьмёт цвета текущей темы
  customThemeColors: "",
  fontFamily: "Roboto Mono",
  fontSize: 2,
  customBackground: "",
  customBackgroundSize: "cover",
  customBackgroundFilter: "",

  keymapMode: "off",
  keymapStyle: "staggered",
  keymapLegendStyle: "lowercase",
  keymapKeys: "minimal",
  keymapSize: 1,
  layout: "qwerty",
  keymapLayout: "qwerty",

  soundOnClick: "off",
  soundOnError: "off",
  playTimeWarning: "off",
  soundVolume: 0.3,

  showKeyTips: true,
  showOutOfFocusWarning: true,
  capsLockWarning: true,
  singleListCommandLine: "manual",
  monkey: false,
  ads: "off",
};

export const TIME_OPTIONS = [15, 30, 60, 120];
export const WORD_OPTIONS = [10, 25, 50, 100];

type Listener = (settings: Readonly<Settings>, changed: ReadonlyArray<keyof Settings>) => void;

const listeners = new Set<Listener>();

let current: Settings = load();

function load(): Settings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    // Разворачиваем поверх дефолтов: сохранённый объект может не знать
    // про настройки, добавленные позже
    return migrate({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Переименования значений. Класс каретки теперь называется так же, как
 * в monkeytype (default вместо line) — у тех, кто уже успел выбрать «line»,
 * настройка иначе указывала бы на несуществующий стиль.
 */
function migrate(settings: Settings): Settings {
  if ((settings.caretStyle as string) === "line") settings.caretStyle = "default";
  return settings;
}

export function getSettings(): Readonly<Settings> {
  return current;
}

export function getDefaults(): Readonly<Settings> {
  return DEFAULTS;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));

  const changed = Object.keys(patch) as Array<keyof Settings>;
  for (const listener of listeners) listener(current, changed);

  return current;
}

export function resetSettings(): void {
  current = { ...DEFAULTS };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  for (const listener of listeners) {
    listener(current, Object.keys(DEFAULTS) as Array<keyof Settings>);
  }
}

export function onSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Значение режима: секунды для time, слова для words. */
export function modeValue(settings: Readonly<Settings> = current): number {
  return settings.mode === "time" ? settings.timeValue : settings.wordsValue;
}

/** Прочитать настройку по строковому ключу — для схемы и командной строки. */
export function readSetting(key: string): unknown {
  return (current as unknown as Record<string, unknown>)[key];
}
