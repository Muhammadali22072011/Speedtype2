/**
 * Метрики на клиенте — только для показа во время теста.
 *
 * Итоговые значения считает сервер по тем же формулам: клиенту
 * доверять нельзя, он присылает лишь сырые счётчики. Здесь всё
 * продублировано, чтобы цифры на экране совпадали с сохранёнными.
 */

export const CHARS_PER_WORD = 5;

const minutes = (seconds: number): number => Math.max(seconds, 1e-9) / 60;

/** Скорость по верно набранным символам. */
export function calculateWpm(correctChars: number, seconds: number): number {
  return correctChars / CHARS_PER_WORD / minutes(seconds);
}

/** Скорость по всем нажатиям, ошибки не вычитаются. */
export function calculateRaw(totalChars: number, seconds: number): number {
  return totalChars / CHARS_PER_WORD / minutes(seconds);
}

/** Доля верных нажатий от общего числа нажатий. */
export function calculateAccuracy(correctChars: number, incorrectChars: number): number {
  const total = correctChars + incorrectChars;
  if (total === 0) return 100;
  return (correctChars / total) * 100;
}

/**
 * Ровность темпа по посекундным замерам wpm.
 * Коэффициент вариации переводим в проценты: чем ровнее, тем ближе к 100.
 */
export function calculateConsistency(samples: readonly number[]): number {
  const values = samples.filter((s) => s > 0);
  if (values.length < 2) return 100;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 0;

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;

  return Math.max(0, Math.min(100, (1 - cv) * 100));
}
