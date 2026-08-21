/**
 * Funbox — 44 модификатора (у monkeytype их 48).
 *
 * Те, для которых генератор ещё не написан, помечены `done: false` —
 * в списке выбора они приглушены и подписаны, как нереализованные
 * настройки. Делать вид, что режим работает, хуже, чем признать обратное.
 *
 * Делятся на три вида:
 *   text     — меняют сам текст (шифры, системы счисления, регистр);
 *   css      — меняют вид, стили лежат в static/funbox/*.css;
 *   behavior — меняют правила теста, их обрабатывает страница теста.
 *
 * Несовместимые между собой режимы перечислены в conflicts: включить
 * mirror вместе с upside_down можно, а два генератора текста — нет.
 */

export type FunboxKind = "text" | "css" | "behavior";

export interface Funbox {
  name: string;
  label: string;
  hint: string;
  kind: FunboxKind;
  /** Подменяет генерацию слов целиком. */
  generator?: boolean;
  /** Преобразование готового списка слов. */
  transform?: (words: string[]) => string[];
  /** Класс на #words или body. */
  cssClass?: string;
  /** Класс на <body> — некоторые css из monkeytype целятся именно туда. */
  bodyClass?: string;
  /** Нужен файл static/funbox/<name>.css. */
  hasCss?: boolean;
  /**
   * Реализован ли режим на самом деле. Как и у настроек: пока логики нет,
   * честнее показать это в списке, чем делать вид, что режим работает.
   */
  done?: boolean;
}

// ---------- вспомогательное ----------

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

const MORSE: Record<string, string> = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.",
  h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.",
  o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-",
  v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};

/** Порядок как на клавиатуре: влево, вниз, вверх, вправо. */
const ARROWS = ["←", "↓", "↑", "→"] as const;

/** Клавиша-стрелка → символ, который она печатает в режиме arrows. */
export const ARROW_KEYS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowRight: "→",
};

const LEET: Record<string, string> = {
  o: "0", i: "1", e: "3", a: "4", s: "5", g: "6", t: "7", b: "8",
};

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function randomWord(minLen = 3, maxLen = 8): string {
  const length = minLen + randomInt(maxLen - minLen + 1);
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ---------- список ----------

export const FUNBOXES: readonly Funbox[] = [
  // --- меняют текст ---
  {
    name: "58008",
    label: "58008",
    hint: "числа, читаемые вверх ногами",
    kind: "text",
    generator: true,
    transform: (words) => words.map(() => String(randomInt(90000) + 10000)),
  },
  {
    name: "gibberish",
    label: "gibberish",
    hint: "случайные буквы вместо слов",
    kind: "text",
    generator: true,
    transform: (words) => words.map(() => randomWord()),
  },
  {
    name: "ascii",
    label: "ascii",
    hint: "случайные печатные символы",
    kind: "text",
    generator: true,
    transform: (words) =>
      words.map(() => {
        const length = 3 + randomInt(5);
        let out = "";
        for (let i = 0; i < length; i += 1) out += String.fromCharCode(33 + randomInt(94));
        return out;
      }),
  },
  {
    name: "specials",
    label: "specials",
    hint: "только служебные символы",
    kind: "text",
    generator: true,
    transform: (words) => {
      const pool = "!@#$%^&*()_+-=[]{};':\",./<>?\\|`~";
      return words.map(() => {
        const length = 2 + randomInt(4);
        let out = "";
        for (let i = 0; i < length; i += 1) out += pool[randomInt(pool.length)];
        return out;
      });
    },
  },
  {
    name: "binary",
    label: "binary",
    hint: "только нули и единицы",
    kind: "text",
    generator: true,
    transform: (words) =>
      words.map(() => {
        let out = "";
        for (let i = 0; i < 8; i += 1) out += randomInt(2);
        return out;
      }),
  },
  {
    name: "hexadecimal",
    label: "hexadecimal",
    hint: "шестнадцатеричные числа",
    kind: "text",
    generator: true,
    transform: (words) =>
      words.map(() => "0x" + randomInt(65536).toString(16).padStart(4, "0")),
  },
  {
    name: "morse",
    label: "morse",
    hint: "азбука морзе вместо букв",
    kind: "text",
    transform: (words) =>
      words.map((w) =>
        [...w.toLowerCase()].map((c) => MORSE[c] ?? "").filter(Boolean).join("/"),
      ),
  },
  {
    name: "rot13",
    label: "rot13",
    hint: "буквы сдвинуты на тринадцать",
    kind: "text",
    transform: (words) => words.map(rot13),
  },
  {
    name: "backwards",
    label: "backwards",
    hint: "каждое слово задом наперёд",
    kind: "text",
    transform: (words) => words.map((w) => [...w].reverse().join("")),
  },
  {
    name: "ddoouubblleedd",
    label: "ddoouubblleedd",
    hint: "каждая буква повторена дважды",
    kind: "text",
    transform: (words) => words.map((w) => [...w].map((c) => c + c).join("")),
  },
  {
    name: "capitals",
    label: "capitals",
    hint: "каждое слово с заглавной",
    kind: "text",
    transform: (words) => words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)),
  },
  {
    name: "underscore_spaces",
    label: "underscore spaces",
    hint: "подчёркивания вместо пробелов",
    kind: "text",
    transform: (words) => [words.join("_")],
  },
  {
    name: "nospace",
    label: "nospace",
    hint: "слова слитно без пробелов",
    kind: "text",
    transform: (words) => [words.join("")],
  },
  {
    name: "instant_messaging",
    label: "instant messaging",
    hint: "без заглавных и точек",
    kind: "text",
    transform: (words) => words.map((w) => w.toLowerCase().replace(/[.,!?;:]/g, "")),
  },
  {
    name: "leet",
    label: "leet",
    hint: "буквы заменены цифрами",
    kind: "text",
    transform: (words) =>
      words.map((w) => [...w].map((c) => LEET[c.toLowerCase()] ?? c).join("")),
  },
  {
    name: "zipf",
    label: "zipf",
    hint: "частые слова встречаются чаще",
    kind: "text",
    // Отбор по частоте делает сервер: словари monkeytype отсортированы
    // по убыванию частоты, и клиент просит смещённую выборку флагом zipf.
    generator: true,
  },
  {
    name: "pseudolang",
    label: "pseudolang",
    hint: "выдуманные слова похожего вида",
    kind: "text",
    generator: true,
    transform: (words) =>
      words.map((w) => {
        const letters = [...w];
        for (let i = letters.length - 1; i > 0; i -= 1) {
          const j = randomInt(i + 1);
          [letters[i], letters[j]] = [letters[j]!, letters[i]!];
        }
        return letters.join("");
      }),
  },
  {
    name: "weakspot",
    label: "weakspot",
    hint: "чаще подсовывает трудные буквы",
    kind: "text",
    generator: true,
  },
  // Обоим нужен внешний источник текста, которого у нас нет:
  // подсунуть вместо стихов обычные слова — это обман, а не режим
  { name: "poetry", label: "poetry", hint: "строки стихов вместо слов", kind: "text", generator: true, done: false },
  { name: "wikipedia", label: "wikipedia", hint: "абзацы из случайных статей", kind: "text", generator: true, done: false },
  { name: "polyglot", label: "polyglot", hint: "слова из нескольких языков", kind: "text", generator: true},
  {
    name: "arrows",
    label: "arrows",
    hint: "печатать стрелками вместо букв",
    kind: "text",
    generator: true,
    // Сами клавиши-стрелки страница теста переводит в эти символы
    transform: (words) =>
      words.map(() => {
        const length = 4 + randomInt(5);
        let out = "";
        for (let i = 0; i < length; i += 1) out += ARROWS[randomInt(ARROWS.length)];
        return out;
      }),
  },

  // --- меняют вид ---
  { name: "mirror", label: "mirror", hint: "текст отражён по горизонтали", kind: "css", hasCss: true },
  { name: "upside_down", label: "upside down", hint: "текст перевёрнут вверх ногами", kind: "css", hasCss: true },
  { name: "nausea", label: "nausea", hint: "экран покачивает при наборе", kind: "css", hasCss: true },
  { name: "round_round_baby", label: "round round baby", hint: "текст крутится по кругу", kind: "css", hasCss: true },
  { name: "earthquake", label: "earthquake", hint: "слова трясутся при наборе", kind: "css", hasCss: true },
  // Их crt.css целиком висит на body.crtmode — без этого класса файл
  // подключался и не делал ничего
  { name: "crt", label: "crt", hint: "экран лампового монитора", kind: "css", hasCss: true, bodyClass: "crtmode" },
  { name: "space_balls", label: "space balls", hint: "звёзды летят навстречу", kind: "css", hasCss: true },
  { name: "choo_choo", label: "choo choo", hint: "буквы едут паровозиком", kind: "css", hasCss: true },
  { name: "read_ahead_easy", label: "read ahead easy", hint: "набранное слегка размыто", kind: "css", hasCss: true },
  { name: "read_ahead", label: "read ahead", hint: "текущее слово размыто", kind: "css", hasCss: true },
  { name: "read_ahead_hard", label: "read ahead hard", hint: "скрыто всё до курсора", kind: "css", hasCss: true },
  { name: "asl", label: "asl", hint: "буквы жестового алфавита", kind: "css", hasCss: true },
  { name: "tts", label: "tts", hint: "слова произносятся вслух", kind: "css", hasCss: true },
  { name: "simon_says", label: "simon says", hint: "печатать только по подсказке", kind: "css", hasCss: true },
  { name: "layout_mirror", label: "layout mirror", hint: "раскладка зеркально отражена", kind: "css"},

  // --- меняют правила ---
  { name: "plus_zero", label: "plus zero", hint: "видно ровно одно слово", kind: "behavior" },
  { name: "plus_one", label: "plus one", hint: "видно на слово вперёд", kind: "behavior" },
  { name: "plus_two", label: "plus two", hint: "видно на два слова", kind: "behavior" },
  { name: "plus_three", label: "plus three", hint: "видно на три слова", kind: "behavior" },
  { name: "memory", label: "memory", hint: "запомнить текст, потом печатать", kind: "behavior"},
  { name: "no_quit", label: "no quit", hint: "тест нельзя прервать досрочно", kind: "behavior" },
  { name: "layoutfluid", label: "layoutfluid", hint: "раскладка меняется по ходу", kind: "behavior"},
] as const;

export const FUNBOX_BY_NAME = new Map(FUNBOXES.map((f) => [f.name, f]));

/** Генераторы текста взаимно исключают друг друга. */
export function conflicts(active: readonly string[], candidate: string): string[] {
  const box = FUNBOX_BY_NAME.get(candidate);
  if (!box?.generator) return [];

  return active.filter((name) => {
    const other = FUNBOX_BY_NAME.get(name);
    return other?.generator === true && name !== candidate;
  });
}

/** Применить все текстовые преобразования по очереди. */
export function applyFunboxText(words: string[], active: readonly string[]): string[] {
  let result = words;

  for (const name of active) {
    const box = FUNBOX_BY_NAME.get(name);
    if (box?.kind === "text" && box.transform) {
      result = box.transform(result);
    }
  }

  return result;
}

/** Классы для #words, классы для body и подключаемые css-файлы. */
export function funboxVisuals(active: readonly string[]): {
  classes: string[];
  bodyClasses: string[];
  cssFiles: string[];
} {
  const classes: string[] = [];
  const bodyClasses: string[] = [];
  const cssFiles: string[] = [];

  for (const name of active) {
    const box = FUNBOX_BY_NAME.get(name);
    if (!box) continue;

    if (box.kind === "css" || box.cssClass) classes.push(box.cssClass ?? box.name);
    if (box.bodyClass) bodyClasses.push(box.bodyClass);
    if (box.hasCss) cssFiles.push(box.name);
  }

  return { classes, bodyClasses, cssFiles };
}

/** Все классы, которые режимы вообще могут навесить на body. */
export const FUNBOX_BODY_CLASSES = FUNBOXES.map((f) => f.bodyClass).filter(
  (name): name is string => name !== undefined,
);

/** Сколько слов вперёд показывать: режимы plus_*. */
export function visibleWordLimit(active: readonly string[]): number | null {
  if (active.includes("plus_zero")) return 1;
  if (active.includes("plus_one")) return 2;
  if (active.includes("plus_two")) return 3;
  if (active.includes("plus_three")) return 4;
  return null;
}
