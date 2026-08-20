/**
 * Живой стайлгайд: все токены и все состояния каждого компонента на текущей
 * теме. Служебная страница, из индекса закрыта (backend/app/core/seo.py).
 *
 * Зачем она. Дизайн-система без места, где её видно целиком, расползается
 * за месяц: кто-то заводит второй оттенок серого, кто-то забывает состояние
 * фокуса, и заметить это можно только наткнувшись. Здесь всё лежит рядом,
 * и сломанное состояние видно сразу. У monkeytype такой страницы нет.
 *
 * Значения не переписаны руками: они читаются из настоящих css-переменных
 * через getComputedStyle. Правка в tokens.css видна здесь на перезагрузке,
 * а расхождение между документацией и кодом невозможно по устройству.
 */

import "../styles/styleguide.css";

import type { PageContext } from "../router";
import { contrastRatio, level } from "../ui/contrast";
import { icon } from "../ui/icons";

// ---------- что показываем ----------

/** Цвет слоя 2: имя, из чего выведен, где стоит и на каком фоне его читать. */
interface ColorToken {
  name: string;
  from: string;
  role: string;
  /** На каком фоне считать контраст. null — сам является фоном. */
  on?: string;
}

const THEME_COLORS = [
  "--bg-color",
  "--main-color",
  "--caret-color",
  "--sub-color",
  "--sub-alt-color",
  "--text-color",
  "--error-color",
  "--error-extra-color",
  "--colorful-error-color",
  "--colorful-error-extra-color",
];

const SURFACES: ColorToken[] = [
  { name: "--surface-page", from: "--bg-color", role: "фон страницы" },
  { name: "--surface-raised", from: "--sub-alt-color", role: "кнопка, карточка, клавиша" },
  { name: "--surface-sunken", from: "--sub-alt-color", role: "поле ввода" },
  { name: "--surface-accent", from: "--main-color", role: "активная кнопка, заполнение полосы" },
  { name: "--surface-muted", from: "--sub-color", role: "клавиша kbd, подсказка-облачко" },
  { name: "--surface-inverted", from: "--text-color", role: "нажатая клавиша на клавиатуре" },
  { name: "--surface-danger", from: "--error-color", role: "опасное действие" },
  { name: "--surface-scrim", from: "чёрный 60%", role: "затемнение под модалкой" },
];

const TEXT: ColorToken[] = [
  { name: "--fg-main", from: "--text-color", role: "основной текст", on: "--surface-page" },
  { name: "--fg-muted", from: "--sub-color", role: "ненабранные буквы, крупные подписи", on: "--surface-page" },
  {
    name: "--fg-muted-readable",
    from: "color-mix(--sub-color 45%, --text-color)",
    role: "мелкий служебный текст",
    on: "--surface-page",
  },
  { name: "--fg-accent", from: "--main-color", role: "цифры, активный пункт", on: "--surface-page" },
  { name: "--fg-on-solid", from: "--bg-color", role: "текст поверх заливки", on: "--surface-accent" },
  { name: "--fg-error", from: "--error-color", role: "ошибки", on: "--surface-page" },
  { name: "--fg-error-extra", from: "--error-extra-color", role: "лишние буквы", on: "--surface-page" },
  { name: "--fg-error-vivid", from: "--colorful-error-color", role: "ошибка в ярком режиме", on: "--surface-page" },
];

const BORDERS: ColorToken[] = [
  { name: "--border-color", from: "--sub-alt-color", role: "обычная граница", on: "--surface-page" },
  { name: "--border-strong-color", from: "--sub-color", role: "заметная граница", on: "--surface-page" },
  { name: "--border-accent-color", from: "--main-color", role: "граница акцента", on: "--surface-page" },
  { name: "--border-error-color", from: "--error-color", role: "граница ошибки", on: "--surface-page" },
  { name: "--caret-fg", from: "--caret-color", role: "каретка", on: "--surface-page" },
  { name: "--caret-pace-fg", from: "--sub-color", role: "догоняющая каретка", on: "--surface-page" },
];

const SPACES = [
  "--space-2",
  "--space-4",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
  "--space-16",
  "--space-20",
  "--space-24",
  "--space-32",
  "--space-40",
  "--space-48",
  "--space-64",
];

const FONT_SIZES: Array<[string, string]> = [
  ["--font-size-4xs", "пометка в списке выбора"],
  ["--font-size-3xs", "подпись логотипа"],
  ["--font-size-2xs", "футер, подсказки клавиш"],
  ["--font-size-xs", "панель режимов"],
  ["--font-size-sm", "мелкий текст результата"],
  ["--font-size-md", "таблицы, поля ввода"],
  ["--font-size-base", "база — 16px, как у monkeytype"],
  ["--font-size-lg", "заголовок помельче"],
  ["--font-size-xl", "заголовок раздела"],
  ["--font-size-2xl", "слова теста и логотип"],
  ["--font-size-3xl", "крупные показатели по ходу теста"],
];

const DURATIONS: Array<[string, string]> = [
  ["--duration-base", "базовая длительность monkeytype"],
  ["--duration-fast", "половинная — цвет кнопок и меню"],
  ["--caret-duration-slow", "каретка, режим slow"],
  ["--caret-duration-medium", "каретка, режим medium"],
  ["--caret-duration-fast", "каретка, режим fast"],
  ["--scroll-duration", "прокрутка строк"],
  ["--tape-duration", "движение ленты"],
  ["--progress-duration", "заполнение полосы"],
  ["--caret-blink-duration", "мигание каретки"],
  ["--spinner-duration", "оборот крутилки"],
];

const LAYERS: Array<[string, string]> = [
  ["--z-under", "под содержимым: блочная каретка"],
  ["--z-base", "содержимое"],
  ["--z-caret", "каретка"],
  ["--z-overlay", "подсказка фокуса поверх слов"],
  ["--z-sticky", "липкая шапка"],
  ["--z-tooltip", "подсказка-облачко"],
  ["--z-modal", "модалка и командная строка"],
  ["--z-notification", "уведомление — выше модалки"],
];

const BREAKPOINTS: Array<[string, string]> = [
  ["--bp-2xs", "самый узкий экран"],
  ["--bp-xs", "шапка и футер прижимаются"],
  ["--bp-sm", "клавиатура и подпись логотипа прячутся"],
  ["--bp-md", "настройки в одну колонку"],
  ["--bp-lg", "поля страницы ужимаются"],
  ["--bp-xl", "объявлена, правил нет"],
  ["--bp-2xl", "объявлена, правил нет"],
];

// ---------- чтение настоящих значений ----------

/**
 * Во что превращается токен на самом деле.
 *
 * getComputedStyle на :root отдаёт подставленное значение, но не вычисленное:
 * color-mix так и остаётся строкой color-mix(...). Поэтому цвет читаем
 * с настоящего элемента — браузер отдаёт его уже посчитанным.
 */
function readColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}

function readVar(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

// ---------- разметка ----------

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function colorRows(probe: HTMLElement, tokens: ColorToken[]): string {
  return tokens
    .map((t) => {
      const value = readColor(probe, t.name);
      const on = t.on ? readColor(probe, t.on) : null;
      const ratio = on ? contrastRatio(value, on) : 0;
      const mark = on ? `${ratio.toFixed(2)} <span class="badge">${level(ratio)}</span>` : "—";

      return `
        <tr>
          <td><span class="sgSwatch" style="background: var(${t.name})"></span></td>
          <td><code>${t.name}</code></td>
          <td class="sub">${escape(t.from)}</td>
          <td class="sub">${t.role}</td>
          <td class="numeric sub">${escape(value)}</td>
          <td class="numeric">${mark}</td>
        </tr>`;
    })
    .join("");
}

function colorTable(probe: HTMLElement, title: string, tokens: ColorToken[]): string {
  return `
    <h3 class="sgSubtitle">${title}</h3>
    <div class="tableScroll">
      <table class="table sgTable">
        <thead>
          <tr>
            <th></th><th>токен</th><th>выведен из</th><th>где стоит</th>
            <th class="numeric">значение</th><th class="numeric">контраст</th>
          </tr>
        </thead>
        <tbody>${colorRows(probe, tokens)}</tbody>
      </table>
    </div>`;
}

/** Один компонент во всех шести состояниях. */
function states(title: string, note: string, cells: Array<[string, string]>): string {
  return `
    <div class="sgComponent">
      <h3 class="sgSubtitle">${title}</h3>
      <p class="sub sgNote">${note}</p>
      <div class="sgStates">
        ${cells
          .map(
            ([label, html]) => `
          <div class="sgState">
            <div class="sgStateLabel sub">${label}</div>
            <div class="sgStateBody">${html}</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>`;
}

export function styleguidePage({ container }: PageContext): () => void {
  // Невидимый элемент, с которого читаются посчитанные цвета
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;opacity:0;pointer-events:none";
  container.appendChild(probe);

  const draw = (): void => {
    const width = window.innerWidth;
    const steps = BREAKPOINTS.map(([token]) => [token, parseInt(readVar(token), 10)] as const);
    // Активная ступень — самая узкая из тех, что шире окна; если окно шире
    // всех, значит раскладка полная
    const active = steps.find(([, px]) => width < px)?.[0] ?? "полная раскладка";

    container.innerHTML = `
      <div class="textPage" id="styleguide">
        <div class="section">
          <h1 class="title">${icon("palette")} стайлгайд</h1>
          <p>
            Всё, из чего собирается интерфейс, на текущей теме
            <b>${escape(document.documentElement.dataset["theme"] ?? "—")}</b>.
            Значения прочитаны из css прямо сейчас, а не переписаны руками:
            расходиться с кодом этой странице нечем.
          </p>
          <p class="sub">
            Окно ${width}px, действует ступень <code>${active}</code>.
            Служебная страница: в поиске её нет.
          </p>
        </div>

        <div class="section">
          <h2 class="title">${icon("palette")} слой 1 — тема</h2>
          <p>
            Десять переменных monkeytype. Их имена — внешний контракт: на них
            держатся 187 тем, 52 файла с css и 15 файлов funbox. Ни одного
            нового имени в этом слое быть не должно.
          </p>
          <div class="sgSwatches">
            ${THEME_COLORS.map(
              (name) => `
              <div class="sgChip">
                <span class="sgSwatch big" style="background: var(${name})"></span>
                <code>${name.replace("--", "").replace("-color", "")}</code>
                <span class="sub">${escape(readVar(name) || "—")}</span>
              </div>`,
            ).join("")}
          </div>
        </div>

        <div class="section">
          <h2 class="title">${icon("alignLeft")} слой 2 — семантика</h2>
          <p>
            Смыслы, выведенные из десяти цветов. Компоненты берут цвет только
            отсюда. Столбец «контраст» считается по WCAG от настоящих значений —
            если тема не проходит, это видно здесь же, а не в отчёте.
          </p>
          ${colorTable(probe, "поверхности", SURFACES)}
          ${colorTable(probe, "текст", TEXT)}
          ${colorTable(probe, "границы и каретки", BORDERS)}
        </div>

        <div class="section">
          <h2 class="title">${icon("alignLeft")} пространство</h2>
          <p>
            Число в имени — пиксели при базовых 16px. Из этой шкалы берутся
            все отступы и зазоры; 32 — поля страницы и расстояние между блоками,
            как у monkeytype.
          </p>
          <div class="sgScale">
            ${SPACES.map(
              (name) => `
              <div class="sgScaleRow">
                <code>${name}</code>
                <span class="sgBar" style="width: var(${name})"></span>
                <span class="sub">${readVar(name)}</span>
              </div>`,
            ).join("")}
          </div>
        </div>

        <div class="section">
          <h2 class="title">${icon("font")} типографика</h2>
          <div class="sgScale">
            ${FONT_SIZES.map(
              ([name, role]) => `
              <div class="sgTypeRow">
                <span style="font-size: var(${name})">Съешь ещё этих мягких булок</span>
                <code>${name}</code>
                <span class="sub">${readVar(name)} · ${role}</span>
              </div>`,
            ).join("")}
          </div>
          <p class="sub sgNote">
            Начертания: ${["--font-weight-normal", "--font-weight-medium", "--font-weight-semibold", "--font-weight-bold"]
              .map((w) => `<span style="font-weight: var(${w})">${readVar(w)}</span>`)
              .join(" · ")}
          </p>
        </div>

        <div class="section">
          <h2 class="title">${icon("alignLeft")} скругления и границы</h2>
          <div class="sgSwatches">
            ${["--radius-sm", "--radius-md", "--radius-pill", "--radius-circle"]
              .map(
                (name) => `
              <div class="sgChip">
                <span class="sgRadius" style="border-radius: var(${name})"></span>
                <code>${name}</code>
                <span class="sub">${readVar(name)}</span>
              </div>`,
              )
              .join("")}
            <div class="sgChip">
              <span class="sgRadius" style="border: var(--border); border-radius: var(--radius-md)"></span>
              <code>--border</code>
              <span class="sub">${readVar("--border-width")}</span>
            </div>
            <div class="sgChip">
              <span class="sgRadius" style="outline: var(--focus-ring); outline-offset: var(--focus-ring-offset)"></span>
              <code>--focus-ring</code>
              <span class="sub">${readVar("--focus-ring-width")}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <h2 class="title">${icon("clock")} движение</h2>
          <p>
            У monkeytype ровно две длительности: базовая и половинная. Остальное —
            числа каретки из их кода. Наведите на полосу, чтобы увидеть ход.
          </p>
          <div class="sgScale">
            ${DURATIONS.map(
              ([name, role]) => `
              <div class="sgScaleRow">
                <code>${name}</code>
                <span class="sgMotion" style="transition-duration: var(${name})"></span>
                <span class="sub">${readVar(name)} · ${role}</span>
              </div>`,
            ).join("")}
          </div>
          <p class="sub sgNote">
            При системной настройке «меньше движения» все эти значения
            становятся нулевыми одной правкой в tokens.css — кроме крутилки,
            её только замедляем.
          </p>
        </div>

        <div class="section">
          <h2 class="title">${icon("alignLeft")} слои и брейкпоинты</h2>
          <div class="sgTwo">
            <div>
              <h3 class="sgSubtitle">z-index</h3>
              <table class="table sgTable">
                <tbody>
                  ${LAYERS.map(
                    ([name, role]) =>
                      `<tr><td><code>${name}</code></td><td class="numeric">${readVar(name)}</td><td class="sub">${role}</td></tr>`,
                  ).join("")}
                </tbody>
              </table>
            </div>
            <div>
              <h3 class="sgSubtitle">ступени</h3>
              <table class="table sgTable">
                <tbody>
                  ${BREAKPOINTS.map(([name, role]) => {
                    const px = parseInt(readVar(name), 10);
                    const now = width < px;
                    return `<tr class="${now ? "sgActive" : ""}"><td><code>${name}</code></td><td class="numeric">${readVar(name)}</td><td class="sub">${role}</td></tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="section">
          <h2 class="title">${icon("gamepad")} компоненты</h2>
          <p>
            Шесть состояний у каждого: обычное, наведение, нажатие, фокус
            с клавиатуры, отключено, активное. Наведение, нажатие и фокус
            показаны принудительными классами <code>is-hover</code>,
            <code>is-press</code>, <code>is-focus</code> — они перечислены
            в css рядом с настоящими псевдоклассами, так что разъехаться
            с ними не могут.
          </p>

          ${states("кнопка", "основное действие: сохранить, начать, применить", [
            ["обычное", `<button class="button">${icon("save")} сохранить</button>`],
            ["наведение", `<button class="button is-hover">${icon("save")} сохранить</button>`],
            ["нажатие", `<button class="button is-press">${icon("save")} сохранить</button>`],
            ["фокус", `<button class="button is-focus">${icon("save")} сохранить</button>`],
            ["отключено", `<button class="button" disabled>${icon("save")} сохранить</button>`],
            ["активное", `<button class="button active">${icon("save")} сохранить</button>`],
          ])}

          ${states("текстовая кнопка", "подпись без фона: футер, панель режимов. Класс .textButton ждут три темы", [
            ["обычное", `<button class="textButton">${icon("bolt")} команды</button>`],
            ["наведение", `<button class="textButton is-hover">${icon("bolt")} команды</button>`],
            ["фокус", `<button class="textButton is-focus">${icon("bolt")} команды</button>`],
            ["отключено", `<button class="textButton" disabled>${icon("bolt")} команды</button>`],
            ["активное", `<button class="textButton active">${icon("bolt")} команды</button>`],
          ])}

          ${states("иконочная и опасная", "у иконочной обязателен aria-label — иначе её нечем назвать", [
            ["иконочная", `<button class="button iconButton" aria-label="начать заново" data-balloon-pos="up">${icon("rotate")}</button>`],
            ["наведение", `<button class="button iconButton is-hover" aria-label="начать заново">${icon("rotate")}</button>`],
            ["опасная", `<button class="button danger">${icon("eraser")} удалить</button>`],
            ["опасная под курсором", `<button class="button danger is-hover">${icon("eraser")} удалить</button>`],
          ])}

          ${states("пункт меню", "читает --themable-button-text: 26 тем из 52 красят пункты меню именно им", [
            ["обычное", `<span data-nav-item="test">${icon("keyboard")}</span>`],
            ["наведение", `<span data-nav-item="test" class="is-hover">${icon("keyboard")}</span>`],
            ["фокус", `<span data-nav-item="test" class="is-focus">${icon("keyboard")}</span>`],
            ["активное", `<span data-nav-item="test" class="active">${icon("keyboard")}</span>`],
          ])}

          ${states("поле ввода", "логин, пароль, число в настройках", [
            ["обычное", `<input class="input" placeholder="имя пользователя">`],
            ["фокус", `<input class="input is-focus" placeholder="имя пользователя">`],
            ["ошибка", `<input class="input" aria-invalid="true" value="занято">`],
            ["отключено", `<input class="input" value="нельзя менять" disabled>`],
          ])}

          ${states("значок и клавиша", "значок — пометка у строки; kbd ждут две темы", [
            ["обычный", `<span class="badge">гость</span>`],
            ["акцентный", `<span class="badge accent">${icon("crown")} рекорд</span>`],
            ["опасный", `<span class="badge danger">не сохранено</span>`],
            ["клавиша", `<kbd>ctrl</kbd> <kbd>shift</kbd> <kbd>p</kbd>`],
          ])}

          ${states("полоса прогресса", "таймер теста и дорожка гонки — одна полоса на оба места", [
            ["пусто", `<div class="progressBar" style="width:8rem"><div class="fill" style="width:0"></div></div>`],
            ["половина", `<div class="progressBar" style="width:8rem"><div class="fill" style="width:50%"></div></div>`],
            ["почти", `<div class="progressBar" style="width:8rem"><div class="fill" style="width:90%"></div></div>`],
            ["время на исходе", `<div class="progressBar danger" style="width:8rem"><div class="fill" style="width:95%"></div></div>`],
          ])}

          ${states("состояния списка", "пусто, грузится, сломалось — раньше на месте пустого списка не было ничего", [
            ["пусто", `<div class="emptyState">${icon("chart")}<div>результатов пока нет</div><div class="hint">пройдите первый тест</div></div>`],
            ["грузится", `<div class="loadingState"><div class="spinner"></div></div>`],
            ["ошибка", `<div class="errorState">${icon("triangleExclamation")}<div>не удалось загрузить</div><div class="hint">проверьте соединение</div></div>`],
          ])}

          ${states("карточка и подсказка", "карточка — блок с заголовком; подсказка живёт на aria-label", [
            ["карточка", `<div class="card" style="width:12rem"><div class="cardTitle">рекорд</div><div>117 wpm</div><div class="sub">96% точности</div></div>`],
            ["подсказка", `<button class="button iconButton" aria-label="наведите на меня" data-balloon-pos="up">${icon("info")}</button>`],
          ])}

          <h3 class="sgSubtitle">уведомление</h3>
          <p class="sub sgNote">
            Угол экрана, поверх модалок. Живёт три секунды, ошибка — шесть.
          </p>
          <div class="sgStates">
            <div class="sgState">
              <div class="sgStateBody"><button class="button" data-notify="info">обычное</button></div>
            </div>
            <div class="sgState">
              <div class="sgStateBody"><button class="button" data-notify="success">удачное</button></div>
            </div>
            <div class="sgState">
              <div class="sgStateBody"><button class="button" data-notify="error">ошибка</button></div>
            </div>
          </div>

          <h3 class="sgSubtitle">таблица</h3>
          <div class="tableScroll">
            <table class="table">
              <thead>
                <tr><th>место</th><th>кто</th><th class="numeric">wpm</th><th class="numeric">точность</th></tr>
              </thead>
              <tbody>
                <tr><td>1</td><td>гость</td><td class="numeric">117</td><td class="numeric">98%</td></tr>
                <tr><td>2</td><td>кто-то ещё</td><td class="numeric">96</td><td class="numeric">94%</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    container.appendChild(probe);

    // Уведомления показываем по щелчку: держать их на экране постоянно
    // незачем, а посмотреть на живое — единственный способ проверить въезд
    container.querySelectorAll<HTMLElement>("[data-notify]").forEach((button) => {
      button.addEventListener("click", () => {
        void import("../ui/notify").then((m) => {
          const kind = button.dataset["notify"] as "info" | "success" | "error";
          m.notify(
            kind === "error" ? "не удалось сохранить результат" : "так выглядит уведомление",
            kind,
          );
        });
      });
    });
  };

  draw();

  // Ступень зависит от ширины окна — перерисовываем, чтобы страница
  // показывала действующую, а не ту, что была при заходе
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onResize = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(draw, 150);
  };
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    if (timer !== null) clearTimeout(timer);
  };
}
