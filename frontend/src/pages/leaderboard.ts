/**
 * Лидерборд: период, режим, язык, страницы и своя строка.
 *
 * Сервер умеет фильтровать по mode / mode_value / language и отдаёт общее
 * число строк заголовком — здесь это наконец используется.
 */

import { api, ApiError, getToken, type LeaderboardRow } from "../api/client";
import type { PageContext } from "../router";
import { escapeHtml, formatDate } from "../ui/format";
import { icon } from "../ui/icons";
import { openLanguagePicker } from "../ui/pickers";

const PERIODS = [
  { key: "all", label: "всё время" },
  { key: "daily", label: "сутки" },
  { key: "weekly", label: "неделя" },
  { key: "monthly", label: "месяц" },
] as const;

/**
 * Вкладки режимов. У monkeytype их ровно две — время 15 и время 60;
 * «все» оставляем своей, без неё периоды «неделя» и «месяц» теряют смысл.
 */
const TABS = [
  { key: "all", label: "все режимы", mode: "", modeValue: "" },
  { key: "time15", label: "время 15", mode: "time", modeValue: "15" },
  { key: "time60", label: "время 60", mode: "time", modeValue: "60" },
] as const;

const PAGE_SIZE = 50;

export async function leaderboardPage({ container }: PageContext): Promise<void> {
  let period: string = PERIODS[0].key;
  let tab: (typeof TABS)[number] = TABS[0];
  let language = "";
  let page = 0;
  /** Имя вошедшего — по нему подсвечиваем строку. Гость его не получит. */
  let myName: string | null = null;

  container.innerHTML = `
    <div class="configBar" id="tabs">
      ${TABS.map(
        (t, i) =>
          `<button class="button${i === 0 ? " active" : ""}" data-tab="${t.key}">${t.label}</button>`,
      ).join("")}
    </div>
    <div class="configBar" id="periods">
      ${PERIODS.map(
        (p, i) =>
          `<button class="button${i === 0 ? " active" : ""}" data-period="${p.key}">${p.label}</button>`,
      ).join("")}
      <button class="button" id="languageButton">${icon("globe")} <span data-language>все языки</span></button>
      <button class="button" id="languageReset" hidden aria-label="все языки">${icon("xmark")}</button>
      <button class="button" id="jumpToMe" hidden>${icon("user")} к себе</button>
    </div>
    <div id="body" class="tableScroll"><div class="loadingState"><div class="spinner"></div>загрузка</div></div>
    <div id="pager" class="pager" hidden></div>
  `;

  const bodyEl = container.querySelector<HTMLElement>("#body")!;
  const pagerEl = container.querySelector<HTMLElement>("#pager")!;
  const tabsEl = container.querySelector<HTMLElement>("#tabs")!;
  const periodsEl = container.querySelector<HTMLElement>("#periods")!;
  const languageLabel = container.querySelector<HTMLElement>("[data-language]")!;
  const jumpEl = container.querySelector<HTMLElement>("#jumpToMe")!;
  const languageResetEl = container.querySelector<HTMLElement>("#languageReset")!;

  function query(): {
    period: string;
    mode?: string;
    modeValue?: string;
    language?: string;
  } {
    return {
      period,
      ...(tab.mode ? { mode: tab.mode, modeValue: tab.modeValue } : {}),
      ...(language ? { language } : {}),
    };
  }

  function rowHtml(row: LeaderboardRow, mine: boolean): string {
    return `
      <tr${mine ? ` class="me" id="myRow"` : ""}>
        <td>${row.rank}</td>
        <td class="playerCell">
          ${
            row.avatar
              ? `<img class="avatar" src="${escapeHtml(row.avatar)}" alt="" loading="lazy">`
              : `<span class="avatar avatarEmpty">${icon("user")}</span>`
          }
          <span>${escapeHtml(row.username)}</span>
        </td>
        <td style="color: var(--main-color)">${Math.round(row.wpm)}</td>
        <td>${row.accuracy.toFixed(0)}%</td>
        <td class="muted">${Math.round(row.raw)}</td>
        <td class="muted">${row.consistency.toFixed(0)}%</td>
        <td class="muted">${escapeHtml(row.mode)} ${escapeHtml(row.mode_value)}</td>
        <td class="muted">${escapeHtml(row.language.replace(/_/g, " "))}</td>
        <td class="muted">${formatDate(row.created_at)}</td>
      </tr>`;
  }

  /** Номера страниц: первые, последние и окно вокруг текущей. */
  function pageNumbers(total: number): number[] {
    const pages = Math.ceil(total / PAGE_SIZE);
    const wanted = new Set<number>([0, pages - 1, page - 1, page, page + 1]);
    return [...wanted].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  }

  function drawPager(total: number): void {
    const pages = Math.ceil(total / PAGE_SIZE);
    pagerEl.hidden = pages <= 1;
    if (pages <= 1) return;

    const numbers = pageNumbers(total);
    pagerEl.innerHTML = `
      <button class="button" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>назад</button>
      ${numbers
        .map((n, i) => {
          const gap = i > 0 && n - numbers[i - 1]! > 1 ? `<span class="sub">…</span>` : "";
          return `${gap}<button class="button${n === page ? " active" : ""}" data-page="${n}">${n + 1}</button>`;
        })
        .join("")}
      <button class="button" data-page="${page + 1}" ${
        page >= pages - 1 ? "disabled" : ""
      }>вперёд</button>
      <span class="sub">${total} игроков</span>
    `;
  }

  async function load(): Promise<void> {
    bodyEl.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;
    pagerEl.hidden = true;

    try {
      // Своё место спрашиваем тем же запросом фильтров — иначе на второй
      // странице непонятно, есть ли ты в таблице вообще
      const [{ rows, total }, self] = await Promise.all([
        api.leaderboard({ ...query(), limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        getToken() ? api.leaderboardMe(query()) : Promise.resolve(null),
      ]);

      myName = self?.row?.username ?? null;
      jumpEl.hidden = self?.rank == null;

      if (rows.length === 0) {
        bodyEl.innerHTML = `<div class="emptyState">${icon(
          "crown",
        )}за этот период результатов нет<span class="hint">пройдите тест — и строка появится</span></div>`;
        return;
      }

      bodyEl.innerHTML = `
        <table class="table leaderboardTable">
          <thead>
            <tr>
              <th>#</th><th>игрок</th><th>wpm</th><th>точность</th>
              <th>raw</th><th>ровность</th><th>режим</th><th>язык</th><th>дата</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => rowHtml(row, row.username === myName)).join("")}
          </tbody>
        </table>
        ${
          self?.rank != null && !rows.some((row) => row.username === myName)
            ? `<table class="table leaderboardTable selfTable">
                 <tbody>${rowHtml(self.row!, true)}</tbody>
               </table>`
            : ""
        }
      `;

      drawPager(total);

      // Кнопка «к себе» ведёт на страницу со своей строкой
      if (self?.rank != null) {
        jumpEl.dataset["page"] = String(Math.floor((self.rank - 1) / PAGE_SIZE));
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Сервер недоступен";
      bodyEl.innerHTML = `<div class="errorState">${icon("triangleExclamation")}${escapeHtml(
        message,
      )}</div>`;
    }
  }

  tabsEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-tab]");
    if (!button) return;

    tab = TABS.find((t) => t.key === button.dataset["tab"]) ?? TABS[0];
    tabsEl.querySelectorAll(".button").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    page = 0;
    void load();
  });

  periodsEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    if (target.closest("#languageReset")) {
      language = "";
      languageLabel.textContent = "все языки";
      languageResetEl.hidden = true;
      page = 0;
      void load();
      return;
    }

    if (target.closest("#languageButton")) {
      void openLanguagePicker((chosen) => {
        language = chosen as string;
        languageLabel.textContent = language.replace(/_/g, " ");
        languageResetEl.hidden = false;
        page = 0;
        void load();
      });
      return;
    }

    if (target.closest("#jumpToMe")) {
      const wanted = Number(jumpEl.dataset["page"] ?? 0);
      if (wanted !== page) {
        page = wanted;
        void load().then(() => {
          document.getElementById("myRow")?.scrollIntoView({ block: "center" });
        });
      } else {
        document.getElementById("myRow")?.scrollIntoView({ block: "center" });
      }
      return;
    }

    const button = target.closest<HTMLElement>("button[data-period]");
    if (!button) return;

    period = button.dataset["period"]!;
    periodsEl.querySelectorAll("button[data-period]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    page = 0;
    void load();
  });

  pagerEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-page]");
    if (!button || button.hasAttribute("disabled")) return;

    page = Number(button.dataset["page"]);
    void load();
  });

  await load();
}
