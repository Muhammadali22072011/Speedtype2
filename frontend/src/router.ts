/** Роутер на history API. Страница — функция, рисующая себя в контейнер. */

export interface PageContext {
  container: HTMLElement;
  params: URLSearchParams;
}

/** Страница может вернуть функцию очистки — её вызовут при уходе. */
export type Page = (ctx: PageContext) => void | (() => void) | Promise<void | (() => void)>;

const routes = new Map<string, Page>();
let container: HTMLElement | null = null;
let cleanup: (() => void) | void = undefined;

interface RouteMeta {
  title: string;
  description: string;
}

/**
 * Заголовки страниц приходят с бэкенда — там же, где они подставляются
 * в <head>. Второй список на клиенте держать нельзя: разъедется.
 *
 * В проде список инлайном в html, запроса не требует. В dev страницу
 * раздаёт Vite, инлайна нет — спрашиваем бэкенд через прокси.
 */
let routeMeta: Record<string, RouteMeta> | null = readInlineMeta();
let metaRequest: Promise<void> | null = null;

function readInlineMeta(): Record<string, RouteMeta> | null {
  const script = document.getElementById("seoRoutes");
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as Record<string, RouteMeta>;
  } catch {
    return null;
  }
}

function ensureMeta(): Promise<void> {
  if (routeMeta) return Promise.resolve();
  metaRequest ??= fetch("/api/seo/routes")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      routeMeta = data as Record<string, RouteMeta> | null;
    })
    // Заголовок — не то, ради чего стоит ронять страницу
    .catch(() => undefined);
  return metaRequest;
}

function applyMeta(pathname: string): void {
  const meta = routeMeta?.[pathname] ?? routeMeta?.["/404"];
  if (!meta) return;

  document.title = meta.title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);

  // Канонический адрес авторитетен серверный — этот только чтобы DOM
  // не противоречил сам себе после перехода внутри SPA
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) canonical.href = new URL(pathname, canonical.href).href;
}

/** Подписка на отрисовку страницы — футеру нужно знать, где мы. */
const renderListeners = new Set<(pathname: string) => void>();

export function onRender(listener: (pathname: string) => void): () => void {
  renderListeners.add(listener);
  return () => renderListeners.delete(listener);
}

export function registerRoute(path: string, page: Page): void {
  routes.set(path, page);
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  void render();
}

export async function render(): Promise<void> {
  if (!container) return;

  if (typeof cleanup === "function") cleanup();
  cleanup = undefined;

  const url = new URL(window.location.href);
  const page = routes.get(url.pathname) ?? routes.get("/404");
  if (!page) return;

  // Заголовок не должен задерживать отрисовку. В проде список уже здесь,
  // в dev проставим его, когда придёт ответ.
  if (routeMeta) applyMeta(url.pathname);
  else void ensureMeta().then(() => applyMeta(window.location.pathname));

  container.innerHTML = "";
  cleanup = await page({ container, params: url.searchParams });

  // Пункты меню помечены [data-nav-item] — как в monkeytype, на этих же
  // атрибутах держатся файлы тем. Раньше здесь искался .nav-link, которого
  // в разметке нет, и активный пункт не подсвечивался никогда.
  document.querySelectorAll<HTMLElement>("[data-nav-item]").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === url.pathname);
  });

  // Класс страницы нужен и темам (.pageSettings, .pageAccount, .pageAbout),
  // и funbox space_balls, который наклоняет .page
  const name = url.pathname === "/" ? "test" : url.pathname.slice(1);
  container.className = `page page${name.charAt(0).toUpperCase()}${name.slice(1)}`;

  for (const listener of renderListeners) listener(url.pathname);
}

export function startRouter(target: HTMLElement): void {
  container = target;

  // Перехватываем клики по внутренним ссылкам, чтобы не перезагружать страницу
  document.addEventListener("click", (event) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/") || anchor.hasAttribute("target")) return;

    event.preventDefault();
    navigate(href);
  });

  window.addEventListener("popstate", () => void render());
  void render();
}
