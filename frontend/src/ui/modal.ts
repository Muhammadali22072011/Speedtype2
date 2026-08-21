/**
 * Модалки и уведомления.
 *
 * У monkeytype их три десятка, и все построены на одной основе: затемнение,
 * коробка по центру, esc и клик мимо закрывают. Здесь ровно эта основа плюс
 * три готовых случая, которых нам не хватало: ввод значения, подтверждение
 * и многострочный текст.
 *
 * Классы те же, что у пикеров (`.picker`, `.box`) — чтобы оформление
 * оставалось одним, а не расползалось по двум наборам правил.
 */

import { escapeHtml } from "./format";
import { icon } from "./icons";

interface ModalOptions {
  title: string;
  /** Готовая разметка тела. */
  body: string;
  /** Подпись на кнопке подтверждения. */
  confirmText?: string;
  /** Показывать кнопку отмены. */
  cancel?: boolean;
  /**
   * Что делать при подтверждении. Возврат строки означает ошибку —
   * модалка останется открытой и покажет её.
   */
  onConfirm?: (form: HTMLFormElement) => string | void;
}

function openModal({
  title,
  body,
  confirmText = "готово",
  cancel = true,
  onConfirm,
}: ModalOptions): void {
  const overlay = document.createElement("div");
  overlay.className = "picker modal";
  overlay.innerHTML = `
    <form class="box" novalidate>
      <div class="pickerHead">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="button" data-close aria-label="закрыть"
                data-balloon-pos="left">${icon("xmark")}</button>
      </div>
      <div class="modalBody">${body}</div>
      <p class="error" data-error></p>
      <div class="modalActions">
        ${cancel ? `<button type="button" class="button" data-close>отмена</button>` : ""}
        <button type="submit" class="button active">${escapeHtml(confirmText)}</button>
      </div>
    </form>
  `;

  const form = overlay.querySelector<HTMLFormElement>("form")!;
  const errorEl = overlay.querySelector<HTMLElement>("[data-error]")!;

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Гасим событие: иначе esc долетит до страницы теста и откроет
    // командную строку поверх закрывшейся модалки
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === overlay || target.closest("[data-close]")) close();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const problem = onConfirm?.(form);
    if (typeof problem === "string" && problem !== "") {
      errorEl.textContent = problem;
      return;
    }
    close();
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLElement>("input, textarea")?.focus();
}

/** Спросить число. Пустая строка и мусор не проходят. */
export function askNumber(options: {
  title: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onPick: (value: number) => void;
}): void {
  openModal({
    title: options.title,
    body: `
      <label class="modalLabel">
        <span class="sub">${escapeHtml(options.label)}</span>
        <input class="input" name="value" type="number" inputmode="numeric"
               value="${options.value}" min="${options.min}" max="${options.max}">
      </label>
    `,
    confirmText: "применить",
    onConfirm: (form) => {
      const raw = new FormData(form).get("value");
      const value = Number(raw);

      if (!Number.isFinite(value) || String(raw).trim() === "") return "нужно число";
      if (value < options.min || value > options.max) {
        return `от ${options.min} до ${options.max}`;
      }

      options.onPick(Math.round(value));
    },
  });
}

/** Спросить многострочный текст — для своего текста теста. */
export function askText(options: {
  title: string;
  label: string;
  value: string;
  placeholder?: string;
  onPick: (value: string) => void;
}): void {
  openModal({
    title: options.title,
    body: `
      <label class="modalLabel">
        <span class="sub">${escapeHtml(options.label)}</span>
        <textarea class="input modalText" name="value" rows="8"
                  placeholder="${escapeHtml(options.placeholder ?? "")}"
                  spellcheck="false">${escapeHtml(options.value)}</textarea>
      </label>
    `,
    confirmText: "применить",
    onConfirm: (form) => {
      const value = String(new FormData(form).get("value") ?? "").trim();
      if (value === "") return "текст пустой";
      options.onPick(value);
    },
  });
}

/** Подтверждение необратимого действия. */
export function confirmAction(options: {
  title: string;
  text: string;
  confirmText?: string;
  onConfirm: () => void;
}): void {
  openModal({
    title: options.title,
    body: `<p class="sub">${escapeHtml(options.text)}</p>`,
    confirmText: options.confirmText ?? "да",
    onConfirm: () => options.onConfirm(),
  });
}

// ---------- уведомления ----------

// Уведомления переехали в ui/notify.ts — там единственная реализация,
// с role="status", aria-live и кнопкой закрытия. Здесь была вторая, без
// доступности: пользователь с экранным диктором тост не слышал. Дубль
// снят, чтобы не расходились ни поведение, ни стиль.
