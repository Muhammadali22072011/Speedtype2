// Слой семантических токенов идёт первым: из него берут значения оба
// следующих файла. Сами цвета темы объявлены в index.html и переписываются
// тегом <style id="themeColors"> — см. state/themes.ts.
import "./styles/tokens.css";
import "./styles/monkeytype.css";
import "./styles/modes.css";
// Общие компоненты и их состояния идут последними: при равном весе
// селекторов выигрывает файл, подключённый ниже
import "./styles/components.css";

import { api, ApiError, getToken, onAuthChange, setToken } from "./api/client";
import { installCommandlineHotkey, openCommandline } from "./ui/commandline";
import { testPage } from "./pages/test";
import { navigate, onRender, registerRoute, render, startRouter } from "./router";
import { getSettings, onSettingsChange, updateSettings } from "./state/settings";
import {
  applyCachedTheme,
  applyTheme,
  applyThemeByName,
  customTheme,
  onSystemThemeChange,
  systemPrefersLight,
} from "./state/themes";
import { icon } from "./ui/icons";
import { openCustomThemePicker, openThemePicker } from "./ui/pickers";

/**
 * Ссылка на исходники — обязательство GPL-3.0: проект использует код и
 * данные monkeytype, значит исходники должны быть доступны из интерфейса,
 * а не только из файла в репозитории.
 */
const GITHUB_URL = "https://github.com/Muhammadali22072011/Speedtype2";

/** Версия одна на проект, источник — package.json, подставляет vite. */
const VERSION = __APP_VERSION__;

const root = document.querySelector<HTMLElement>("#app")!;

root.innerHTML = `
  <header data-ui-element="header">
    <!-- Без aria-label: у ссылки есть видимый текст «speedtype», и он же
         служит доступным именем. Подпись «На главную» его не содержала,
         а это расхождение имени с текстом — WCAG 2.5.3. -->
    <a href="/" data-ui-element="logo">
      ${icon("logo")}
      <span data-ui-element="logoText">speedtype</span>
      <span data-ui-element="logoSubtext">тренажёр печати</span>
    </a>
    <nav id="nav"></nav>
  </header>
  <main id="view"><div id="page"></div></main>

  <!-- Подсказки клавиш живут над футером и по центру, как в monkeytype:
       раньше они лежали под тестом и уезжали вместе с ним. Заполняет их
       страница теста, на остальных страницах блок пуст. -->
  <div id="testHint"></div>

  <footer>
    <button id="openCommands" class="textButton">${icon("bolt")} команды</button>
    <span class="sub">ctrl shift p</span>
    <a class="textButton" href="/about">${icon("info")} о проекте</a>
    <a class="textButton" href="${GITHUB_URL}" target="_blank" rel="noopener">
      ${icon("github")} github
    </a>
    <span class="right">
      <a href="/guide">как научиться</a>
      <a href="/faq">вопросы</a>
      <a href="/settings">настройки</a>
      <a href="/race">онлайн</a>
      <!-- Индикатор темы: клик открывает список тем, shift+клик — свою тему -->
      <button id="themeIndicator" class="textButton"
              aria-label="сменить тему, shift — своя тема" data-balloon-pos="up">
        ${icon("palette")} <span data-theme-name></span>
      </button>
      <a class="textButton" id="versionIndicator" href="${GITHUB_URL}/releases"
         target="_blank" rel="noopener" aria-label="история версий" data-balloon-pos="up">
        ${icon("codeBranch")} ${VERSION}
      </a>
    </span>
  </footer>

  <!-- Наверх: на странице теста скрыта, прокрутки там нет -->
  <button class="scrollToTopButton" hidden aria-label="наверх" data-balloon-pos="left">
    ${icon("arrowUp")}
  </button>
`;

root.querySelector<HTMLElement>("#openCommands")?.addEventListener("click", openCommandline);
installCommandlineHotkey();

// ---------- индикатор темы в футере ----------

const themeNameEl = root.querySelector<HTMLElement>("[data-theme-name]")!;

function renderThemeName(): void {
  themeNameEl.textContent = currentThemeName().replace(/_/g, " ");
}

root.querySelector<HTMLElement>("#themeIndicator")?.addEventListener("click", (event) => {
  // Shift открывает свою тему — там же, где её правят
  if ((event as MouseEvent).shiftKey) {
    openCustomThemePicker(() => undefined);
    return;
  }
  void openThemePicker((chosen) => updateSettings({ theme: chosen as string }));
});

// ---------- кнопка «наверх» ----------

const scrollButton = root.querySelector<HTMLElement>(".scrollToTopButton")!;

function updateScrollButton(): void {
  // На тесте её нет: прокрутки там не бывает, а кнопка лезет на клавиатуру
  const onTest = window.location.pathname === "/";
  scrollButton.hidden = onTest || window.scrollY < 100;
}

scrollButton.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("scroll", updateScrollButton, { passive: true });
onRender(updateScrollButton);

const navEl = root.querySelector<HTMLElement>("#nav")!;

function renderNav(): void {
  const authed = getToken() !== null;

  navEl.innerHTML = `
    <a data-nav-item="test" href="/" aria-label="тест" data-balloon-pos="down">${icon("keyboard")}</a>
    <button data-nav-item="race" id="onlineBtn" aria-label="онлайн" data-balloon-pos="down">${icon("users")}</button>
    <a data-nav-item="leaderboards" href="/leaderboard" aria-label="лидерборд" data-balloon-pos="down">${icon("crown")}</a>
    <a data-nav-item="about" href="/about" aria-label="о проекте" data-balloon-pos="down">${icon("info")}</a>
    <a data-nav-item="settings" href="/settings" aria-label="настройки" data-balloon-pos="down">${icon("gear")}</a>
    ${
      authed
        ? `<a data-nav-item="account" href="/profile" aria-label="профиль" data-balloon-pos="down">${icon("user")}</a>
           <button data-nav-item="logout" id="logout" aria-label="выйти" data-balloon-pos="down">${icon("signOut")}</button>`
        : `<a data-nav-item="login" href="/login" aria-label="войти" data-balloon-pos="down">${icon("signIn")}</a>
           <a data-nav-item="register" href="/register" aria-label="регистрация" data-balloon-pos="down">${icon("userPlus")}</a>`
    }
  `;

  // Онлайн — не отдельная страница, а панель поверх главной. Клик по
  // пункту навигации открывает компактный вход (создать/войти), а не уводит
  // на /race: сама комната по-прежнему живёт по /race?code=… и делится ссылкой.
  navEl.querySelector<HTMLElement>("#onlineBtn")?.addEventListener("click", openRacePanel);

  navEl.querySelector<HTMLElement>("#logout")?.addEventListener("click", () => {
    setToken(null);
    renderNav();
    navigate("/");
  });
}

/**
 * Вход в онлайн-гонку панелью поверх главной, а не отдельной страницей.
 * Оформление берём у модалок (.picker/.box) — панель не занимает места
 * в обычном виде теста и всплывает только по клику. Сама комната остаётся
 * маршрутом /race?code=…: в неё заходят по ссылке, которой делятся с друзьями.
 */
function openRacePanel(): void {
  // Две панели разом не открываем — вторая молча ляжет поверх первой
  if (document.querySelector(".racePanel")) return;

  const overlay = document.createElement("div");
  overlay.className = "picker modal racePanel";
  overlay.innerHTML = `
    <div class="box" role="dialog" aria-label="онлайн-гонка">
      <div class="pickerHead">
        <h2>${icon("users")} онлайн-гонка</h2>
        <button type="button" class="button" data-close aria-label="закрыть"
                data-balloon-pos="left">${icon("xmark")}</button>
      </div>
      <div class="modalBody raceEntry">
        <button class="button raceEntryCreate" data-create>${icon("flag")} создать комнату</button>
        <p class="sub raceEntryOr">или войдите по коду</p>
        <input class="input raceEntryCode" data-code placeholder="код комнаты"
               maxlength="5" autocomplete="off" aria-label="код комнаты">
        <button class="button" data-join>${icon("arrowRight")} войти</button>
      </div>
      <p class="error" data-error></p>
    </div>
  `;

  const errorEl = overlay.querySelector<HTMLElement>("[data-error]")!;
  const codeEl = overlay.querySelector<HTMLInputElement>("[data-code]")!;

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Гасим esc, иначе он долетит до страницы теста и откроет там командную
    // строку поверх уже закрывшейся панели
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function go(code: string): void {
    close();
    navigate(`/race?code=${code}`);
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === overlay || target.closest("[data-close]")) close();
  });

  overlay.querySelector<HTMLElement>("[data-create]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const s = getSettings();
    try {
      const room = await api.createRoom(s.language, s.wordsValue, s.punctuation, s.numbers);
      go(room.code);
    } catch (error) {
      button.disabled = false;
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
    go(value);
  };

  overlay.querySelector<HTMLElement>("[data-join]")?.addEventListener("click", join);
  codeEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") join();
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  codeEl.focus();
}

// Страница теста нужна сразу, поэтому её импорт статический. Остальные
// подгружаются при первом заходе на маршрут: до этой правки главная везла
// с собой код гонок, настроек, профиля и авторизации — 35 КБ из 80 КБ,
// которые на ней ни разу не выполняются.
registerRoute("/", testPage);

registerRoute("/about", (ctx) => import("./pages/about").then((m) => m.aboutPage(ctx)));
registerRoute("/race", (ctx) => import("./pages/race").then((m) => m.racePage(ctx)));
registerRoute("/leaderboard", (ctx) =>
  import("./pages/leaderboard").then((m) => m.leaderboardPage(ctx)),
);
registerRoute("/profile", (ctx) => import("./pages/profile").then((m) => m.profilePage(ctx)));
registerRoute("/account", (ctx) => import("./pages/account").then((m) => m.accountPage(ctx)));
registerRoute("/settings", (ctx) => import("./pages/settings").then((m) => m.settingsPage(ctx)));

// Текстовые страницы: их задача — привести человека из поиска и довести
// до тренажёра. Грузятся лениво, как и остальные.
registerRoute("/guide", (ctx) => import("./pages/guide").then((m) => m.guidePage(ctx)));
registerRoute("/norms", (ctx) => import("./pages/norms").then((m) => m.normsPage(ctx)));
registerRoute("/faq", (ctx) => import("./pages/faq").then((m) => m.faqPage(ctx)));
registerRoute("/russian", (ctx) => import("./pages/russian").then((m) => m.russianPage(ctx)));
registerRoute("/uzbek", (ctx) => import("./pages/uzbek").then((m) => m.uzbekPage(ctx)));

// Стайлгайд: все токены и все состояния компонентов на текущей теме.
// Служебная страница, из поиска закрыта в backend/app/core/seo.py
registerRoute("/styleguide", (ctx) =>
  import("./pages/styleguide").then((m) => m.styleguidePage(ctx)),
);

registerRoute("/login", (ctx) => import("./pages/auth").then((m) => m.loginPage(ctx)));
registerRoute("/register", (ctx) => import("./pages/auth").then((m) => m.registerPage(ctx)));

registerRoute("/404", ({ container }) => {
  container.innerHTML = `
    <div style="text-align:center; padding:4rem 0">
      <div style="font-size:4rem" class="main">404</div>
      <p class="sub">такой страницы нет</p>
      <p style="margin-top:1rem"><a href="/" class="button">на главную</a></p>
    </div>
  `;
});

// Цвета выбранной темы ставим синхронно из кэша, а список из 187 тем
// (62 КБ) догружаем следом. Раньше здесь стоял .finally(), и первая
// отрисовка ждала этот запрос целиком — а вместе с ней и запрос слов,
// который начинался только после него.
//
// Роутер рисует не в <main>, а во вложенный #page: файлы тем и funbox
// целятся в `main .page`, поэтому контейнер страницы должен быть внутри main.
// Своя тема лежит прямо в настройках — её ставим сразу, без кэша и сети
if (getSettings().customTheme) applyTheme(customTheme(getSettings().customThemeColors));
else applyCachedTheme(getSettings().theme);
renderNav();
startRouter(root.querySelector<HTMLElement>("#page")!);

/**
 * Какую тему показывать прямо сейчас. С включённым «тема по системе»
 * выбор идёт между themeLight и themeDark, иначе берётся theme.
 */
function currentThemeName(): string {
  const s = getSettings();
  if (s.customTheme) return "своя тема";
  if (!s.autoSwitchTheme) return s.theme;
  return systemPrefersLight() ? s.themeLight : s.themeDark;
}

/**
 * Применить то, что должно стоять сейчас. Своя тема идёт мимо списка:
 * её цвета лежат в настройках, а не на сервере.
 */
function applyCurrentTheme(): void {
  const s = getSettings();
  if (s.customTheme) {
    applyTheme(customTheme(s.customThemeColors));
    renderThemeName();
    return;
  }

  void applyThemeByName(currentThemeName()).then(renderThemeName);
}

applyCurrentTheme();

// Смена темы применяется сразу, откуда бы её ни поменяли —
// со страницы настроек, из командной строки или пикера
const THEME_KEYS = [
  "theme",
  "themeLight",
  "themeDark",
  "autoSwitchTheme",
  "customTheme",
  "customThemeColors",
];

onSettingsChange((_, changed) => {
  if (changed.some((key) => THEME_KEYS.includes(key))) applyCurrentTheme();
});

// Система переключилась между светлой и тёмной — идём следом,
// если человек об этом попросил
onSystemThemeChange(() => {
  if (getSettings().autoSwitchTheme) applyCurrentTheme();
});

// Вход и выход меняют состав меню. Подписка на токен, а не на popstate:
// после входа страница меняется через pushState, а он popstate не порождает,
// и раньше в шапке так и оставались «войти» и «регистрация».
onAuthChange(renderNav);

export { render };
