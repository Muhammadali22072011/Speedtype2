/**
 * Страница настроек. Разметка целиком строится из config-spec.ts —
 * добавить настройку значит дописать строку в схему, здесь править нечего.
 */

import type { PageContext } from "../router";
import {
  GROUP_LABELS,
  SETTINGS,
  settingsInGroup,
  type SettingGroup,
  type SettingSpec,
} from "../state/config-spec";
import { getDefaults, getSettings, resetSettings, updateSettings } from "../state/settings";
import { escapeHtml } from "../ui/format";
import { icon } from "../ui/icons";
import {
  openFontPicker,
  openFunboxPicker,
  openLanguagePicker,
  openLayoutPicker,
  openThemePicker,
} from "../ui/pickers";

const GROUP_ICONS: Record<SettingGroup, string> = {
  test: "font",
  input: "bolt",
  caret: "quote",
  stats: "chart",
  look: "palette",
  keymap: "keyboard",
  sound: "at",
  ui: "gear",
};

export function settingsPage({ container }: PageContext): () => void {
  const groups = Object.keys(GROUP_LABELS) as SettingGroup[];

  function value(spec: SettingSpec): string {
    const raw = (getSettings() as unknown as Record<string, unknown>)[spec.key];
    if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "выключено";
    if (typeof raw === "boolean") return raw ? "включено" : "выключено";
    return String(raw ?? "");
  }

  function control(spec: SettingSpec): string {
    const raw = (getSettings() as unknown as Record<string, unknown>)[spec.key];

    switch (spec.kind) {
      case "toggle":
        return `<button class="button setToggle${raw ? " active" : ""}" data-key="${spec.key}">
                  ${raw ? icon("check") : icon("xmark")} ${raw ? "вкл" : "выкл"}
                </button>`;

      case "select":
        return `<div class="setValues">${(spec.values ?? [])
          .map(
            (v) =>
              `<button class="button setValue${String(raw) === v ? " active" : ""}"
                       data-key="${spec.key}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`,
          )
          .join("")}</div>`;

      case "number":
        return `<input class="input setNumber" type="number" data-key="${spec.key}"
                       value="${escapeHtml(String(raw ?? 0))}"
                       min="${spec.min ?? 0}" max="${spec.max ?? 100}" step="${spec.step ?? 1}">`;

      case "text":
        return `<input class="input setText" type="text" data-key="${spec.key}"
                       value="${escapeHtml(String(raw ?? ""))}" placeholder="пусто">`;

      case "picker":
        return `<button class="button setPicker" data-key="${spec.key}"
                        data-picker="${spec.picker}">
                  ${icon("arrowRight")} ${escapeHtml(value(spec))}
                </button>`;
    }
  }

  function draw(): void {
    const done = SETTINGS.filter((s) => s.done).length;

    container.innerHTML = `
      <div class="settingsHead">
        <h2>${icon("gear")} настройки</h2>
        <span class="sub">${done} из ${SETTINGS.length} работают</span>
        <button class="button" id="reset">${icon("rotate")} сбросить всё</button>
      </div>

      <div class="settingsNav">
        ${groups
          .map(
            (g) =>
              `<a class="button" href="#group-${g}">${icon(GROUP_ICONS[g])} ${escapeHtml(
                GROUP_LABELS[g],
              )}</a>`,
          )
          .join("")}
      </div>

      ${groups
        .map((group) => {
          const items = settingsInGroup(group);
          return `
          <section class="settingsGroup" id="group-${group}">
            <h3>${icon(GROUP_ICONS[group])} ${escapeHtml(GROUP_LABELS[group])}
              <em>${items.length}</em></h3>
            <div class="settingsList">
              ${items
                .map(
                  (spec) => `
                <div class="setting${spec.done ? "" : " pending"}">
                  <div class="setLabel">
                    <span class="setName">${escapeHtml(spec.label)}</span>
                    <span class="setHint">${escapeHtml(spec.hint)}</span>
                    ${spec.done ? "" : `<span class="setPending">пока не работает</span>`}
                  </div>
                  <div class="setControl">${control(spec)}</div>
                </div>`,
                )
                .join("")}
            </div>
          </section>`;
        })
        .join("")}
    `;
  }

  // Обработчики именованные и снимаются при уходе со страницы: контейнер
  // общий для всех маршрутов, и накопленные слушатели удваивали клик —
  // переключатель мгновенно возвращался в исходное состояние.
  const onClick = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>("button");
    if (!button) return;

    if (button.id === "reset") {
      resetSettings();
      draw();
      return;
    }

    const key = button.dataset["key"];
    if (!key) return;

    if (button.classList.contains("setToggle")) {
      const raw = (getSettings() as unknown as Record<string, unknown>)[key];
      updateSettings({ [key]: !raw } as never);
      draw();
      return;
    }

    if (button.classList.contains("setValue")) {
      const raw = button.dataset["value"]!;
      const previous = (getDefaults() as unknown as Record<string, unknown>)[key];
      // Число сохраняем числом: в схеме варианты записаны строками
      const parsed = typeof previous === "number" ? Number(raw) : raw;
      updateSettings({ [key]: parsed } as never);
      draw();
      return;
    }

    if (button.classList.contains("setPicker")) {
      const picker = button.dataset["picker"];
      const apply = (chosen: string | string[]): void => {
        updateSettings({ [key]: chosen } as never);
        draw();
      };

      if (picker === "theme") await openThemePicker(apply);
      else if (picker === "language") await openLanguagePicker(apply);
      else if (picker === "layout") await openLayoutPicker(apply);
      else if (picker === "font") openFontPicker(apply);
      else if (picker === "funbox") openFunboxPicker(apply);
    }
  };

  const onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset["key"];
    if (!key) return;

    if (input.classList.contains("setNumber")) {
      updateSettings({ [key]: Number(input.value) } as never);
    } else if (input.classList.contains("setText")) {
      updateSettings({ [key]: input.value } as never);
    }
  };

  container.addEventListener("click", onClick);
  container.addEventListener("change", onChange);

  draw();

  return () => {
    container.removeEventListener("click", onClick);
    container.removeEventListener("change", onChange);
  };
}
