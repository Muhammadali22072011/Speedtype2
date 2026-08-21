/**
 * Профиль: сводка, личные рекорды по режимам и история с фильтрами.
 *
 * Рекорды и фильтры — самое заметное, чего здесь не было: по одной
 * странице истории нельзя понять ни своего потолка, ни того, в каком
 * режиме он взят.
 */

import {
  api,
  ApiError,
  getToken,
  type PersonalRecord,
  type Result,
  type ResultsQuery,
} from "../api/client";
import { navigate, type PageContext } from "../router";
import { TIME_OPTIONS, WORD_OPTIONS } from "../state/settings";
import { escapeHtml, formatDate, formatDuration } from "../ui/format";
import { icon } from "../ui/icons";
import { openLanguagePicker, openTagPicker } from "../ui/pickers";

/** Сколько результатов на странице истории. */
const PAGE_SIZE = 25;

/** Режимы, по которым показываем рекорды — те же, что в панели теста. */
const RECORD_MODES = [
  ...TIME_OPTIONS.map((value) => ({ mode: "time", value: String(value), label: `${value}с` })),
  ...WORD_OPTIONS.map((value) => ({ mode: "words", value: String(value), label: `${value} слов` })),
];

const MODE_FILTERS = [
  { key: "", label: "все режимы" },
  { key: "time", label: "время" },
  { key: "words", label: "слова" },
  { key: "quote", label: "цитата" },
];

export async function profilePage({ container }: PageContext): Promise<void> {
  if (!getToken()) {
    navigate("/login", true);
    return;
  }

  container.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;

  try {
    const [user, stats, records, progress] = await Promise.all([
      api.me(),
      api.myStats(),
      api.myRecords(),
      // Уровень не критичен для страницы: если ручка отвалится, покажем
      // остальное, а не пустой экран с ошибкой
      api.progress().catch(() => null),
    ]);

    container.innerHTML = `
      <div class="profileHead">
        ${
          user.avatar
            ? `<img class="avatar big" src="${escapeHtml(user.avatar)}" alt="" loading="lazy">`
            : `<span class="avatar big avatarEmpty">${icon("user")}</span>`
        }
        <div>
          <h2>${escapeHtml(user.username)}</h2>
          <p class="muted">с ${formatDate(user.created_at)}</p>
        </div>
        <a class="button" href="/account" aria-label="настройки аккаунта" data-balloon-pos="left">
          ${icon("gear")}
        </a>
      </div>

      ${
        progress === null
          ? ""
          : `<div class="levelRow">
               <span class="levelBadge"
                     aria-label="${progress.xp} опыта всего, ${progress.words_typed} слов набрано"
                     data-balloon-pos="right">${progress.level}</span>
               <div class="levelBar">
                 <div class="progressBar">
                   <div class="fill" style="width: ${(progress.progress * 100).toFixed(1)}%"></div>
                 </div>
                 <span class="sub">${progress.xp_in_level} из ${progress.xp_for_level} опыта до ${
                   progress.level + 1
                 } уровня</span>
               </div>
             </div>`
      }

      <div class="statGrid">
        <div class="statTile">
          <span class="label">тестов</span>
          <span class="value">${stats.tests}</span>
        </div>
        <div class="statTile">
          <span class="label">средний wpm</span>
          <span class="value">${stats.avg_wpm.toFixed(0)}</span>
        </div>
        <div class="statTile big">
          <span class="label">рекорд</span>
          <span class="value">${stats.best_wpm.toFixed(0)}</span>
        </div>
        <div class="statTile">
          <span class="label">точность</span>
          <span class="value">${stats.avg_accuracy.toFixed(0)}%</span>
        </div>
        <div class="statTile">
          <span class="label">за клавиатурой</span>
          <span class="value">${formatDuration(stats.time_typing)}</span>
        </div>
        <div class="statTile">
          <span class="label">сегодня</span>
          <span class="value">${formatDuration(stats.time_today)}</span>
        </div>
        ${
          progress === null
            ? ""
            : `<div class="statTile"
                    aria-label="самая длинная серия — ${progress.longest_streak} дней"
                    data-balloon-pos="up">
                 <span class="label">серия дней</span>
                 <span class="value">${progress.streak}</span>
               </div>`
        }
      </div>

      <h2 class="sectionTitle">${icon("crown")} личные рекорды</h2>
      ${recordsHtml(records)}

      <h2 class="sectionTitle">${icon("chart")} активность за год</h2>
      <div id="heatmap"><div class="loadingState"><div class="spinner"></div>загрузка</div></div>

      <h2 class="sectionTitle">${icon("chart")} где вы обычно</h2>
      <div id="histogram"><div class="loadingState"><div class="spinner"></div>загрузка</div></div>

      <h2 class="sectionTitle">${icon("alignLeft")} история</h2>
      <div class="configBar" id="filters">
        ${MODE_FILTERS.map(
          (f, i) =>
            `<button class="button${i === 0 ? " active" : ""}" data-mode="${f.key}">${f.label}</button>`,
        ).join("")}
        <button class="button" id="languageButton">${icon("globe")} <span data-language>все языки</span></button>
        <button class="button" id="tagFilter">${icon("hashtag")} <span data-tagfilter>все метки</span></button>
        <button class="button" id="filterReset" hidden>${icon("xmark")} сбросить</button>
      </div>
      <div class="configBar" id="dates">
        <label class="dateFilter">с <input class="input" type="date" data-since></label>
        <label class="dateFilter">по <input class="input" type="date" data-until></label>
      </div>

      <div id="history" class="tableScroll">
        <div class="loadingState"><div class="spinner"></div>загрузка</div>
      </div>
      <div id="historyPager" class="pager" hidden></div>
    `;

    setupHistory(container);
    void drawCharts(container);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login", true);
      return;
    }
    container.innerHTML = `<div class="errorState">${icon("triangleExclamation")}${escapeHtml(
      error instanceof ApiError ? error.message : "Сервер недоступен",
    )}</div>`;
  }
}

/**
 * Таблица рекордов: строка на режим. Пустые режимы показываем прочерком —
 * так видно, что в них ещё не пробовали, а не что данные потерялись.
 */
function recordsHtml(records: readonly PersonalRecord[]): string {
  const found = new Map(records.map((r) => [`${r.mode} ${r.mode_value}`, r]));

  // Цитаты и свой текст в сетку режимов не ложатся — их показываем отдельной
  // строкой, если рекорд есть
  const extra = records.filter((r) => r.mode !== "time" && r.mode !== "words");

  const cell = (record: PersonalRecord | undefined, label: string): string => {
    if (!record) {
      return `<div class="recordCard empty">
                <div class="recordMode">${escapeHtml(label)}</div>
                <div class="recordWpm">—</div>
              </div>`;
    }

    // Подсказка короткая намеренно: она рисуется absolute с nowrap и при
    // длинном тексте вылезает за край страницы у крайних карточек
    return `<div class="recordCard"
                 aria-label="${Math.round(record.raw)} raw · ${record.consistency.toFixed(
                   0,
                 )}% ровность · ${formatDate(record.created_at).split(",")[0]}"
                 data-balloon-pos="up">
              <div class="recordMode">${escapeHtml(label)}</div>
              <div class="recordWpm">${Math.round(record.wpm)}</div>
              <div class="recordAcc">${record.accuracy.toFixed(0)}%</div>
            </div>`;
  };

  return `
    <div class="recordGrid">
      ${RECORD_MODES.map((m) => cell(found.get(`${m.mode} ${m.value}`), m.label)).join("")}
      ${extra
        .map((r) => cell(r, `${r.mode} ${r.mode_value}`.trim()))
        .join("")}
    </div>`;
}

/**
 * Тепловая карта и гистограмма. Оба ряда считает сервер: за год истории
 * клиент иначе тянул бы все результаты ради одного числа на день.
 *
 * Модуль графиков подключается динамически — на бандл главной страницы
 * он не влияет.
 */
async function drawCharts(container: HTMLElement): Promise<void> {
  const heatEl = container.querySelector<HTMLElement>("#heatmap");
  const histEl = container.querySelector<HTMLElement>("#histogram");
  if (!heatEl || !histEl) return;

  const [charts, activity, histogram] = await Promise.all([
    import("../ui/charts"),
    api.activity().catch(() => null),
    api.histogram(HISTOGRAM_STEP).catch(() => null),
  ]);

  // Пока грузилось, могли уйти со страницы
  if (!heatEl.isConnected) return;

  heatEl.innerHTML =
    activity === null
      ? `<div class="errorState">${icon("triangleExclamation")}не удалось загрузить активность</div>`
      : charts.renderHeatmap(activity, new Date());

  if (histogram === null) {
    histEl.innerHTML = `<div class="errorState">${icon("triangleExclamation")}не удалось загрузить распределение</div>`;
    return;
  }

  // Гистограмму рисуем в пикселях по замеру места, как и график скорости.
  // Иначе узкая карточка растянула бы её своими силами, раздув подписи
  const drawHistogram = (): void => {
    histEl.innerHTML = charts.renderHistogram(histogram, HISTOGRAM_STEP, histEl.clientWidth);
  };
  drawHistogram();

  if (typeof ResizeObserver !== "undefined") {
    let last = histEl.clientWidth;
    const observer = new ResizeObserver(() => {
      if (!histEl.isConnected) {
        observer.disconnect();
        return;
      }
      // Порог, чтобы наблюдатель не звал сам себя на каждый пиксель
      if (Math.abs(histEl.clientWidth - last) < 10) return;
      last = histEl.clientWidth;
      drawHistogram();
    });
    observer.observe(histEl);
  }
}

/** Ширина столбика гистограммы в wpm. */
const HISTOGRAM_STEP = 10;

/** История: фильтры, страницы, удаление строки. */
function setupHistory(container: HTMLElement): void {
  const historyEl = container.querySelector<HTMLElement>("#history")!;
  const pagerEl = container.querySelector<HTMLElement>("#historyPager")!;
  const filtersEl = container.querySelector<HTMLElement>("#filters")!;
  const datesEl = container.querySelector<HTMLElement>("#dates")!;
  const languageLabel = container.querySelector<HTMLElement>("[data-language]")!;
  const resetEl = container.querySelector<HTMLElement>("#filterReset")!;
  const sinceEl = container.querySelector<HTMLInputElement>("[data-since]")!;
  const untilEl = container.querySelector<HTMLInputElement>("[data-until]")!;
  const tagLabel = container.querySelector<HTMLElement>("[data-tagfilter]")!;

  let page = 0;
  let mode = "";
  let language = "";
  /** Последняя показанная страница — из неё берутся метки строки. */
  let rows: Result[] = [];
  /** Метки, по которым фильтруем. Складываются по «И» — так на сервере. */
  let tagIds: number[] = [];

  function query(): ResultsQuery {
    return {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(mode ? { mode } : {}),
      ...(language ? { language } : {}),
      ...(tagIds.length > 0 ? { tagIds } : {}),
      // Верхнюю дату берём концом дня: иначе «по 5 июня» отсекает сам день
      ...(sinceEl.value ? { since: `${sinceEl.value}T00:00:00` } : {}),
      ...(untilEl.value ? { until: `${untilEl.value}T23:59:59` } : {}),
    };
  }

  function anyFilter(): boolean {
    return Boolean(mode || language || sinceEl.value || untilEl.value || tagIds.length > 0);
  }

  function rowHtml(r: Result): string {
    return `
      <tr data-id="${r.id}">
        <td style="color: var(--main-color)">${Math.round(r.wpm)}</td>
        <td>${r.accuracy.toFixed(0)}%</td>
        <td class="muted">${Math.round(r.raw)}</td>
        <td class="muted">${r.consistency.toFixed(0)}%</td>
        <td class="muted">${r.correct_chars}/${r.incorrect_chars}</td>
        <td class="muted">${escapeHtml(r.mode)} ${escapeHtml(r.mode_value)}</td>
        <td class="muted">${escapeHtml(r.language.replace(/_/g, " "))}</td>
        <td class="tagCell">
          ${r.tags.map((t) => `<span class="tagChip">${escapeHtml(t.name)}</span>`).join("")}
          <button class="textButton" data-tags="${r.id}"
                  aria-label="метки результата" data-balloon-pos="left">${icon("hashtag")}</button>
        </td>
        <td class="muted">${formatDate(r.created_at)}</td>
        <td><button class="textButton" data-expand="${r.id}"
                    aria-label="ход теста по секундам" data-balloon-pos="left">${icon(
                      "chart",
                    )}</button></td>
        <td><button class="textButton danger" data-delete="${r.id}"
                    aria-label="удалить результат" data-balloon-pos="left">${icon("xmark")}</button></td>
      </tr>`;
  }

  async function load(): Promise<void> {
    historyEl.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;
    resetEl.hidden = !anyFilter();

    try {
      const page_ = await api.results(query());
      const total = page_.total;
      rows = page_.rows;

      if (rows.length === 0) {
        historyEl.innerHTML = `<div class="emptyState">${icon("chart")}${
          anyFilter() ? "под фильтры ничего не подошло" : "результатов пока нет"
        }<span class="hint">${
          anyFilter() ? "снимите фильтры" : "пройдите первый тест"
        }</span></div>`;
        pagerEl.hidden = true;
        return;
      }

      historyEl.innerHTML = `
        <table class="table historyTable">
          <thead>
            <tr><th>wpm</th><th>точность</th><th>raw</th><th>ровность</th>
                <th>символы</th><th>режим</th><th>язык</th><th>метки</th><th>дата</th><th></th><th></th></tr>
          </thead>
          <tbody>${rows.map(rowHtml).join("")}</tbody>
        </table>
      `;

      const pages = Math.ceil(total / PAGE_SIZE);
      pagerEl.hidden = pages <= 1;
      if (pages > 1) {
        pagerEl.innerHTML = `
          <button class="button" data-step="-1" ${page === 0 ? "disabled" : ""}>назад</button>
          <span class="sub">${page + 1} из ${pages}</span>
          <button class="button" data-step="1" ${page >= pages - 1 ? "disabled" : ""}>вперёд</button>
          <span class="sub">${total} результатов</span>
        `;
      }
    } catch (error) {
      historyEl.innerHTML = `<div class="errorState">${icon("triangleExclamation")}${escapeHtml(
        error instanceof ApiError ? error.message : "Сервер недоступен",
      )}</div>`;
    }
  }

  filtersEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target.closest("#filterReset")) {
      mode = "";
      language = "";
      tagIds = [];
      sinceEl.value = "";
      untilEl.value = "";
      languageLabel.textContent = "все языки";
      tagLabel.textContent = "все метки";
      filtersEl.querySelectorAll("button[data-mode]").forEach((b, i) => {
        b.classList.toggle("active", i === 0);
      });
      page = 0;
      void load();
      return;
    }

    if (target.closest("#tagFilter")) {
      void openTagPicker(tagIds, (ids) => {
        tagIds = ids;
        tagLabel.textContent = ids.length === 0 ? "все метки" : `меток: ${ids.length}`;
        page = 0;
        void load();
      });
      return;
    }

    if (target.closest("#languageButton")) {
      void openLanguagePicker((chosen) => {
        language = chosen as string;
        languageLabel.textContent = language.replace(/_/g, " ");
        page = 0;
        void load();
      });
      return;
    }

    const button = target.closest<HTMLElement>("button[data-mode]");
    if (!button) return;

    mode = button.dataset["mode"]!;
    filtersEl.querySelectorAll("button[data-mode]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    page = 0;
    void load();
  });

  datesEl.addEventListener("change", () => {
    page = 0;
    void load();
  });

  pagerEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-step]");
    if (!button || button.hasAttribute("disabled")) return;

    page += Number(button.dataset["step"]);
    void load();
  });

  historyEl.addEventListener("click", (event) => {
    const tagButton = (event.target as HTMLElement).closest<HTMLElement>("button[data-tags]");
    if (tagButton) {
      const id = Number(tagButton.dataset["tags"]);
      const row = rows.find((r) => r.id === id);

      void openTagPicker(row?.tags.map((t) => t.id) ?? [], (ids) => {
        void api.setResultTags(id, ids).then(() => load());
      });
      return;
    }

    const expand = (event.target as HTMLElement).closest<HTMLElement>("button[data-expand]");
    if (expand) {
      void toggleSamples(expand);
      return;
    }

    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-delete]");
    if (!button) return;

    // Удаление необратимо, поэтому спрашиваем — но одним вопросом,
    // а не диалогом на всю страницу
    if (!confirm("Удалить этот результат?")) return;

    const id = Number(button.dataset["delete"]);
    void api
      .deleteResult(id)
      .then(() => load())
      .catch(() => {
        button.setAttribute("aria-label", "не удалось удалить");
      });
  });

  /**
   * Развернуть строку и показать ход теста по секундам. Ряды берутся
   * лениво: в общем списке они раздули бы историю ради картинки,
   * которую смотрят у одной строки из двадцати пяти.
   */
  async function toggleSamples(button: HTMLElement): Promise<void> {
    const row = button.closest("tr");
    if (!row) return;

    const next = row.nextElementSibling;
    if (next?.classList.contains("samplesRow")) {
      next.remove();
      button.classList.remove("active");
      return;
    }

    const id = Number(button.dataset["expand"]);
    const columns = row.children.length;

    button.classList.add("active");
    row.insertAdjacentHTML(
      "afterend",
      `<tr class="samplesRow"><td colspan="${columns}">
         <div class="loadingState"><div class="spinner"></div>загрузка</div>
       </td></tr>`,
    );

    const cell = row.nextElementSibling?.querySelector("td");
    if (!cell) return;

    try {
      const [charts, samples] = await Promise.all([import("../ui/charts"), api.resultSamples(id)]);
      if (!cell.isConnected) return;

      cell.innerHTML = charts.renderSparkline(samples.wpm, samples.raw);
    } catch {
      cell.innerHTML = `<p class="error">не удалось загрузить ход теста</p>`;
    }
  }

  void load();
}
