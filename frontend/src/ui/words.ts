/**
 * Отрисовка слов и каретки — общая для теста и для гонки.
 *
 * До этого у гонки была своя урезанная копия: она не знала ни про стиль
 * каретки, ни про подсветку, ни про ленту, ни про показ опечаток. Любая
 * новая настройка отображения требовала двух правок, и вторую забывали —
 * поэтому в гонке каретка висела с классом hidden, а лента не работала
 * вовсе.
 *
 * Имена классов те же, что у monkeytype: #words, .word, <letter>, #caret.
 * На них целятся 52 файла тем — переименовывать нельзя.
 */

import type { TypingEngine } from "../core/engine";
import { getSettings } from "../state/settings";
import { escapeHtml } from "./format";

export interface WordsViewOptions {
  /** Обёртка: на ней живут кегль, гарнитура и класс ленты. */
  wrapper: HTMLElement;
  /** Контейнер слов — #words. */
  words: HTMLElement;
  /** Каретка — #caret. */
  caret: HTMLElement;
  /** Движок берём функцией: он пересоздаётся при каждом рестарте. */
  engine: () => TypingEngine | null;
  /**
   * Сколько слов показывать вперёд — для funbox вроде plus_one.
   * null означает «все».
   */
  visibleLimit?: () => number | null;
  /** Дополнительные классы на #words — их приносит funbox. */
  extraClasses?: () => string[];
  /** Позвать после отрисовки: тесту здесь нужна подсветка клавиши. */
  onRendered?: () => void;
}

export interface WordsView {
  /** Перерисовать слова и подвинуть каретку. */
  render(): void;
  /** Только каретка — после прокрутки или смены размера. */
  moveCaret(): void;
  /** Применить настройки отображения к контейнерам. */
  applyLook(): void;
  /** Задержать мигание каретки: пока печатают, она не мигает. */
  hold(): void;
  dispose(): void;
}

export function createWordsView(options: WordsViewOptions): WordsView {
  const { wrapper, words: wordsEl, caret: caretEl, engine } = options;

  let blinkTimer: ReturnType<typeof setTimeout> | null = null;

  function applyLook(): void {
    const s = getSettings();

    // Кегль и гарнитуру ставим обёртке: каретка её сосед и считает свою
    // ширину от того же кегля
    wrapper.style.fontSize = `${s.fontSize}rem`;
    wrapper.style.fontFamily = `"${s.fontFamily}", monospace`;
    wordsEl.style.maxWidth = s.maxLineWidth > 0 ? `${s.maxLineWidth}ch` : "";

    wordsEl.className = [
      s.blindMode ? "blind" : "",
      s.colorfulMode ? "colorfulMode" : "",
      s.flipTestColors ? "flipped" : "",
      s.hideExtraLetters ? "hideExtraLetters" : "",
      s.showAllLines ? "allLines" : "",
      s.indicateTypos !== "off" ? `indicate-${s.indicateTypos}` : "",
      s.tapeMode !== "off" ? `tape tape-${s.tapeMode}` : "",
      `highlight-${s.highlightMode.replace(/_/g, "-")}`,
      `typed-effect-${s.typedEffect}`,
      ...(options.extraClasses?.() ?? []),
    ]
      .filter(Boolean)
      .join(" ");

    // Часть классов дублируется на обёртке: css тем и funbox целится
    // то в #words, то в #wordsWrapper
    wrapper.className = [
      s.blindMode ? "blind" : "",
      s.hideExtraLetters ? "hideExtraLetters" : "",
      s.tapeMode !== "off" ? "tape" : "",
    ]
      .filter(Boolean)
      .join(" ");

    caretEl.className = `${s.caretStyle} smooth-${s.smoothCaret}`;
  }

  /** Ступень тепловой карты по скорости слова. */
  function heatLevel(burst: number): number {
    if (burst <= 0) return 0;
    if (burst < 40) return 1;
    if (burst < 70) return 2;
    if (burst < 100) return 3;
    return 4;
  }

  function render(): void {
    const current = engine();
    if (!current) return;

    const s = getSettings();
    const limit = options.visibleLimit?.() ?? null;
    const parts: string[] = [];

    for (let index = 0; index < current.words.length; index += 1) {
      // Режимы plus_* показывают лишь несколько слов вперёд
      if (limit !== null && (index < current.wordIndex || index >= current.wordIndex + limit)) {
        continue;
      }

      const word = current.words[index]!;
      const states = current.charStates(index);
      const letters: string[] = [];

      for (let i = 0; i < states.length; i += 1) {
        const state = states[i]!;
        // Лишние буквы можно не показывать вовсе
        if (state === "extra" && s.hideExtraLetters) continue;

        const char = i < word.target.length ? word.target[i]! : word.typed[i]!;
        // Лишняя буква помечена сразу двумя классами — есть темы,
        // которые красят именно .incorrect.extra
        const name = state === "extra" ? "incorrect extra" : state;
        const cls = state === "pending" ? "" : ` class="${name}"`;

        // Показ опечаток: что именно набрали вместо нужной буквы
        const typed = state === "incorrect" ? word.typed[i] : undefined;
        const shown = s.indicateTypos === "replace" && typed ? typed : char;
        const data =
          s.indicateTypos === "below" && typed ? ` data-typed="${escapeHtml(typed)}"` : "";

        letters.push(`<letter${cls}${data}>${escapeHtml(shown)}</letter>`);
      }

      const error = word.done && word.typed !== word.target;
      const active = index === current.wordIndex;
      const heat = s.burstHeatmap && word.done ? ` data-heat="${heatLevel(word.burst)}"` : "";

      parts.push(
        `<div class="word${error ? " error" : ""}${word.done ? " typed" : ""}${
          active ? " active" : ""
        }" data-wordindex="${index}"${heat}>${letters.join("")}</div>`,
      );
    }

    wordsEl.innerHTML = parts.join("");
    moveCaret();
    options.onRendered?.();
  }

  function moveCaret(): void {
    const current = engine();
    if (!current) return;

    const s = getSettings();
    if (s.caretStyle === "off") {
      caretEl.hidden = true;
      return;
    }

    const wordEl = wordsEl.querySelector<HTMLElement>(
      `.word[data-wordindex="${current.wordIndex}"]`,
    );
    if (!wordEl) {
      caretEl.hidden = true;
      return;
    }

    const word = current.words[current.wordIndex]!;
    const letters = wordEl.querySelectorAll<HTMLElement>("letter");
    const target = letters[word.typed.length];
    const anchor = target ?? letters[letters.length - 1] ?? wordEl;

    const box = wrapper.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();

    caretEl.hidden = false;
    caretEl.style.left = `${(target ? rect.left : rect.right) - box.left}px`;
    caretEl.style.top = `${rect.top - box.top}px`;
    caretEl.style.height = `${rect.height || 24}px`;
    caretEl.style.width =
      s.caretStyle === "block" || s.caretStyle === "outline" ? `${rect.width || 12}px` : "";

    // Лента: вместо каретки двигаем сам текст
    if (s.tapeMode !== "off") {
      const shift = rect.left - box.left - (box.width * s.tapeMargin) / 100;
      wordsEl.style.transform = `translateX(${-shift}px)`;
      caretEl.style.left = `${(box.width * s.tapeMargin) / 100}px`;
    }
  }

  /** Пока идёт набор, каретка не мигает — как в monkeytype. */
  function hold(): void {
    caretEl.classList.add("typing");
    if (blinkTimer !== null) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => caretEl.classList.remove("typing"), 600);
  }

  function dispose(): void {
    if (blinkTimer !== null) {
      clearTimeout(blinkTimer);
      blinkTimer = null;
    }
  }

  return { render, moveCaret, applyLook, hold, dispose };
}
