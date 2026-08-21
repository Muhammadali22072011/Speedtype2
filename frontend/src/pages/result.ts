/**
 * Экран результата: всё, что показывается после теста.
 *
 * Живёт отдельно от pages/test.ts намеренно. Там — набор, каретка, лента
 * и режимы; здесь — цифры, график, разбор слов и кнопки. Файлы правят
 * по разным поводам, и держать их вместе значит спотыкаться друг о друга.
 *
 * Имена селекторов при переезде не менялись ни одного: на #result и всё,
 * что внутри, целятся файлы тем monkeytype. Переехал файл, не контракт.
 */

import "../styles/result.css";

import { api, ApiError, getToken, type Result, type Stats } from "../api/client";
import type { TestSummary, WordState } from "../core/engine";
import { getSettings, modeValue } from "../state/settings";
import { escapeHtml, formatDuration, formatSpeed, speedUnitLabel } from "../ui/format";
import { icon } from "../ui/icons";

export interface ResultScreenOptions {
  /** Куда рисовать — разметка теста заменяется целиком. */
  container: HTMLElement;
  summary: TestSummary;
  /** Слова прошедшего теста: нужны разбору, повтору и практике ошибок. */
  words: readonly WordState[];
  /** Источник цитаты, если тест был по цитате. */
  quoteSource: string | null;
  /** Страница ушла, пока мы ждали сервер, — рисовать уже некуда. */
  isDisposed: () => boolean;
  /** Начать заново: без слов — новый текст, со словами — тот же. */
  restart: (words?: string[]) => void;
}

export async function showResult(options: ResultScreenOptions): Promise<void> {
  const { container, summary, words, quoteSource, isDisposed, restart } = options;
  const s = getSettings();

  /**
   * Прошлый рекорд спрашиваем до сохранения — после него в статистике уже
   * лежит нынешний результат, и показать, что было раньше, нечем.
   *
   * Но НЕ ЖДЁМ ответа: запрос уходит, экран рисуется сразу, а корона и
   * «сегодня» дорисуются, когда придёт ответ. Раньше здесь стояло три
   * последовательных await до первой отрисовки — статистика, сохранение,
   * место за сутки, — и человек смотрел на застывший тест всё это время.
   */
  const beforePromise: Promise<Stats | null> =
    getToken() && s.showPb ? api.myStats().catch(() => null) : Promise.resolve(null);

  let saved: Result | null = null;
  let message = "";
  /** Обрыв связи, а не отказ сервера: такую отправку можно повторить. */
  let retryable = false;

  async function trySave(): Promise<void> {
    if (!s.resultSaving) {
      message = "сохранение выключено в настройках";
      return;
    }
    if (summary.failed) {
      message = summary.failReason;
      return;
    }

    try {
      saved = await api.submitResult(summary);
      message = "";
      retryable = false;
    } catch (error) {
      message = error instanceof ApiError ? error.message : "Сервер недоступен";
      // 4xx повторять бессмысленно: сервер понял запрос и отказал
      retryable = !(error instanceof ApiError) || error.status >= 500;
    }
  }

  if (isDisposed()) return;

  const unit = speedUnitLabel();
  const other = otherText();

  container.innerHTML = `
    <div id="result">
      ${summary.failed ? `<div class="failed">${icon("xmark")} ${escapeHtml(summary.failReason)}</div>` : ""}
      <div id="pbSlot"></div>
      <div class="stats">
        <div class="group">
          <div class="top">${unit}</div>
          <div class="bottom">${formatSpeed(summary.wpm)}</div>
        </div>
        <div class="group">
          <div class="top">точность</div>
          <div class="bottom">${summary.accuracy.toFixed(0)}%</div>
        </div>
        <div class="group small">
          <div class="top">raw</div>
          <div class="bottom">${formatSpeed(summary.raw)}</div>
        </div>
        <div class="group small">
          <div class="top">ровность</div>
          <div class="bottom">${summary.consistency.toFixed(0)}%</div>
        </div>
        <div class="group small">
          <div class="top">тип теста</div>
          <div class="bottom testType">${escapeHtml(testTypeText(summary))}</div>
        </div>
        ${
          other
            ? `<div class="group small">
                 <div class="top">прочее</div>
                 <div class="bottom testType">${escapeHtml(other)}</div>
               </div>`
            : ""
        }
        <div class="group small">
          <div class="top">символы</div>
          <div class="bottom chars"
               aria-label="верные / неверные / лишние / пропущенные"
               data-balloon-pos="up">${charBreakdown(summary)}</div>
        </div>
        <div class="group small">
          <div class="top">время</div>
          <div class="bottom">${summary.elapsed.toFixed(1)}с${
            summary.afkSeconds > 0
              ? `<span class="afk" aria-label="время без нажатий" data-balloon-pos="up">afk ${summary.afkSeconds}с</span>`
              : ""
          }</div>
        </div>
        <span id="lateSlot"></span>
      </div>
      ${
        quoteSource && s.mode === "quote"
          ? `<p class="quoteSource sub">${icon("quote")} ${escapeHtml(quoteSource)}</p>`
          : ""
      }
      <div class="chart" id="resultChart"></div>
      <div id="resultWordsHistory"${s.alwaysShowWordsHistory ? "" : " hidden"}>
        ${renderWordsHistory(words)}
      </div>
      <div id="saveNote"></div>
      ${
        getToken()
          ? ""
          : `<p class="sub center">
               <a href="/login" class="main">войдите</a>, чтобы результат попал в лидерборд
             </p>`
      }
      <div class="actions">
        <button class="button" id="again" aria-label="следующий тест" data-balloon-pos="down">
          ${icon("chevronRight")}
        </button>
        <button class="button" id="repeat" aria-label="повторить тот же текст" data-balloon-pos="down">
          ${icon("sync")}
        </button>
        <button class="button" id="practise" aria-label="практика ошибочных слов" data-balloon-pos="down">
          ${icon("triangleExclamation")}
        </button>
        <button class="button" id="toggleHistory" aria-label="разбор слов" data-balloon-pos="down">
          ${icon("alignLeft")}
        </button>
        <button class="button" id="shot" aria-label="картинка результата" data-balloon-pos="down">
          ${icon("save")}
        </button>
        <a class="button" href="/leaderboard" aria-label="лидерборд" data-balloon-pos="down">
          ${icon("crown")}
        </a>
      </div>
    </div>
  `;

  // График грузим отдельным чанком: он нужен только тем, кто дошёл до
  // конца теста, а бандл главной страницы платят все. Черту рекорда
  // рисуем без ожидания — она дорисуется, когда придёт статистика
  void drawChart(container, summary, null);

  const noteEl = container.querySelector<HTMLElement>("#saveNote")!;
  const pbSlot = container.querySelector<HTMLElement>("#pbSlot")!;
  const lateSlot = container.querySelector<HTMLElement>("#lateSlot")!;

  /**
   * Всё, что зависит от сервера, дорисовывается сюда: рекорд, «сегодня»,
   * место за сутки, подпись о сохранении. Порядок внутри не важен —
   * каждый кусок появляется, как только за ним пришёл ответ.
   */
  async function fillFromServer(): Promise<void> {
    const before = await beforePromise;

    if (before !== null && pbSlot.isConnected) {
      lateSlot.insertAdjacentHTML(
        "beforebegin",
        `<div class="group small">
           <div class="top">сегодня</div>
           <div class="bottom">${formatDuration(before.time_today + summary.elapsed)}</div>
         </div>`,
      );
    }

    await trySave();
    if (!noteEl.isConnected) return;
    drawNote();

    const previousBest = before && before.tests > 0 ? before.best_wpm : null;
    const isBest =
      saved !== null &&
      getToken() !== null &&
      s.showPb &&
      (previousBest === null || Math.round(summary.wpm) > Math.round(previousBest));

    // Черта рекорда на графике: перерисовываем его, когда узнали прошлый
    // рекорд. Дешевле, чем держать экран пустым ради одной линии
    if (previousBest !== null) void drawChart(container, summary, previousBest);

    if (isBest) {
      pbSlot.outerHTML = `<div class="personalBest" aria-label="${
        previousBest === null
          ? "первый сохранённый результат"
          : `прошлый рекорд — ${Math.round(previousBest)} ${unit}`
      }" data-balloon-pos="down">${icon("crown")} новый личный рекорд${
        previousBest === null ? "" : ` <span class="was">было ${Math.round(previousBest)}</span>`
      }</div>`;
    }

    // Место за сутки имеет смысл только у сохранённого результата
    if (saved && getToken()) {
      const rank = await api.leaderboardMe({ period: "daily" }).catch(() => null);
      if (rank?.rank != null && lateSlot.isConnected) {
        lateSlot.insertAdjacentHTML(
          "beforebegin",
          `<div class="group small">
             <div class="top">за сутки</div>
             <div class="bottom">${rank.rank} место</div>
           </div>`,
        );
      }
    }
  }

  /** Подпись о сохранении, а при обрыве связи — кнопка повтора. */
  function drawNote(): void {
    if (saved) {
      noteEl.className = "sub center";
      noteEl.textContent = getToken()
        ? "результат сохранён"
        : "сохранено как гостевой — войдите, чтобы попасть в лидерборд";
      return;
    }

    noteEl.className = "center saveFailed";
    noteEl.innerHTML = `
      <span class="error">${escapeHtml(message)}</span>
      ${retryable ? `<button class="button" id="retrySave">${icon("sync")} повторить</button>` : ""}
    `;

    noteEl.querySelector<HTMLElement>("#retrySave")?.addEventListener("click", () => {
      noteEl.innerHTML = `<span class="sub">отправляем…</span>`;
      void trySave().then(drawNote);
    });
  }

  // Пока идут запросы, вместо подписи о сохранении — многоточие: экран
  // уже виден, и человек понимает, что сохранение ещё в пути
  noteEl.className = "sub center";
  noteEl.textContent = "сохраняем…";
  void fillFromServer();

  // Слова прошлого теста нужны для «повторить» и «практики» — движок
  // к этому моменту уже будет заменён новым
  const wordsOfThisTest = words.map((w) => w.target);
  const missedWords = words.filter((w) => w.done && w.typed !== w.target).map((w) => w.target);

  // Без обёртки в слушатель прилетел бы Event вместо списка слов
  container.querySelector<HTMLElement>("#again")?.addEventListener("click", () => restart());

  container.querySelector<HTMLElement>("#repeat")?.addEventListener("click", () => {
    restart(wordsOfThisTest);
  });

  const practise = container.querySelector<HTMLButtonElement>("#practise");
  if (practise) {
    practise.disabled = missedWords.length === 0;
    practise.addEventListener("click", () => {
      // Слова с ошибками повторяем по кругу, пока не наберётся полный тест
      const target = Math.max(missedWords.length, modeValue(getSettings()));
      const list = Array.from({ length: target }, (_, i) => missedWords[i % missedWords.length]!);
      restart(list);
    });
  }

  container.querySelector<HTMLElement>("#toggleHistory")?.addEventListener("click", () => {
    const history = container.querySelector<HTMLElement>("#resultWordsHistory");
    if (history) history.hidden = !history.hidden;
  });

  container.querySelector<HTMLElement>("#shot")?.addEventListener("click", () => {
    saveResultCard(summary, unit);
  });

  // Копирование слов и тепловая карта скоростей — обе кнопки живут внутри
  // разбора, поэтому слушатель один на весь блок
  container.querySelector<HTMLElement>("#resultWordsHistory")?.addEventListener("click", (event) => {
    const copyButton = (event.target as HTMLElement).closest<HTMLElement>("button[data-copy]");
    if (copyButton) {
      void copyWords(words, copyButton.dataset["copy"]!, copyButton);
      return;
    }

    if ((event.target as HTMLElement).closest("[data-heatmap]")) {
      container.querySelector<HTMLElement>(".wordsHistory")?.classList.toggle("heat");
      const legend = container.querySelector<HTMLElement>(".heatLegend");
      if (legend) legend.hidden = !legend.hidden;
    }
  });
}

/** Копирование разбора: все слова, только ошибочные или то, что набрано. */
async function copyWords(
  words: readonly WordState[],
  what: string,
  button: HTMLElement,
): Promise<void> {
  const done = words.filter((w) => w.done);
  const list =
    what === "missed"
      ? done.filter((w) => w.typed !== w.target).map((w) => w.target)
      : what === "typed"
        ? done.map((w) => w.typed)
        : done.map((w) => w.target);

  try {
    await navigator.clipboard.writeText(list.join(" "));
    const was = button.getAttribute("aria-label") ?? "";
    button.setAttribute("aria-label", "скопировано");
    setTimeout(() => button.setAttribute("aria-label", was), 1200);
  } catch {
    // Буфер обмена может быть закрыт политикой браузера — молча выходим
  }
}

/**
 * Картинка результата: рисуем сами на canvas.
 *
 * Библиотеки снимка DOM весят под сотню килобайт и всё равно не знают
 * про наши переменные тем. А показать человек хочет ровно то же самое —
 * скорость, точность, режим и цвета своей темы.
 */
function saveResultCard(summary: TestSummary, unit: string): void {
  const css = getComputedStyle(document.documentElement);
  const colors = {
    bg: css.getPropertyValue("--bg-color").trim() || "#111",
    main: css.getPropertyValue("--main-color").trim() || "#e2b714",
    text: css.getPropertyValue("--text-color").trim() || "#eee",
    sub: css.getPropertyValue("--sub-color").trim() || "#888",
  };

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = colors.sub;
  ctx.font = "32px Roboto Mono, monospace";
  ctx.fillText("speedtype", 80, 100);
  ctx.fillText(testTypeText(summary), 80, 150);

  ctx.fillStyle = colors.main;
  ctx.font = "bold 180px Roboto Mono, monospace";
  ctx.fillText(formatSpeed(summary.wpm), 80, 380);

  ctx.fillStyle = colors.sub;
  ctx.font = "48px Roboto Mono, monospace";
  ctx.fillText(unit, 80, 450);

  ctx.fillStyle = colors.text;
  ctx.font = "56px Roboto Mono, monospace";
  ctx.fillText(`${summary.accuracy.toFixed(0)}% точность`, 620, 300);
  ctx.fillText(`${formatSpeed(summary.raw)} raw`, 620, 380);
  ctx.fillText(`${summary.consistency.toFixed(0)}% ровность`, 620, 460);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "speedtype.png";
    link.click();
    URL.revokeObjectURL(url);
  });
}

/** Строка «прочее»: funbox и режимы, которые не влезли в тип теста. */
function otherText(): string {
  const s = getSettings();
  const parts: string[] = [];

  if (s.funbox.length > 0) parts.push(s.funbox.join(", ").replace(/_/g, " "));
  if (s.lazyMode) parts.push("без диакритики");
  if (s.blindMode) parts.push("слепой режим");

  return parts.join(" · ");
}

/** «время 30 english пунктуация» — как в их строке test type. */
function testTypeText(summary: { mode: string; modeValue: number; language: string }): string {
  const names: Record<string, string> = {
    time: "время",
    words: "слова",
    quote: "цитата",
    custom: "свой текст",
    zen: "zen",
  };
  const s = getSettings();

  const parts = [names[summary.mode] ?? summary.mode];
  if (summary.mode !== "quote" && summary.mode !== "zen") parts.push(String(summary.modeValue));
  parts.push(summary.language.replace(/_/g, " "));
  if (s.punctuation) parts.push("пунктуация");
  if (s.numbers) parts.push("цифры");
  if (s.difficulty !== "normal") parts.push(s.difficulty === "expert" ? "эксперт" : "мастер");

  return parts.join(" ");
}

/**
 * Четыре числа вместо двух: верные, неверные, лишние, пропущенные.
 * Лишние и пропущенные входят в incorrectChars — вычитаем их, чтобы
 * разбивка читалась так же, как у monkeytype, а сумма сходилась.
 */
function charBreakdown(summary: {
  correctChars: number;
  incorrectChars: number;
  extraChars: number;
  missedChars: number;
}): string {
  const wrong = Math.max(0, summary.incorrectChars - summary.extraChars - summary.missedChars);
  return `${summary.correctChars}/${wrong}/${summary.extraChars}/${summary.missedChars}`;
}

/**
 * Разбор слов: три кнопки копирования, тепловая карта скоростей и её
 * легенда — как у monkeytype. Тепло берём из burst каждого слова:
 * движок его уже считает, отдельных замеров не нужно.
 */
function renderWordsHistory(words: readonly WordState[]): string {
  const done = words.filter((w) => w.done);
  if (done.length === 0) return "";

  const bursts = done.map((w) => w.burst).filter((b) => b > 0);
  const fastest = Math.max(1, ...bursts);
  const slowest = Math.min(...bursts, fastest);

  /** Пять ступеней от медленного к быстрому — как у их тепловой карты. */
  function heatLevel(burst: number): number {
    if (burst <= 0 || fastest === slowest) return 2;
    return Math.min(4, Math.floor(((burst - slowest) / (fastest - slowest)) * 5));
  }

  const list = done
    .map(
      (w) =>
        `<span class="${w.typed === w.target ? "ok" : "bad"} heat-${heatLevel(w.burst)}"
               aria-label="${Math.round(w.burst)} wpm" data-balloon-pos="up">${escapeHtml(
                 w.target,
               )}</span>`,
    )
    .join(" ");

  const legend = [0, 1, 2, 3, 4].map((level) => `<span class="heat-${level}"></span>`).join("");

  return `
    <div class="historyTools">
      <button class="button" data-copy="all" aria-label="скопировать слова" data-balloon-pos="up">
        ${icon("copy")} слова
      </button>
      <button class="button" data-copy="missed" aria-label="скопировать слова с ошибками" data-balloon-pos="up">
        ${icon("copy")} ошибки
      </button>
      <button class="button" data-copy="typed" aria-label="скопировать набранное" data-balloon-pos="up">
        ${icon("copy")} набрано
      </button>
      <button class="button" data-heatmap aria-label="тепловая карта скорости" data-balloon-pos="up">
        ${icon("chart")} тепло
      </button>
    </div>
    <div class="wordsHistory${getSettings().burstHeatmap ? " heat" : ""}">${list}</div>
    <div class="heatLegend sub"${getSettings().burstHeatmap ? "" : " hidden"}>
      медленно ${legend} быстро
    </div>`;
}

/**
 * График скорости: скорость, raw, скорость по словам, крестики ошибок,
 * черта рекорда и легенда из шести переключателей.
 *
 * Модуль графиков подключается динамически. Он нужен один раз, в конце
 * теста, — держать его в бандле главной значит заставить платить за него
 * и тех, кто до конца не дошёл.
 */
async function drawChart(
  container: HTMLElement,
  summary: TestSummary,
  personalBest: number | null,
): Promise<void> {
  const found = container.querySelector<HTMLElement>("#resultChart");
  if (!found) return;
  // Отдельная переменная с явным типом: сужение по if внутрь замыканий
  // ниже не проходит, а рисовать график мы будем именно оттуда
  const box: HTMLElement = found;

  const { renderSpeedChart, bindChart } = await import("../ui/charts");

  // Пока грузился модуль, человек мог нажать «ещё раз» — экрана уже нет
  if (!box.isConnected) return;

  /**
   * Ширину графика меряем здесь и отдаём в пикселях.
   *
   * Раньше svg рисовался в условных 800×220 и растягивался средствами
   * css. На широком экране множитель выходил под два: подписи осей
   * становились в палец высотой, крестики ошибок — с кнопку, а сам
   * график вылезал из своих двухсот точек и ложился поверх подписи
   * о сохранении и ряда кнопок под ним.
   */
  function draw(): void {
    box.innerHTML = renderSpeedChart({
      speed: summary.speedSamples,
      raw: summary.rawSamples,
      burst: summary.burstSamples,
      errors: summary.errorSamples,
      personalBest,
      fromZero: getSettings().startGraphsAtZero,
      width: box.clientWidth,
      height: 200,
    });
  }

  draw();
  bindChart(box);

  // Перерисовываем по месту: масштабирование готового svg вернуло бы ту
  // же кашу из растянутых подписей, только слабее
  if (typeof ResizeObserver !== "undefined") {
    let last = box.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!box.isConnected) {
        observer.disconnect();
        return;
      }
      // Порог в десять точек: без него наблюдатель зовёт сам себя
      // на каждый пиксель дрожания полосы прокрутки
      if (Math.abs(box.clientWidth - last) < 10) return;
      last = box.clientWidth;
      draw();
    });
    observer.observe(box);
  }
}
