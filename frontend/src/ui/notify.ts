/**
 * Уведомления в углу экрана.
 *
 * Нужны там, где сейчас ошибка глотается молча: отправка результата,
 * подключение к комнате гонки, сохранение настроек. Показывать её в теле
 * страницы нельзя — человек в этот момент смотрит на слова, а не на список.
 *
 * Оформление — .notification из styles/components.css, там же длительность
 * появления: она берётся из токена, поэтому системная настройка
 * «меньше движения» гасит и её.
 */

import { icon } from "./icons";

export type NotifyKind = "info" | "success" | "error";

const ICONS: Record<NotifyKind, string> = {
  info: "info",
  success: "check",
  error: "triangleExclamation",
};

/** Сколько уведомление висит, если не сказано иначе. Ошибку держим дольше. */
const LIFETIME: Record<NotifyKind, number> = {
  info: 3000,
  success: 3000,
  error: 6000,
};

let host: HTMLElement | null = null;

function container(): HTMLElement {
  if (host && document.body.contains(host)) return host;

  host = document.getElementById("notifications");
  if (!host) {
    host = document.createElement("div");
    host.id = "notifications";
    // Область живёт своей жизнью и объявляет себя: экранный диктор прочитает
    // появившийся текст, не уводя фокус с поля ввода
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Показать уведомление. Возвращает функцию, которая убирает его досрочно.
 *
 * @param text  что случилось — одной строкой, в нижнем регистре, как весь интерфейс
 * @param kind  вид: обычное, удачное, ошибка
 * @param ms    сколько держать; 0 — до щелчка по крестику
 */
export function notify(text: string, kind: NotifyKind = "info", ms?: number): () => void {
  const element = document.createElement("div");
  element.className = `notification ${kind}`;
  element.innerHTML = `
    ${icon(ICONS[kind])}
    <span class="text"></span>
    <button class="close" aria-label="закрыть">${icon("xmark")}</button>
  `;
  // Текст ставим свойством, а не в разметку: он приходит из ответа сервера
  element.querySelector<HTMLElement>(".text")!.textContent = text;

  const remove = (): void => {
    if (timer !== null) clearTimeout(timer);
    element.remove();
  };

  // Закрывается и кнопкой, и кликом по телу. Кнопка — явная и с aria-label,
  // клик по телу — как вели себя прежние тосты со страницы теста: их свели
  // сюда, и поведение сохраняем, чтобы привыкшие к нему не заметили перемены.
  // Оба зовут один remove(), повторный вызов безвреден.
  element.addEventListener("click", remove);
  container().appendChild(element);

  const lifetime = ms ?? LIFETIME[kind];
  let timer: ReturnType<typeof setTimeout> | null =
    lifetime > 0 ? setTimeout(remove, lifetime) : null;

  return remove;
}
