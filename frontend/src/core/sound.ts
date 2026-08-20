/**
 * Звуки нажатий. Наборы взяты из monkeytype: 26 вариантов клика
 * (в каждом по три сэмпла, чтобы подряд идущие нажатия не звучали
 * одинаково) и 4 варианта звука ошибки.
 *
 * Один Audio на сэмпл переиспользуем: создавать новый на каждое
 * нажатие — верный способ подвесить вкладку на быстрой печати.
 */

export const CLICK_SETS = [
  "off", "1", "2", "3", "4", "5", "6", "7",
  "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26",
] as const;

export const ERROR_SETS = ["off", "1", "2", "3", "4"] as const;

const SAMPLES_PER_CLICK = 3;

type Pool = { audios: HTMLAudioElement[]; next: number };

const pools = new Map<string, Pool>();

let clickSet = "off";
let errorSet = "off";
let volume = 0.3;

function loadPool(folder: string, count: number): Pool {
  const cached = pools.get(folder);
  if (cached) return cached;

  const audios: HTMLAudioElement[] = [];
  for (let i = 1; i <= count; i += 1) {
    const audio = new Audio(`/static/sounds/${folder}/${i}.wav`);
    audio.preload = "auto";
    audio.volume = volume;
    audios.push(audio);
  }

  const pool: Pool = { audios, next: 0 };
  pools.set(folder, pool);
  return pool;
}

function play(pool: Pool): void {
  const audio = pool.audios[pool.next];
  pool.next = (pool.next + 1) % pool.audios.length;
  if (!audio) return;

  audio.volume = volume;
  // Перематываем: сэмпл может ещё играть с прошлого нажатия
  audio.currentTime = 0;
  // Браузер запрещает звук до первого действия пользователя — молча пропускаем
  void audio.play().catch(() => undefined);
}

export function configureSound(options: {
  click?: string;
  error?: string;
  volume?: number;
}): void {
  if (options.click !== undefined) clickSet = options.click;
  if (options.error !== undefined) errorSet = options.error;
  if (options.volume !== undefined) volume = Math.max(0, Math.min(1, options.volume));

  if (clickSet !== "off") loadPool(`click${clickSet}`, SAMPLES_PER_CLICK);
  if (errorSet !== "off") loadPool(`error${errorSet}`, 1);
}

export function playClick(): void {
  if (clickSet === "off") return;
  play(loadPool(`click${clickSet}`, SAMPLES_PER_CLICK));
}

export function playError(): void {
  if (errorSet === "off") return;
  play(loadPool(`error${errorSet}`, 1));
}

/**
 * Сигнал «время заканчивается». Файл лежит рядом с наборами щелчков
 * и до сих пор не использовался — настройка была нарисована впустую.
 */
let timeWarning: HTMLAudioElement | null = null;

export function playTimeWarning(): void {
  timeWarning ??= new Audio("/static/sounds/timeWarning.wav");
  timeWarning.volume = volume;
  timeWarning.currentTime = 0;
  void timeWarning.play().catch(() => undefined);
}
