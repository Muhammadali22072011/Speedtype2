/** Тонкая обёртка над fetch: один способ ходить в API и один способ ловить ошибки. */

import type { TestSummary } from "../core/engine";

const TOKEN_KEY = "speedtype_token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Подписчики на вход и выход. Шапке нужно перерисоваться сразу после
 * входа: navigate() ходит через pushState, а он popstate не порождает,
 * и без этой подписки в меню так и висели бы «войти» и «регистрация».
 */
const authListeners = new Set<() => void>();

export function onAuthChange(listener: () => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export function setToken(token: string | null): void {
  if (token === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);

  for (const listener of authListeners) listener();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...init, headers });

  if (!response.ok) {
    // FastAPI кладёт текст ошибки в detail; для 422 это может быть список
    let message = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail
          .map((item) => (item as { msg?: string }).msg ?? "")
          .filter(Boolean)
          .join("; ");
      }
    } catch {
      // тело не json — оставляем statusText
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --- типы ответов ---

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: string;
  avatar: string | null;
  created_at: string;
}

export interface Language {
  name: string;
  display_name: string;
  rtl: boolean;
}

/** Язык из файлов monkeytype, а не из базы. */
export interface LanguageFile {
  name: string;
  displayName: string;
  words: number;
}

export interface WordsResponse {
  words: string[];
  language: string;
  rtl: boolean;
  noLazyMode: boolean;
}

export interface RaceRoom {
  code: string;
  state: string;
  players: number;
}

export interface TextResponse {
  words: string[];
  language: string;
  source: string | null;
}

export interface Result {
  id: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  correct_chars: number;
  incorrect_chars: number;
  mode: string;
  mode_value: string;
  language: string;
  duration: number;
  created_at: string;
}

export interface Stats {
  tests: number;
  avg_wpm: number;
  best_wpm: number;
  avg_accuracy: number;
  time_typing: number;
  /** Сегодняшние сутки считает сервер — клиенту иначе пришлось бы тянуть всю историю. */
  tests_today: number;
  time_today: number;
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  avatar: string | null;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  mode: string;
  mode_value: string;
  language: string;
  created_at: string;
}

/** Страница лидерборда: строки и сколько их всего при этих фильтрах. */
export interface LeaderboardPage {
  rows: LeaderboardRow[];
  total: number;
}

/** Своё место в таблице — чтобы подсветить строку и перейти к ней. */
export interface LeaderboardSelf {
  rank: number | null;
  row: LeaderboardRow | null;
}

/** Фильтры лидерборда — одни и те же у таблицы и у своего места. */
export interface LeaderboardQuery {
  period?: string;
  mode?: string;
  modeValue?: string;
  language?: string;
  limit?: number;
  offset?: number;
}

function leaderboardParams(query: LeaderboardQuery): URLSearchParams {
  const params = new URLSearchParams({ period: query.period ?? "all" });
  if (query.mode) params.set("mode", query.mode);
  if (query.modeValue) params.set("mode_value", query.modeValue);
  if (query.language) params.set("language", query.language);
  return params;
}

// --- методы ---

export const api = {
  register: (username: string, email: string, password: string) =>
    request<{ access_token: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),

  login: (username: string, password: string) =>
    request<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<User>("/auth/me"),

  languages: () => request<Language[]>("/languages"),

  /** Полный список языков из файлов — их 432. */
  languageIndex: () => request<LanguageFile[]>("/languages/index"),

  words: (
    language: string,
    count: number,
    punctuation = false,
    numbers = false,
    zipf = false,
  ) => {
    const params = new URLSearchParams({
      count: String(count),
      punctuation: String(punctuation),
      numbers: String(numbers),
      zipf: String(zipf),
    });
    return request<WordsResponse>(`/words/${encodeURIComponent(language)}?${params}`);
  },

  createRoom: (language: string, wordCount: number, punctuation = false, numbers = false) =>
    request<RaceRoom>("/race", {
      method: "POST",
      body: JSON.stringify({
        language,
        word_count: wordCount,
        punctuation,
        numbers,
      }),
    }),

  roomInfo: (code: string) => request<RaceRoom>(`/race/${encodeURIComponent(code)}`),

  layoutIndex: () => request<string[]>("/layouts/index"),

  quoteSets: () => request<string[]>("/quotes/index"),

  text: (language: string, count: number, mode: string) =>
    request<TextResponse>(
      `/text?language=${encodeURIComponent(language)}&count=${count}&mode=${encodeURIComponent(mode)}`,
    ),

  submitResult: (summary: TestSummary) =>
    request<Result>("/results", {
      method: "POST",
      body: JSON.stringify({
        correct_chars: summary.correctChars,
        incorrect_chars: summary.incorrectChars,
        duration: summary.elapsed,
        wpm_samples: summary.wpmSamples,
        mode: summary.mode,
        mode_value: String(summary.modeValue),
        language: summary.language,
      }),
    }),

  myResults: (limit = 50, offset = 0) =>
    request<Result[]>(`/results?limit=${limit}&offset=${offset}`),

  myStats: () => request<Stats>("/results/stats"),

  /**
   * Страница лидерборда. Общее число строк сервер отдаёт заголовком
   * X-Total-Count — без него не посчитать, сколько всего страниц.
   */
  leaderboard: async (query: LeaderboardQuery = {}): Promise<LeaderboardPage> => {
    const params = leaderboardParams(query);
    params.set("limit", String(query.limit ?? 50));
    params.set("offset", String(query.offset ?? 0));

    const headers = new Headers({ "Content-Type": "application/json" });
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`/api/leaderboard?${params}`, { headers });
    if (!response.ok) throw new ApiError(response.statusText, response.status);

    const rows = (await response.json()) as LeaderboardRow[];
    const total = Number(response.headers.get("X-Total-Count") ?? rows.length);
    return { rows, total };
  },

  leaderboardMe: (query: LeaderboardQuery = {}) =>
    request<LeaderboardSelf>(`/leaderboard/me?${leaderboardParams(query)}`),
};
