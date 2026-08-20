/**
 * Полный перечень настроек — все 94 ключа из схемы monkeytype.
 *
 * Один список задаёт и страницу настроек, и командную строку: добавить
 * настройку значит дописать сюда строку, интерфейс подхватит её сам.
 * Так же устроен и оригинал — иначе 94 настройки пришлось бы верстать
 * руками в двух местах.
 */

export type SettingKind = "toggle" | "select" | "number" | "text" | "picker";

export type SettingGroup =
  | "test"
  | "input"
  | "caret"
  | "stats"
  | "look"
  | "keymap"
  | "sound"
  | "ui";

export interface SettingSpec {
  key: string;
  group: SettingGroup;
  label: string;
  hint: string;
  kind: SettingKind;
  /** Варианты для select. */
  values?: readonly string[];
  /** Диапазон для number. */
  min?: number;
  max?: number;
  step?: number;
  /** Что открывать для picker: свой список. */
  picker?: "theme" | "language" | "layout" | "font" | "funbox" | "custom";
  /** Настройка требует перезапуска теста. */
  restart?: boolean;
  /** Реализована ли она на самом деле. */
  done: boolean;
}

export const GROUP_LABELS: Record<SettingGroup, string> = {
  test: "тест и текст",
  input: "ввод и поведение",
  caret: "каретка и подсветка",
  stats: "показатели",
  look: "оформление",
  keymap: "клавиатура",
  sound: "звук",
  ui: "интерфейс",
};

export const SETTINGS: readonly SettingSpec[] = [
  // ---------- тест и текст ----------
  { key: "mode", group: "test", label: "режим", hint: "время, слова или цитата", kind: "select", values: ["time", "words", "quote", "zen", "custom"], restart: true, done: true },
  { key: "timeValue", group: "test", label: "длительность", hint: "секунд в режиме времени", kind: "select", values: ["15", "30", "60", "120"], restart: true, done: true },
  { key: "wordsValue", group: "test", label: "количество слов", hint: "слов в режиме слов", kind: "select", values: ["10", "25", "50", "100"], restart: true, done: true },
  { key: "quoteLength", group: "test", label: "длина цитаты", hint: "короткая, средняя, длинная", kind: "select", values: ["short", "medium", "long", "thicc", "all"], restart: true, done: false },
  { key: "language", group: "test", label: "язык", hint: "словарь из 432 языков", kind: "picker", picker: "language", restart: true, done: true },
  { key: "punctuation", group: "test", label: "пунктуация", hint: "знаки препинания и заглавные", kind: "toggle", restart: true, done: true },
  { key: "numbers", group: "test", label: "цифры", hint: "подмешивать числа в текст", kind: "toggle", restart: true, done: true },
  { key: "difficulty", group: "test", label: "сложность", hint: "обычная, эксперт, мастер", kind: "select", values: ["normal", "expert", "master"], restart: true, done: true },
  { key: "britishEnglish", group: "test", label: "британский английский", hint: "colour вместо color", kind: "toggle", restart: true, done: false },
  { key: "lazyMode", group: "test", label: "без диакритики", hint: "убирать надстрочные знаки", kind: "toggle", restart: true, done: false },
  { key: "repeatQuotes", group: "test", label: "повторять цитату", hint: "та же цитата при рестарте", kind: "select", values: ["off", "typing"], restart: true, done: true },
  { key: "funbox", group: "test", label: "funbox", hint: "модификаторы правил и вида", kind: "picker", picker: "funbox", restart: true, done: true },

  // ---------- ввод и поведение ----------
  { key: "quickRestart", group: "input", label: "быстрый рестарт", hint: "клавиша перезапуска теста", kind: "select", values: ["off", "esc", "tab", "enter"], done: true },
  { key: "quickEnd", group: "input", label: "быстрый конец", hint: "не ждать пробел на последнем", kind: "toggle", done: true },
  { key: "stopOnError", group: "input", label: "стоп на ошибке", hint: "не пускать дальше при ошибке", kind: "select", values: ["off", "word", "letter"], restart: true, done: true },
  { key: "deleteOnError", group: "input", label: "стирать ошибку", hint: "убирать неверное автоматически", kind: "select", values: ["off", "letter", "word"], restart: true, done: true },
  { key: "freedomMode", group: "input", label: "свободный режим", hint: "стирать любые прошлые слова", kind: "toggle", done: true },
  { key: "strictSpace", group: "input", label: "строгий пробел", hint: "пробел всегда завершает слово", kind: "toggle", done: true },
  { key: "confidenceMode", group: "input", label: "режим уверенности", hint: "запретить стирать набранное", kind: "select", values: ["off", "on", "max"], done: true },
  { key: "oppositeShiftMode", group: "input", label: "правильный шифт", hint: "шифт противоположной рукой", kind: "select", values: ["off", "on"], done: false },
  { key: "hideExtraLetters", group: "input", label: "скрывать лишние буквы", hint: "не показывать перебор", kind: "toggle", done: true },
  { key: "codeUnindentOnBackspace", group: "input", label: "backspace убирает отступ", hint: "для режима с кодом", kind: "toggle", done: false },
  { key: "indicateTypos", group: "input", label: "показ опечаток", hint: "что именно было набрано", kind: "select", values: ["off", "below", "replace"], done: true },
  { key: "minWpm", group: "input", label: "минимальная скорость", hint: "обрыв при падении ниже", kind: "select", values: ["off", "custom"], restart: true, done: true },
  { key: "minWpmCustomSpeed", group: "input", label: "порог скорости", hint: "своё значение в wpm", kind: "number", min: 0, max: 300, step: 5, restart: true, done: true },
  { key: "minAcc", group: "input", label: "минимальная точность", hint: "обрыв при падении ниже", kind: "select", values: ["off", "custom"], restart: true, done: true },
  { key: "minAccCustom", group: "input", label: "порог точности", hint: "своё значение в процентах", kind: "number", min: 0, max: 100, step: 1, restart: true, done: true },
  { key: "minBurst", group: "input", label: "минимум на слово", hint: "скорость отдельного слова", kind: "select", values: ["off", "fixed", "flex"], restart: true, done: true },
  { key: "minBurstCustomSpeed", group: "input", label: "порог на слово", hint: "своё значение в wpm", kind: "number", min: 0, max: 300, step: 5, restart: true, done: true },

  // ---------- каретка и подсветка ----------
  { key: "caretStyle", group: "caret", label: "вид каретки", hint: "линия, блок, контур", kind: "select", values: ["off", "default", "block", "outline", "underline"], done: true },
  { key: "smoothCaret", group: "caret", label: "плавная каретка", hint: "скорость движения каретки", kind: "select", values: ["off", "slow", "medium", "fast"], done: true },
  { key: "paceCaret", group: "caret", label: "каретка-соперник", hint: "задаёт темп для догона", kind: "select", values: ["off", "average", "pb", "last", "daily", "custom"], restart: true, done: true },
  { key: "paceCaretCustomSpeed", group: "caret", label: "скорость соперника", hint: "своё значение в wpm", kind: "number", min: 10, max: 300, step: 5, done: true },
  { key: "highlightMode", group: "caret", label: "подсветка", hint: "что выделять при наборе", kind: "select", values: ["off", "letter", "word", "next_word", "next_two_words", "next_three_words"], done: true },
  { key: "typedEffect", group: "caret", label: "набранный текст", hint: "оставлять, прятать, гасить", kind: "select", values: ["keep", "hide", "fade", "dots"], done: true },
  { key: "tapeMode", group: "caret", label: "режим ленты", hint: "текст едет одной строкой", kind: "select", values: ["off", "letter", "word"], done: true },
  { key: "tapeMargin", group: "caret", label: "отступ ленты", hint: "положение курсора в ленте", kind: "number", min: 10, max: 90, step: 5, done: true },
  { key: "flipTestColors", group: "caret", label: "обратить цвета", hint: "поменять набранное и остальное", kind: "toggle", done: true },
  { key: "colorfulMode", group: "caret", label: "яркие ошибки", hint: "отдельный цвет для ошибок", kind: "toggle", done: true },
  { key: "blindMode", group: "caret", label: "слепой режим", hint: "не показывать ошибки вовсе", kind: "toggle", done: true },
  { key: "smoothLineScroll", group: "caret", label: "плавная прокрутка", hint: "строки едут, а не прыгают", kind: "toggle", done: true },
  { key: "showAllLines", group: "caret", label: "весь текст сразу", hint: "не ограничивать тремя строками", kind: "toggle", done: true },
  { key: "maxLineWidth", group: "caret", label: "ширина строки", hint: "ноль значит без ограничения", kind: "number", min: 0, max: 100, step: 5, done: true },

  // ---------- показатели ----------
  { key: "timerStyle", group: "stats", label: "вид таймера", hint: "текст, полоса или мини", kind: "select", values: ["off", "bar", "text", "mini"], done: true },
  { key: "timerColor", group: "stats", label: "цвет таймера", hint: "какой из цветов темы", kind: "select", values: ["black", "sub", "text", "main"], done: true },
  { key: "timerOpacity", group: "stats", label: "прозрачность таймера", hint: "насколько он заметен", kind: "select", values: ["0.25", "0.5", "0.75", "1"], done: true },
  { key: "liveSpeedStyle", group: "stats", label: "скорость на ходу", hint: "показ wpm во время теста", kind: "select", values: ["off", "text", "mini"], done: true },
  { key: "liveAccStyle", group: "stats", label: "точность на ходу", hint: "показ точности во время теста", kind: "select", values: ["off", "text", "mini"], done: true },
  { key: "liveBurstStyle", group: "stats", label: "скорость слова", hint: "показ темпа текущего слова", kind: "select", values: ["off", "text", "mini"], done: true },
  { key: "typingSpeedUnit", group: "stats", label: "единица скорости", hint: "wpm, cpm, wps или cps", kind: "select", values: ["wpm", "cpm", "wps", "cps", "wph"], done: true },
  { key: "alwaysShowDecimalPlaces", group: "stats", label: "доли единиц", hint: "показывать цифры после запятой", kind: "toggle", done: true },
  { key: "startGraphsAtZero", group: "stats", label: "график от нуля", hint: "не обрезать нижнюю часть", kind: "toggle", done: true },
  { key: "showAverage", group: "stats", label: "средние значения", hint: "средняя скорость и точность", kind: "select", values: ["off", "speed", "acc", "both"], done: true },
  { key: "showPb", group: "stats", label: "личный рекорд", hint: "отмечать новый рекорд", kind: "toggle", done: true },
  { key: "burstHeatmap", group: "stats", label: "тепловая карта", hint: "цвет слов по скорости", kind: "toggle", done: true },
  { key: "alwaysShowWordsHistory", group: "stats", label: "разбор слов", hint: "показывать текст после теста", kind: "toggle", done: true },
  { key: "resultSaving", group: "stats", label: "сохранять результаты", hint: "отправлять на сервер", kind: "toggle", done: true },

  // ---------- оформление ----------
  { key: "theme", group: "look", label: "тема", hint: "187 готовых наборов цветов", kind: "picker", picker: "theme", done: true },
  { key: "themeLight", group: "look", label: "светлая тема", hint: "при светлой системной теме", kind: "picker", picker: "theme", done: true },
  { key: "themeDark", group: "look", label: "тёмная тема", hint: "при тёмной системной теме", kind: "picker", picker: "theme", done: true },
  { key: "autoSwitchTheme", group: "look", label: "тема по системе", hint: "переключать вслед за системой", kind: "toggle", done: true },
  { key: "randomTheme", group: "look", label: "случайная тема", hint: "новая тема каждый тест", kind: "select", values: ["off", "on", "light", "dark", "fav"], done: true },
  { key: "favThemes", group: "look", label: "избранные темы", hint: "для случайного выбора", kind: "text", done: true },
  { key: "customTheme", group: "look", label: "своя тема", hint: "вместо готовой из списка", kind: "toggle", done: true },
  { key: "customThemeColors", group: "look", label: "цвета своей темы", hint: "десять цветов, редактор", kind: "picker", picker: "custom", done: true },
  { key: "fontFamily", group: "look", label: "шрифт", hint: "гарнитура текста теста", kind: "picker", picker: "font", done: true },
  { key: "fontSize", group: "look", label: "размер шрифта", hint: "высота букв в тесте", kind: "number", min: 0.5, max: 5, step: 0.25, done: true },
  { key: "customBackground", group: "look", label: "своя картинка фоном", hint: "ссылка на изображение", kind: "text", done: true },
  { key: "customBackgroundSize", group: "look", label: "вписывание фона", hint: "cover, contain или max", kind: "select", values: ["cover", "contain", "max"], done: true },
  { key: "customBackgroundFilter", group: "look", label: "фильтр фона", hint: "яркость и размытие картинки", kind: "text", done: true },

  // ---------- клавиатура ----------
  { key: "keymapMode", group: "keymap", label: "клавиатура на экране", hint: "выключена, статичная, реагирует", kind: "select", values: ["off", "static", "react", "next"], done: true },
  { key: "keymapStyle", group: "keymap", label: "форма клавиатуры", hint: "ступенчатая, матрица, разделённая", kind: "select", values: ["staggered", "matrix", "split", "alice"], done: true },
  { key: "keymapLegendStyle", group: "keymap", label: "подписи клавиш", hint: "строчные, прописные, пустые", kind: "select", values: ["lowercase", "uppercase", "blank", "dynamic"], done: true },
  { key: "keymapKeys", group: "keymap", label: "ряды клавиш", hint: "минимум, с цифрами, всё", kind: "select", values: ["minimal", "minimal_numrow", "full"], done: true },
  { key: "keymapSize", group: "keymap", label: "размер клавиатуры", hint: "масштаб на экране", kind: "number", min: 0.5, max: 3.5, step: 0.25, done: true },
  { key: "layout", group: "keymap", label: "раскладка набора", hint: "239 раскладок на выбор", kind: "picker", picker: "layout", restart: true, done: true },
  { key: "keymapLayout", group: "keymap", label: "раскладка на экране", hint: "какую рисовать клавиатуру", kind: "picker", picker: "layout", done: true },

  // ---------- звук ----------
  { key: "soundOnClick", group: "sound", label: "звук нажатия", hint: "21 набор щелчков клавиш", kind: "select", values: ["off", "1", "2", "3", "4", "5", "6", "7", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26"], done: true },
  { key: "soundOnError", group: "sound", label: "звук ошибки", hint: "четыре варианта сигнала", kind: "select", values: ["off", "1", "2", "3", "4"], done: true },
  { key: "playTimeWarning", group: "sound", label: "сигнал о времени", hint: "за сколько секунд предупредить", kind: "select", values: ["off", "1", "3", "5", "10"], done: true },
  { key: "soundVolume", group: "sound", label: "громкость", hint: "уровень всех звуков", kind: "number", min: 0, max: 1, step: 0.05, done: true },

  // ---------- интерфейс ----------
  { key: "showKeyTips", group: "ui", label: "подсказки клавиш", hint: "строка с горячими клавишами", kind: "toggle", done: true },
  { key: "showOutOfFocusWarning", group: "ui", label: "потеря фокуса", hint: "затемнять при уходе мышью", kind: "toggle", done: true },
  { key: "capsLockWarning", group: "ui", label: "caps lock", hint: "предупреждать о включённом", kind: "toggle", done: true },
  { key: "singleListCommandLine", group: "ui", label: "командная строка списком", hint: "все команды одним списком", kind: "select", values: ["manual", "on"], done: true },
  { key: "monkey", group: "ui", label: "обезьянка", hint: "печатает вместе с вами", kind: "toggle", done: false },
  { key: "ads", group: "ui", label: "реклама", hint: "у нас её нет", kind: "select", values: ["off"], done: true },
] as const;

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingsInGroup(group: SettingGroup): SettingSpec[] {
  return SETTINGS.filter((s) => s.group === group);
}
