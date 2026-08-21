/**
 * Онлайн-гонка. Комната создаётся по коду, текст у всех одинаковый,
 * прогресс каждого едет полосой в реальном времени.
 */

import { api, ApiError, getToken } from "../api/client";
import { TypingEngine } from "../core/engine";
import { navigate, type PageContext } from "../router";
import { configureSound, playClick, playError } from "../core/sound";
import { getSettings } from "../state/settings";
import { escapeHtml } from "../ui/format";
import { icon } from "../ui/icons";
import { createWordsView } from "../ui/words";

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

      <div class="form raceForm">
        <button class="button" id="create">${icon("flag")} создать комнату</button>
        <p class="sub raceOr">или</p>
        <input class="input raceCode" id="code" placeholder="код комнаты" maxlength="5"
               autocomplete="off">
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
    <div id="race" class="raceRoom" data-state="waiting">
      <div class="raceHead">
        <h2>комната ${escapeHtml(code)}</h2>
        <button class="button raceCopy" id="copy">${icon("copy")} код</button>
        <span class="sub" id="status">подключение…</span>
      </div>

      <div id="countdown" class="raceCountdown" hidden></div>

      <div class="players raceTracks" id="players"></div>

      <div id="raceTest" hidden>
        <div id="liveStats" class="raceLive"></div>
        <div id="wordsWrapper">
          <div id="words"></div>
          <div id="caret"></div>
        </div>
        <input id="wordsInput" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" aria-label="Поле ввода гонки">
      </div>

      <div id="raceResults" class="raceResults" hidden></div>

      <div id="raceActions" class="raceActions">
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

  /**
   * Слова и каретка рисуются общим кодом с тестом. Раньше у гонки была
   * своя урезанная копия: каретка висела с классом hidden, стиль каретки,
   * подсветка, лента и показ опечаток не работали вовсе.
   */
  const view = createWordsView({
    wrapper: wrapperEl,
    words: wordsEl,
    caret: caretEl,
    engine: () => engine,
  });
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

    // Состояние на корне: по нему css решает, что показывать
    container.querySelector<HTMLElement>("#race")?.setAttribute("data-state", room.state);
    if (room.state === "finished") showResults(room);
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

    // Звук нажатий тот же, что на тесте, и по тем же настройкам
    const s = getSettings();
    configureSound({ click: s.soundOnClick, error: s.soundOnError, volume: s.soundVolume });

    engine = new TypingEngine({
      mode: "words",
      modeValue: currentRoom.words.length,
      language: currentRoom.language,
      words: currentRoom.words,
    });

    unsubscribe = engine.subscribe(() => {
      view.render();
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

        // Результат гонки сохраняется как обычный. Ошибку показываем:
        // раньше здесь стоял молчаливый catch, и человек был уверен, что
        // результат в истории, хотя его там не было
        void api.submitResult(engine!.summary).catch((error: unknown) => {
          errorEl.textContent =
            error instanceof ApiError
              ? `результат не сохранён: ${error.message}`
              : "результат не сохранён — сервер недоступен";
        });

        unsubscribe?.();
      }
    });

    view.applyLook();
    view.render();
    inputEl.focus();
  }

  /** Итог гонки: кто где финишировал. */
  function showResults(room: RoomView): void {
    const resultsEl = container.querySelector<HTMLElement>("#raceResults");
    if (!resultsEl) return;

    const finished = [...room.players]
      .filter((p) => p.finished)
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));

    if (finished.length === 0) return;

    resultsEl.hidden = false;
    resultsEl.innerHTML = `
      <h3 class="sectionTitle">${icon("crown")} итог</h3>
      <table class="table raceTable">
        <thead><tr><th>место</th><th>игрок</th><th>wpm</th><th>точность</th></tr></thead>
        <tbody>
          ${finished
            .map(
              (p) => `
            <tr${p.id === myId ? ` class="me"` : ""}>
              <td>${p.place ?? "—"}</td>
              <td>${escapeHtml(p.name)}</td>
              <td class="main">${Math.round(p.wpm)}</td>
              <td class="muted">${Math.round(p.accuracy)}%</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;
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
      view.hold();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();

      // Верно или мимо — узнаём до нажатия, чтобы проиграть нужный звук
      const word = engine.words[engine.wordIndex];
      const expected = word?.target[word.typed.length];
      const correct = event.key === " " || expected === event.key;

      engine.type(event.key);
      view.hold();

      if (correct) playClick();
      else playError();
    }
  });

  return () => {
    disposed = true;
    unsubscribe?.();
    engine?.dispose();
    view.dispose();
    socket?.close();
  };
}
