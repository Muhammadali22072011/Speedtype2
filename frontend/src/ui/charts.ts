/**
 * Графики. Рисуем svg руками, без библиотек.
 *
 * Chart.js весит около двухсот килобайт ради одного экрана и ничего не
 * знает про наши переменные тем — его пришлось бы перекрашивать под 187
 * тем вручную. Свой код короче и красится сам: все цвета здесь взяты
 * переменными, ни одного своего значения.
 *
 * Модуль общий: экран результата зовёт график скорости, страница профиля
 * будет звать историю и гистограмму.
 */

import "../styles/charts.css";

import { speedUnitFactor, speedUnitLabel } from "./format";

/** Сколько подписей на оси X показываем, не считая нуля. */
const X_LABELS = 6;

export interface SpeedChartData {
  /** Скорость за каждую секунду. */
  speed: readonly number[];
  /** То же по всем нажатиям, включая ошибочные. */
  raw: readonly number[];
  /** Скорость слова, которое набиралось в эту секунду. */
  burst: readonly number[];
  /** Сколько ошибок пришлось на каждую секунду. */
  errors: readonly number[];
  /** Личный рекорд — горизонтальная черта, если он есть. */
  personalBest?: number | null;
  /** Начинать ось Y с нуля — настройка startGraphsAtZero. */
  fromZero: boolean;
  /**
   * Размер холста в настоящих пикселях. Вызывающий меряет своё место и
   * присылает ширину сюда, а не растягивает готовый svg средствами css.
   *
   * Разница видна сразу: при растягивании viewBox 800×220 на полторы
   * тысячи точек вместе с линиями растёт всё остальное — подписи осей
   * становятся заголовками, крестики ошибок закрывают половину поля,
   * а высота уезжает за отведённый блок и накрывает собой кнопки.
   */
  width?: number;
  height?: number;
}

/** Ряды и их вид. Порядок тот же, что в легенде. */
const SERIES = [
  { key: "speed", label: "скорость", color: "var(--main-color)", kind: "line" },
  { key: "raw", label: "raw", color: "var(--sub-color)", kind: "dashed" },
  { key: "burst", label: "по словам", color: "var(--text-color)", kind: "thin" },
  { key: "errors", label: "ошибки", color: "var(--error-color)", kind: "cross" },
  { key: "pb", label: "рекорд", color: "var(--text-color)", kind: "mark" },
  { key: "grid", label: "сетка", color: "var(--sub-alt-color)", kind: "mark" },
] as const;

/** Запасной размер: когда мерить нечего — например, в тестах. */
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 220;
const PAD_LEFT = 44;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

/**
 * График скорости на экране результата: скорость, raw, скорость по словам,
 * крестики ошибок и черта рекорда. Ряды переключаются легендой.
 */
export function renderSpeedChart(data: SpeedChartData): string {
  const factor = speedUnitFactor();
  const unit = speedUnitLabel();

  // Ниже 320 точек ось перестаёт читаться, выше 260 график из полосы
  // превращается в стену — оба края обрезаем здесь, а не у вызывающего
  const WIDTH = Math.max(320, Math.round(data.width ?? DEFAULT_WIDTH));
  const HEIGHT = Math.min(260, Math.max(140, Math.round(data.height ?? DEFAULT_HEIGHT)));
  const RIGHT = WIDTH - PAD_RIGHT;
  const BASE = HEIGHT - PAD_BOTTOM;

  // Значения приводим к выбранной единице сразу: ось, подписи и черта
  // рекорда должны быть в одном масштабе с крупным числом наверху
  const speed = data.speed.map((v) => v * factor);
  const raw = data.raw.map((v) => v * factor);
  const burst = data.burst.map((v) => v * factor);
  const best = data.personalBest == null ? null : data.personalBest * factor;

  const seconds = Math.max(speed.length, raw.length, burst.length);
  if (seconds < 2) {
    return `<p class="sub center">тест слишком короткий для графика</p>`;
  }

  const values = [...speed, ...raw, ...burst, ...(best === null ? [] : [best])];
  const top = niceCeil(Math.max(...values, 1));
  const bottom = data.fromZero ? 0 : Math.max(0, niceFloor(Math.min(...values)));
  const span = top - bottom || 1;

  const x = (i: number): number =>
    PAD_LEFT + (i * (WIDTH - PAD_LEFT - PAD_RIGHT)) / Math.max(1, seconds - 1);
  const y = (v: number): number =>
    BASE - ((v - bottom) / span) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const maxErrors = Math.max(...data.errors, 1);

  /**
   * Данные для подсказки при наведении. Складываем прямо в разметку, а не
   * в замыкание: renderSpeedChart возвращает строку, bindChart потом
   * находит её в DOM — общего замыкания у них нет. Значения уже в нужной
   * единице и округлены, чтобы атрибут не распухал.
   */
  const hover = {
    unit,
    pl: PAD_LEFT,
    pr: PAD_RIGHT,
    n: seconds,
    speed: speed.map((v) => Math.round(v)),
    raw: raw.map((v) => Math.round(v)),
    burst: burst.map((v) => Math.round(v)),
    err: [...data.errors],
  };
  const hoverAttr = JSON.stringify(hover).replace(/"/g, "&quot;");

  return `
    <div class="chartBox" data-chart data-hover="${hoverAttr}">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img"
           aria-label="скорость по секундам, ${unit}">
        <g data-series="grid">${grid(top, bottom, span, y, RIGHT)}</g>
        <g data-series="grid">${xAxis(seconds, x, HEIGHT)}</g>

        ${
          best === null
            ? ""
            : `<g data-series="pb">
                 <line class="pbLine" x1="${PAD_LEFT}" y1="${y(best)}"
                       x2="${RIGHT}" y2="${y(best)}"/>
                 <text class="pbLabel" x="${RIGHT}" y="${y(best) - 4}"
                       text-anchor="end">рекорд ${Math.round(best)}</text>
               </g>`
        }

        <g data-series="burst">
          <polyline class="burstLine" points="${points(burst, x, y)}"/>
        </g>
        <g data-series="raw">
          <polyline class="rawLine" points="${points(raw, x, y)}"/>
        </g>
        <g data-series="speed">
          <polygon class="speedArea" points="${area(speed, x, y, BASE)}"/>
          <polyline class="speedLine" points="${points(speed, x, y)}"/>
        </g>
        <g data-series="errors">${crosses(data.errors, maxErrors, x, BASE)}</g>

        <line class="chartCursor" x1="0" y1="${PAD_TOP}" x2="0" y2="${BASE}" hidden/>
      </svg>

      <div class="chartTip" hidden></div>

      <div class="chartLegend">
        ${SERIES.map(
          (s) =>
            `<button class="chartToggle on" data-toggle="${s.key}"
                     style="--dot: ${s.color}">${s.label}</button>`,
        ).join("")}
      </div>
    </div>`;
}

interface HoverData {
  unit: string;
  pl: number;
  pr: number;
  n: number;
  speed: number[];
  raw: number[];
  burst: number[];
  err: number[];
}

/**
 * Легенда и подсказка при наведении. Вешается один раз на контейнер:
 * график внутри могут перерисовать (смена ширины), поэтому слушатели
 * живут на внешнем узле, а данные каждый раз читаются из DOM заново.
 */
export function bindChart(root: HTMLElement): void {
  // Переключение рядов легендой
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-toggle]");
    if (!button) return;

    const box = button.closest<HTMLElement>("[data-chart]");
    if (!box) return;

    const key = button.dataset["toggle"]!;
    const on = button.classList.toggle("on");

    box.querySelectorAll<SVGElement>(`[data-series="${key}"]`).forEach((group) => {
      group.style.display = on ? "" : "none";
    });
  });

  const hide = (): void => {
    const box = root.querySelector<HTMLElement>("[data-chart]");
    if (!box) return;
    box.querySelector<HTMLElement>(".chartTip")?.setAttribute("hidden", "");
    box.querySelector<SVGElement>(".chartCursor")?.setAttribute("hidden", "");
  };

  root.addEventListener("mousemove", (event) => {
    const box = (event.target as HTMLElement).closest<HTMLElement>("[data-chart]");
    const svg = box?.querySelector<SVGSVGElement>("svg");
    const cursor = box?.querySelector<SVGLineElement>(".chartCursor");
    const tip = box?.querySelector<HTMLElement>(".chartTip");
    if (!box || !svg || !cursor || !tip || !box.dataset["hover"]) return;

    const data = JSON.parse(box.dataset["hover"]) as HoverData;
    const view = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || data.n < 2) return;

    // Курсор мыши → координата svg (график может быть ужат max-width),
    // затем → ближайшая секунда
    const svgX = ((event.clientX - rect.left) / rect.width) * view.width;
    const inner = view.width - data.pl - data.pr;
    const ratio = (svgX - data.pl) / (inner || 1);
    const idx = Math.min(data.n - 1, Math.max(0, Math.round(ratio * (data.n - 1))));

    const cx = data.pl + (idx * inner) / Math.max(1, data.n - 1);
    cursor.setAttribute("x1", String(cx));
    cursor.setAttribute("x2", String(cx));
    cursor.removeAttribute("hidden");

    tip.innerHTML = tipRows(data, idx);
    tip.removeAttribute("hidden");

    // Подсказку ставим над курсором и не даём уехать за края блока
    const half = tip.offsetWidth / 2;
    const left = Math.min(box.clientWidth - half, Math.max(half, event.clientX - rect.left));
    tip.style.left = `${left}px`;
    tip.style.top = `${event.clientY - box.getBoundingClientRect().top}px`;
  });

  root.addEventListener("mouseleave", hide);
  // Уход курсора на легенду или подписи — тоже повод убрать подсказку
  root.addEventListener("mouseout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) hide();
    else if (!(event.target as HTMLElement).closest("svg")) hide();
  });
}

/** Строки подсказки: секунда, скорость, raw, по словам и ошибки, если были. */
function tipRows(data: HoverData, idx: number): string {
  const row = (label: string, value: string, color: string): string =>
    `<div class="row"><span class="k" style="--dot:${color}">${label}</span><span class="v">${value}</span></div>`;

  const rows = [`<div class="sec">${idx + 1} секунда</div>`];
  if (idx < data.speed.length) rows.push(row("скорость", `${data.speed[idx]} ${data.unit}`, "var(--main-color)"));
  if (idx < data.raw.length) rows.push(row("raw", `${data.raw[idx]} ${data.unit}`, "var(--sub-color)"));
  if (idx < data.burst.length && data.burst[idx]! > 0)
    rows.push(row("по словам", `${data.burst[idx]} ${data.unit}`, "var(--text-color)"));
  if (idx < data.err.length && data.err[idx]! > 0)
    rows.push(row("ошибки", String(data.err[idx]), "var(--error-color)"));

  return rows.join("");
}

// ---------- части ----------

function points(values: readonly number[], x: (i: number) => number, y: (v: number) => number): string {
  return values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

function area(
  values: readonly number[],
  x: (i: number) => number,
  y: (v: number) => number,
  base: number,
): string {
  if (values.length === 0) return "";
  return `${x(0)},${base} ${points(values, x, y)} ${x(values.length - 1)},${base}`;
}

/** Пять линий сетки с подписями значений. */
function grid(
  top: number,
  bottom: number,
  span: number,
  y: (v: number) => number,
  right: number,
): string {
  let out = "";
  for (let i = 0; i <= 4; i += 1) {
    const value = top - (i * span) / 4;
    const gy = y(value);
    out +=
      `<line class="gridLine" x1="${PAD_LEFT}" y1="${gy.toFixed(1)}" x2="${right}" y2="${gy.toFixed(1)}"/>` +
      `<text class="axisLabel" x="${PAD_LEFT - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end">${Math.round(
        value,
      )}</text>`;
  }
  return out + `<!-- нижняя граница ${Math.round(bottom)} -->`;
}

/**
 * Подписи секунд снизу. Раньше их не было вовсе — по графику нельзя было
 * понять, на какой секунде случился провал.
 */
function xAxis(seconds: number, x: (i: number) => number, height: number): string {
  const step = Math.max(1, Math.round(seconds / X_LABELS));
  let out = "";

  for (let i = 0; i < seconds; i += step) {
    out += `<text class="axisLabel" x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${
      i + 1
    }</text>`;
  }
  return out;
}

/** Крестики ошибок: чем больше ошибок в секунду, тем крупнее крестик. */
function crosses(
  errors: readonly number[],
  max: number,
  x: (i: number) => number,
  base: number,
): string {
  let out = "";

  errors.forEach((count, i) => {
    if (count <= 0) return;

    const size = 3 + (count / max) * 4;
    const cx = x(i);
    // Крестики стоят над самой осью: так они не мешают линиям, но видно,
    // на какой секунде ошибались
    const cy = base - 8;
    out +=
      `<line class="errorMark" x1="${(cx - size).toFixed(1)}" y1="${(cy - size).toFixed(1)}"
             x2="${(cx + size).toFixed(1)}" y2="${(cy + size).toFixed(1)}"/>` +
      `<line class="errorMark" x1="${(cx + size).toFixed(1)}" y1="${(cy - size).toFixed(1)}"
             x2="${(cx - size).toFixed(1)}" y2="${(cy + size).toFixed(1)}"/>` +
      `<title>${count} ошибок на ${i + 1} секунде</title>`;
  });

  return out;
}

/** Округление вверх до круглого числа — чтобы ось не подписывалась 87.3. */
function niceCeil(value: number): number {
  const step = value > 200 ? 50 : value > 100 ? 25 : value > 40 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function niceFloor(value: number): number {
  const step = value > 200 ? 50 : value > 100 ? 25 : value > 40 ? 10 : 5;
  return Math.floor(value / step) * step;
}

// ---------- страница профиля ----------

export interface ActivityDay {
  date: string;
  tests: number;
  time: number;
  best_wpm: number;
}

/** Пороги теплоты: 0 — день без тестов, дальше по их числу. */
const HEAT_STEPS = [3, 6, 10];

/**
 * Тепловая карта активности: год по неделям, как на гитхабе и у них.
 *
 * Сервер присылает только дни, в которые что-то было; пустые клетки
 * достраиваем здесь — иначе за год пришлось бы возить 365 нулей.
 */
export function renderHeatmap(days: readonly ActivityDay[], today: Date): string {
  const byDate = new Map(days.map((d) => [d.date, d]));

  // Год заканчивается сегодня и начинается за 52 недели до ближайшего
  // воскресенья — так последняя колонка всегда полная
  const end = startOfDay(today);
  const start = new Date(end);
  start.setDate(start.getDate() - 363 - end.getDay());

  const weeks: string[] = [];
  const months: string[] = [];
  const cursor = new Date(start);
  let week = 0;
  let lastMonth = -1;

  while (cursor <= end) {
    const cells: string[] = [];

    for (let day = 0; day < 7; day += 1) {
      if (cursor > end) break;

      const key = isoDate(cursor);
      const found = byDate.get(key);
      const level = found ? heatLevel(found.tests) : 0;

      cells.push(
        `<rect class="heatCell heat-${level}" x="0" y="${day * 13}" width="11" height="11"
               rx="2" tabindex="-1"
               aria-label="${humanDate(cursor)}: ${
                 found ? `${found.tests} тестов, лучший ${Math.round(found.best_wpm)}` : "тестов нет"
               }" data-balloon-pos="up"/>`,
      );

      // Название месяца ставим над той неделей, где он начался
      if (cursor.getDate() <= 7 && cursor.getMonth() !== lastMonth) {
        lastMonth = cursor.getMonth();
        months.push(
          `<text class="heatMonth" x="${week * 13}" y="9">${MONTHS[lastMonth] ?? ""}</text>`,
        );
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push(`<g transform="translate(${week * 13}, 16)">${cells.join("")}</g>`);
    week += 1;
  }

  const total = days.reduce((sum, d) => sum + d.tests, 0);

  return `
    <div class="heatmapBox">
      <svg viewBox="0 0 ${Math.max(1, week * 13)} 108" role="img"
           aria-label="активность за год: ${total} тестов">
        ${months.join("")}
        ${weeks.join("")}
      </svg>
      <div class="heatmapFoot sub">
        <span>${total} тестов за год</span>
        <span class="heatScale">
          меньше
          ${[0, 1, 2, 3, 4].map((level) => `<i class="heat-${level}"></i>`).join("")}
          больше
        </span>
      </div>
    </div>`;
}

function heatLevel(tests: number): number {
  if (tests <= 0) return 0;

  let level = 1;
  for (const step of HEAT_STEPS) if (tests >= step) level += 1;
  return Math.min(4, level);
}

const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function humanDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""}`;
}

export interface HistogramBucket {
  wpm: number;
  tests: number;
}

/**
 * Распределение результатов по скорости. Показывает не рекорд, а то,
 * где человек живёт обычно, — по одному только рекорду этого не видно.
 *
 * Ширину, как и график скорости, принимаем в настоящих пикселях: иначе
 * узкая карточка профиля растягивала бы условные 800×180 своими силами,
 * и подписи со столбиками распухали бы вместе с ней.
 */
export function renderHistogram(
  source: readonly HistogramBucket[],
  step: number,
  boxWidth?: number,
): string {
  if (source.length === 0) {
    return `<p class="sub center">пока нечего распределять</p>`;
  }

  // Сервер присылает только непустые диапазоны. Если их не достроить,
  // столбик «30» встанет вплотную к «10», и провал между ними исчезнет —
  // а распределение как раз про то, где провалы
  const known = new Map(source.map((b) => [b.wpm, b.tests]));
  const first = Math.min(...known.keys());
  const last = Math.max(...known.keys());

  const buckets: HistogramBucket[] = [];
  for (let wpm = first; wpm <= last; wpm += step) {
    buckets.push({ wpm, tests: known.get(wpm) ?? 0 });
  }

  const width = Math.max(320, Math.round(boxWidth ?? 800));
  const height = 180;
  const padLeft = 36;
  const padBottom = 24;
  const padTop = 12;

  const max = Math.max(...buckets.map((b) => b.tests), 1);
  const slot = (width - padLeft) / buckets.length;

  const bars = buckets
    .map((bucket, index) => {
      const barHeight = ((height - padTop - padBottom) * bucket.tests) / max;
      const x = padLeft + index * slot;
      const y = height - padBottom - barHeight;

      return `
        <g aria-label="${bucket.wpm}–${bucket.wpm + step} wpm: ${bucket.tests} тестов"
           data-balloon-pos="up">
          <rect class="histBar" x="${(x + 2).toFixed(1)}" y="${y.toFixed(1)}"
                width="${Math.max(1, slot - 4).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2"/>
          <text class="axisLabel" x="${(x + slot / 2).toFixed(1)}" y="${height - 8}"
                text-anchor="middle">${bucket.wpm}</text>
        </g>`;
    })
    .join("");

  return `
    <div class="chartBox" data-histogram>
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
           aria-label="распределение результатов по скорости">
        <line class="gridLine" x1="${padLeft}" y1="${height - padBottom}"
              x2="${width}" y2="${height - padBottom}"/>
        <text class="axisLabel" x="${padLeft - 8}" y="${padTop + 8}" text-anchor="end">${max}</text>
        ${bars}
      </svg>
    </div>`;
}

/**
 * Мини-график строки истории: две линии без осей и подписей.
 *
 * Здесь намеренно нет ни сетки, ни чисел: это не график, а форма — по
 * ней видно, ровно шёл темп или рывками, и только. За подробностями
 * человек идёт на экран результата.
 */
export function renderSparkline(wpm: readonly number[], raw: readonly number[]): string {
  if (wpm.length < 2) {
    return `<p class="sub">для этого результата рядов не сохранилось</p>`;
  }

  const width = 320;
  const height = 48;
  const all = [...wpm, ...raw];
  const top = Math.max(...all, 1);
  const bottom = Math.min(...all, top);
  const span = top - bottom || 1;

  const line = (values: readonly number[]): string =>
    values
      .map((v, i) => {
        const x = (i * width) / Math.max(1, values.length - 1);
        const y = height - ((v - bottom) / span) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
         role="img" aria-label="скорость по секундам">
      ${raw.length > 1 ? `<polyline class="rawLine" points="${line(raw)}"/>` : ""}
      <polyline class="speedLine" points="${line(wpm)}"/>
    </svg>`;
}
