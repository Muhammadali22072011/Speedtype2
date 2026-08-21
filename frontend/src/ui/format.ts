/** Мелкие помощники отображения. */

import { getSettings } from "../state/settings";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Секунды в «1ч 23м» / «5м 30с» / «42с». */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

/**
 * Множители перевода wpm в выбранную единицу. Живут здесь, а не на
 * странице теста: тем же переводом пользуется экран результата, а
 * заводить второй список значит однажды их разойтись.
 */
const SPEED_UNITS: Record<string, { factor: number; label: string }> = {
  wpm: { factor: 1, label: "wpm" },
  cpm: { factor: 5, label: "cpm" },
  wps: { factor: 1 / 60, label: "wps" },
  cps: { factor: 5 / 60, label: "cps" },
  wph: { factor: 60, label: "wph" },
};

/** Подпись единицы, в которой человек хочет видеть скорость. */
export function speedUnitLabel(unit: string = getSettings().typingSpeedUnit): string {
  return SPEED_UNITS[unit]?.label ?? "wpm";
}

/** Множитель выбранной единицы — графику он нужен, чтобы подписать ось. */
export function speedUnitFactor(unit: string = getSettings().typingSpeedUnit): number {
  return SPEED_UNITS[unit]?.factor ?? 1;
}

/** Скорость в выбранных единицах, с десятыми или без — по настройке. */
export function formatSpeed(wpm: number): string {
  const s = getSettings();
  const unit = SPEED_UNITS[s.typingSpeedUnit] ?? SPEED_UNITS["wpm"]!;
  const value = wpm * unit.factor;
  return s.alwaysShowDecimalPlaces ? value.toFixed(2) : String(Math.round(value));
}
