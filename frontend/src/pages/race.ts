/**
 * Онлайн-гонка. Комната создаётся по коду, текст у всех одинаковый,
 * прогресс каждого едет полосой в реальном времени.
 */

import { api, ApiError, getToken } from "../api/client";
import { TypingEngine } from "../core/engine";
import { navigate, type PageContext } from "../router";
import { getSettings } from "../state/settings";
import { escapeHtml } from "../ui/format";
import { icon } from "../ui/icons";

interface RacePlayer {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  progress: number;
  wpm: number;
  accuracy: number;
  place: number | null;
  finished: boolean;
}

interface RoomView {
  code: string;
  state: "waiting" | "countdown" | "racing" | "finished";
  language: string;
  wordCount: number;
  words: string[];
  players: RacePlayer[];
}

export async function racePage({ container, params }: PageContext): Promise<() => void> {
  const code = params.get("code");

  if (!code) {
    renderLobby(container);
    return () => undefined;
  }

  return joinRoom(container, code.toUpperCase());
}

// ---------- вход в гонку ----------

function renderLobby(container: HTMLElement): void {
  container.innerHTML = `
    <div id="race">
      <h2>${icon("users")} онлайн-гонка</h2>
      <p class="sub">создайте комнату и пришлите код друзьям — текст у всех будет одинаковый</p>

      <div class="form" style="margin:1.5rem 0">
        <button class="button" id="create">${icon("flag")} создать комнату</button>
        <p class="sub" style="text-align:center; font-size:0.8rem">или</p>
        <input class="input" id="code" placeholder="код комнаты" maxlength="5"
               autocomplete="off" style="text-transform:uppercase; text-align:center">
        <button class="button" id="join">${icon("arrowRight")} войти</button>
        <p class="error" id="error"></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector<HTMLElement>("#error")!;
  const codeEl = container.querySelector<HTMLInputElement>("#code")!;

  container.querySelector<HTMLElement>("#create")!.addEventListener("click", async () => {
    const s = getSettings();
    try {
      const room = await api.createRoom(s.language, s.wordsValue, s.punctuation, s.numbers);
      navigate(`/race?code=${room.code}`);
    } catch (error) {
      errorEl.textContent =
        error instanceof ApiError ? error.message : "Не удалось создать комнату";
    }
  });

  const join = (): void => {
    const value = codeEl.value.trim().toUpperCase();
    if (value.length < 4) {
      errorEl.textContent = "Код состоит из 5 символов";
      return;
    }
    navigate(`/race?code=${value}`);
  };

  container.querySelector<HTMLElement>("#join")!.addEventListener("click", join);
  codeEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") join();
  });
}

// ---------- сама гонка ----------

function joinRoom(container: HTMLElement, code: string): () => void {
  container.innerHTML = `
    <div id="race">
      <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap">
        <h2>комната ${escapeHtml(code)}</h2>
        <button class="button" id="copy" style="padding:0.35rem 0.6rem">${icon("copy")} код</button>
        <span class="sub" id="status">подключение…</span>
      </div>

      <div id="countdown" hidden></div>

      <div class="players" id="players"></div>

      <div id="raceTest" hidden>
        <div id="liveStats"></div>
        <div id="wordsWrapper">
          <div id="words"></div>
          <div id="caret" class="hidden"></div>
        </div>
        <input id="wordsInput" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" aria-label="Поле ввода гонки">
      </div>

      <div id="raceActions" style="display:flex; gap:0.75rem; justify-content:center">
        <button class="button" id="ready">${icon("check")} готов</button>
        <a class="button" href="/race">${icon("xmark")} выйти</a>
      </div>

      <p class="error" id="error"></p>
    </div>
  `;

  const statusEl = container.querySelector<HTMLElement>("#status")!;
  const countdownEl = container.querySelector<HTMLElement>("#countdown")!;
  const playersEl = container.querySelector<HTMLElement>("#players")!;
  const testEl = container.querySelector<HTMLElement>("#raceTest")!;
  const liveEl = container.querySelector<HTMLElement>("#liveStats")!;
  const wrapperEl = container.querySelector<HTMLElement>("#wordsWrapper")!;
  const wordsEl = container.querySelector<HTMLElement>("#words")!;
  const caretEl = container.querySelector<HTMLElement>("#caret")!;
  const inputEl = container.querySelector<HTMLInputElement>("#wordsInput")!;
  const readyEl = container.querySelector<HTMLButtonElement>("#ready")!;
  const errorEl = container.querySelector<HTMLElement>("#error")!;

  let socket: WebSocket | null = null;
  let engine: TypingEngine | null = null;
  let unsubscribe: (() => void) | null = null;
  let myId = "";
  let ready = false;
  let disposed = false;
  let lastSent = 0;

  const name = localStorage.getItem("speedtype_name") ?? (getToken() ? "игрок" : "гость");

  // ws:// или wss:// — в зависимости от того, как открыта страница
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${window.location.host}/api/race/${code}/ws?name=${encodeURIComponent(name)}`;

  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    statusEl.textContent = "в комнате";
  });

  socket.addEventListener("close", (event) => {
    if (disposed) return;
    statusEl.textContent = "соединение закрыто";
    if (event.reason) errorEl.textContent = event.reason;
  });

  socket.addEventListener("error", () => {
    if (!disposed) errorEl.textContent = "Ошибка соединения";
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;

    switch (message["type"]) {
      case "joined":
        myId = String(message["playerId"]);
        renderRoom(message["room"] as RoomView);
        break;

      case "room":
        renderRoom(message["room"] as RoomView);
        break;

      case "countdown":
        countdownEl.hidden = false;
        countdownEl.textContent = String(message["value"]);
        break;

      case "start":
        countdownEl.hidden = true;
        beginRace();
        break;

      case "progress":
        updatePlayer(message as unknown as RacePlayer);
        break;

      case "finish":
        statusEl.textContent = "гонка окончена";
        break;

      // Сервер спрашивает, живы ли мы, когда мы долго молчим. Ответ нужен
      // ему, чтобы не держать в комнате оборванное соединение: молчащий
      // участник иначе блокировал бы и старт, и финиш для всех остальных.
      case "ping":
        send({ type: "pong" });
        break;
    }
  });

  // ---------- отрисовка комнаты ----------

  let currentRoom: RoomView | null = null;

  function renderRoom(room: RoomView): void {
    currentRoom = room;
    statusEl.textContent =
      { waiting: "ждём игроков", countdown: "приготовиться", racing: "гонка идёт", finished: "финиш" }[
        room.state
      ] ?? "";

    playersEl.innerHTML = room.players
      .map(
        (p) => `
        <div class="player${p.id === myId ? " me" : ""}" data-player="${escapeHtml(p.id)}">
          <span class="name">
            ${p.isHost ? icon("crown") : ""}
            ${escapeHtml(p.name)}
            ${p.ready && room.state === "waiting" ? `<span class="main">готов</span>` : ""}
          </span>
          <span class="place">
            ${p.place ? `${p.place} место` : `${Math.round(p.wpm)} wpm`}
          </span>
          <span class="track"><span class="fill" style="width:${p.progress * 100}%"></span></span>
        </div>`,
      )
      .join("");

    readyEl.hidden = room.state !== "waiting";
    if (room.players.length < 2 && room.state === "waiting") {
      statusEl.textContent = "нужен ещё хотя бы один игрок";
    }
  }

  function updatePlayer(update: RacePlayer): void {
    const row = playersEl.querySelector<HTMLElement>(`[data-player="${update.id}"]`);
    if (!row) return;

    const fill = row.querySelector<HTMLElement>(".fill");
    if (fill) fill.style.width = `${update.progress * 100}%`;

    const place = row.querySelector<HTMLElement>(".place");
    if (place && !update.place) place.textContent = `${Math.round(update.wpm)} wpm`;
  }

  // ---------- гонка ----------

  function beginRace(): void {
    if (!currentRoom || currentRoom.words.length === 0) return;

    testEl.hidden = false;
    readyEl.hidden = true;

    engine = new TypingEngine({
      mode: "words",
      modeValue: currentRoom.words.length,
      language: currentRoom.language,
      words: currentRoom.words,
    });

    unsubscribe = engine.subscribe(() => {
      renderWords();
      const stats = engine!.stats;
      liveEl.innerHTML = `<span class="value">${Math.round(stats.wpm)}<span class="label">wpm</span></span>`;

      // Шлём прогресс не чаще пяти раз в секунду, иначе канал забивается
      const now = performance.now();
      if (now - lastSent > 200 || engine!.finished) {
        lastSent = now;
        // Шлём число верных символов, а не свою скорость: wpm и прогресс
        // теперь считает сервер по собственным часам и длине текста.
        // Раньше браузер присылал готовый wpm, и сервер рассылал его
        // остальным как истину — подделывалось одной строкой в консоли.
        send({
          type: "progress",
          chars: stats.correctChars,
          accuracy: stats.accuracy,
        });
      }

      if (engine!.finished) {
        send({ type: "done", chars: stats.correctChars, accuracy: stats.accuracy });
        void api.submitResult(engine!.summary).catch(() => undefined);
        unsubscribe?.();
      }
    });

    renderWords();
    inputEl.focus();
  }

  function renderWords(): void {
    if (!engine) return;

    const parts: string[] = [];
    for (let index = 0; index < engine.words.length; index += 1) {
      const word = engine.words[index]!;
      const states = engine.charStates(index);

      const letters = states
        .map((state, i) => {
          const char = i < word.target.length ? word.target[i]! : word.typed[i]!;
          const cls = state === "pending" ? "" : ` class="${state}"`;
          return `<letter${cls}>${escapeHtml(char)}</letter>`;
        })
        .join("");

      const error = word.done && word.typed !== word.target;
      parts.push(`<div class="word${error ? " error" : ""}" data-wordindex="${index}">${letters}</div>`);
    }

    wordsEl.innerHTML = parts.join("");
    moveCaret();
  }

  function moveCaret(): void {
    if (!engine) return;

    const wordEl = wordsEl.querySelector<HTMLElement>(`.word[data-wordindex="${engine.wordIndex}"]`);
    if (!wordEl) {
      caretEl.classList.add("hidden");
      return;
    }

    const word = engine.words[engine.wordIndex]!;
    const letters = wordEl.querySelectorAll<HTMLElement>("letter");
    const target = letters[word.typed.length];
    const anchor = target ?? letters[letters.length - 1] ?? wordEl;

    const box = wrapperEl.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();

    caretEl.classList.remove("hidden");
    caretEl.style.left = `${(target ? rect.left : rect.right) - box.left}px`;
    caretEl.style.top = `${rect.top - box.top}px`;
    caretEl.style.height = `${rect.height || 24}px`;
  }

  function send(payload: Record<string, unknown>): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  // ---------- события ----------

  readyEl.addEventListener("click", () => {
    ready = !ready;
    readyEl.classList.toggle("active", ready);
    send({ type: "ready", value: ready });
  });

  container.querySelector<HTMLElement>("#copy")!.addEventListener("click", () => {
    void navigator.clipboard?.writeText(code);
    statusEl.textContent = "код скопирован";
  });

  wrapperEl.addEventListener("click", () => inputEl.focus());

  inputEl.addEventListener("keydown", (event) => {
    if (!engine || engine.finished) return;

    if (event.key === "Backspace") {
      event.preventDefault();
      engine.backspace(event.ctrlKey);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      engine.type(event.key);
    }
  });

  return () => {
    disposed = true;
    unsubscribe?.();
    engine?.dispose();
    socket?.close();
  };
}
