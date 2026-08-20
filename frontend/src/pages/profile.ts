/** Профиль: сводная статистика и история тестов. */

import { api, ApiError, getToken } from "../api/client";
import { navigate, type PageContext } from "../router";
import { escapeHtml, formatDate, formatDuration } from "../ui/format";
import { icon } from "../ui/icons";

export async function profilePage({ container }: PageContext): Promise<void> {
  if (!getToken()) {
    navigate("/login", true);
    return;
  }

  container.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;

  try {
    const [user, stats] = await Promise.all([api.me(), api.myStats()]);

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
      </div>

      <div class="results">
        <div>
          <div class="stat-label">тестов</div>
          <div class="stat-value small">${stats.tests}</div>
        </div>
        <div>
          <div class="stat-label">средний wpm</div>
          <div class="stat-value small">${stats.avg_wpm.toFixed(0)}</div>
        </div>
        <div>
          <div class="stat-label">рекорд</div>
          <div class="stat-value">${stats.best_wpm.toFixed(0)}</div>
        </div>
        <div>
          <div class="stat-label">точность</div>
          <div class="stat-value small">${stats.avg_accuracy.toFixed(0)}%</div>
        </div>
        <div>
          <div class="stat-label">за клавиатурой</div>
          <div class="stat-value small">${formatDuration(stats.time_typing)}</div>
        </div>
      </div>

      <div id="history" class="tableScroll"><div class="loadingState"><div class="spinner"></div>загрузка</div></div>
      <div id="historyPager" class="pager" hidden></div>
    `;
    await drawHistory(container, stats.tests);
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

/** Сколько результатов на странице истории. */
const HISTORY_PAGE = 25;

/**
 * История с постраничной выдачей: сервер давно принимает offset, а клиент
 * жёстко просил первые 25 и делал вид, что других нет.
 */
async function drawHistory(container: HTMLElement, total: number): Promise<void> {
  const historyEl = container.querySelector<HTMLElement>("#history")!;
  const pagerEl = container.querySelector<HTMLElement>("#historyPager")!;
  let page = 0;

  async function load(): Promise<void> {
    historyEl.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;
    const results = await api.myResults(HISTORY_PAGE, page * HISTORY_PAGE);

    if (results.length === 0) {
      historyEl.innerHTML = `<div class="emptyState">${icon(
        "chart",
      )}результатов пока нет<span class="hint">пройдите первый тест</span></div>`;
      pagerEl.hidden = true;
      return;
    }

    historyEl.innerHTML = `
      <table class="table historyTable">
        <thead>
          <tr><th>wpm</th><th>точность</th><th>raw</th><th>ровность</th>
              <th>символы</th><th>режим</th><th>язык</th><th>дата</th></tr>
        </thead>
        <tbody>
          ${results
            .map(
              (r) => `
            <tr>
              <td style="color: var(--main-color)">${Math.round(r.wpm)}</td>
              <td>${r.accuracy.toFixed(0)}%</td>
              <td class="muted">${Math.round(r.raw)}</td>
              <td class="muted">${r.consistency.toFixed(0)}%</td>
              <td class="muted">${r.correct_chars}/${r.incorrect_chars}</td>
              <td class="muted">${escapeHtml(r.mode)} ${escapeHtml(r.mode_value)}</td>
              <td class="muted">${escapeHtml(r.language.replace(/_/g, " "))}</td>
              <td class="muted">${formatDate(r.created_at)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    `;

    const pages = Math.ceil(total / HISTORY_PAGE);
    pagerEl.hidden = pages <= 1;
    if (pages <= 1) return;

    pagerEl.innerHTML = `
      <button class="button" data-step="-1" ${page === 0 ? "disabled" : ""}>назад</button>
      <span class="sub">${page + 1} из ${pages}</span>
      <button class="button" data-step="1" ${page >= pages - 1 ? "disabled" : ""}>вперёд</button>
    `;
  }

  pagerEl.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-step]");
    if (!button || button.hasAttribute("disabled")) return;

    page += Number(button.dataset["step"]);
    void load();
  });

  await load();
}
