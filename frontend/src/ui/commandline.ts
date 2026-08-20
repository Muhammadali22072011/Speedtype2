/**
 * Командная строка — ctrl+shift+p, как в monkeytype.
 *
 * Список команд собирается из config-spec.ts: каждая настройка сама
 * становится командой, вручную дописаны только переходы по страницам.
 */

import { navigate } from "../router";
import { SETTINGS, type SettingSpec } from "../state/config-spec";
import { getDefaults, getSettings, resetSettings, updateSettings } from "../state/settings";
import { pickRandomTheme } from "../state/themes";
import { escapeHtml } from "./format";
import { icon } from "./icons";
import {
  openCustomThemePicker,
  openFontPicker,
  openFunboxPicker,
  openLanguagePicker,
  openLayoutPicker,
  openThemePicker,
} from "./pickers";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  run?: () => void | Promise<void>;
  children?: () => Command[] | Promise<Command[]>;
}

let overlay: HTMLElement | null = null;
let restartHook: (() => void) | null = null;

export function setRestartHook(hook: (() => void) | null): void {
  restartHook = hook;
}

function applyAndMaybeRestart(spec: SettingSpec, patch: Record<string, unknown>): void {
  updateSettings(patch as never);
  if (spec.restart) restartHook?.();
}

function currentValue(key: string): string {
  const raw = (getSettings() as unknown as Record<string, unknown>)[key];
  if (Array.isArray(raw)) return raw.length ? raw.join(", ") : "выкл";
  if (typeof raw === "boolean") return raw ? "вкл" : "выкл";
  return String(raw ?? "");
}

/** Одна настройка превращается в одну команду. */
function commandFor(spec: SettingSpec): Command {
  // Значок ставим только у нереализованных: exactOptionalPropertyTypes
  // не позволяет присвоить undefined необязательному полю
  const base = {
    id: `set:${spec.key}`,
    hint: currentValue(spec.key),
    ...(spec.done ? {} : { icon: "xmark" }),
  };

  if (spec.kind === "toggle") {
    const on = getSettings()[spec.key as keyof ReturnType<typeof getSettings>];
    return {
      ...base,
      label: `${on ? "выключить" : "включить"}: ${spec.label}`,
      run: () => applyAndMaybeRestart(spec, { [spec.key]: !on }),
    };
  }

  if (spec.kind === "picker") {
    return {
      ...base,
      label: spec.label,
      run: async () => {
        const apply = (chosen: string | string[]): void =>
          applyAndMaybeRestart(spec, { [spec.key]: chosen });

        if (spec.picker === "custom") openCustomThemePicker(apply);
        else if (spec.picker === "theme") await openThemePicker(apply);
        else if (spec.picker === "language") await openLanguagePicker(apply);
        else if (spec.picker === "layout") await openLayoutPicker(apply);
        else if (spec.picker === "font") openFontPicker(apply);
        else if (spec.picker === "funbox") openFunboxPicker(apply);
      },
    };
  }

  if (spec.kind === "select") {
    return {
      ...base,
      label: spec.label,
      children: () =>
        (spec.values ?? []).map((value) => ({
          id: `set:${spec.key}:${value}`,
          label: value,
          run: () => {
            const previous = (getDefaults() as unknown as Record<string, unknown>)[spec.key];
            // Число сохраняем числом: в схеме варианты записаны строками
            const parsed = typeof previous === "number" ? Number(value) : value;
            applyAndMaybeRestart(spec, { [spec.key]: parsed });
          },
        })),
    };
  }

  // number и text правятся на странице настроек
  return {
    ...base,
    label: spec.label,
    run: () => navigate("/settings"),
  };
}

/**
 * Плоский список: каждое значение select становится отдельной командой.
 * Так устроен режим singleListCommandLine — искать «слепой режим вкл»
 * быстрее, чем заходить в подсписок.
 */
function flatCommandsFor(spec: SettingSpec): Command[] {
  if (spec.kind !== "select" || !spec.values) return [commandFor(spec)];

  const current = String(
    (getSettings() as unknown as Record<string, unknown>)[spec.key] ?? "",
  );

  return spec.values.map((value) => ({
    id: `set:${spec.key}:${value}`,
    label: `${spec.label}: ${value}`,
    ...(value === current ? { hint: "сейчас" } : {}),
    ...(spec.done ? {} : { icon: "xmark" }),
    run: () => {
      const previous = (getDefaults() as unknown as Record<string, unknown>)[spec.key];
      const parsed = typeof previous === "number" ? Number(value) : value;
      applyAndMaybeRestart(spec, { [spec.key]: parsed });
    },
  }));
}

function rootCommands(): Command[] {
  const single = getSettings().singleListCommandLine === "on";

  return [
    ...SETTINGS.flatMap((spec) => (single ? flatCommandsFor(spec) : [commandFor(spec)])),
    { id: "go:test", label: "перейти: тест", icon: "keyboard", run: () => navigate("/") },
    { id: "go:race", label: "перейти: онлайн", icon: "users", run: () => navigate("/race") },
    {
      id: "go:leaderboard",
      label: "перейти: лидерборд",
      icon: "crown",
      run: () => navigate("/leaderboard"),
    },
    { id: "go:profile", label: "перейти: профиль", icon: "user", run: () => navigate("/profile") },
    {
      id: "go:settings",
      label: "перейти: настройки",
      icon: "gear",
      run: () => navigate("/settings"),
    },
    {
      id: "theme:next-random",
      label: "следующая случайная тема",
      icon: "palette",
      run: async () => {
        const s = getSettings();
        const favourites = s.favThemes
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);

        // Вид выбираем тот же, что стоит в настройке. Выключена — берём
        // из всех: команду зовут, когда тему хотят сменить прямо сейчас
        const kind = s.randomTheme === "off" ? "on" : s.randomTheme;
        const name = await pickRandomTheme(kind, favourites);
        if (name) updateSettings({ theme: name, customTheme: false });
      },
    },
    {
      id: "reset",
      label: "сбросить все настройки",
      icon: "rotate",
      run: () => {
        resetSettings();
        restartHook?.();
      },
    },
  ];
}

export function openCommandline(): void {
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.className = "picker commandline";
  overlay.innerHTML = `
    <div class="box">
      <input class="input" data-search placeholder="команда…" autocomplete="off" spellcheck="false">
      <div class="cmdList" data-list></div>
      <div class="cmdFooter sub">
        <span><kbd>↑↓</kbd> выбор</span>
        <span><kbd>enter</kbd> применить</span>
        <span><kbd>esc</kbd> назад</span>
      </div>
    </div>
  `;

  const listEl = overlay.querySelector<HTMLElement>("[data-list]")!;
  const searchEl = overlay.querySelector<HTMLInputElement>("[data-search]")!;

  let items: Command[] = rootCommands();
  const stack: Command[][] = [];
  let selected = 0;

  function visible(): Command[] {
    const needle = searchEl.value.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((c) => c.label.toLowerCase().includes(needle));
  }

  function draw(): void {
    const shown = visible().slice(0, 200);
    selected = Math.max(0, Math.min(selected, shown.length - 1));

    listEl.innerHTML =
      shown.length === 0
        ? `<p class="sub" style="padding:0.5rem">ничего не найдено</p>`
        : shown
            .map(
              (c, i) => `
        <button class="cmdItem${i === selected ? " selected" : ""}" data-index="${i}">
          <span class="cmdIcon">${c.icon ? icon(c.icon) : ""}</span>
          <span>${escapeHtml(c.label)}</span>
          ${c.hint ? `<span class="cmdHint">${escapeHtml(c.hint)}</span>` : ""}
          ${c.children ? `<span class="cmdHint">${icon("arrowRight")}</span>` : ""}
        </button>`,
            )
            .join("");

    listEl.querySelector(".cmdItem.selected")?.scrollIntoView({ block: "nearest" });
  }

  async function choose(command: Command): Promise<void> {
    if (command.children) {
      stack.push(items);
      items = await command.children();
      searchEl.value = "";
      selected = 0;
      draw();
      return;
    }

    await command.run?.();
    close();
  }

  function back(): boolean {
    const previous = stack.pop();
    if (!previous) return false;

    items = previous;
    searchEl.value = "";
    selected = 0;
    draw();
    return true;
  }

  function close(): void {
    overlay?.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event: KeyboardEvent): void {
    if (!overlay) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!back()) close();
      return;
    }

    const shown = visible();

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selected = (selected + 1) % Math.max(1, shown.length);
      draw();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selected = (selected - 1 + shown.length) % Math.max(1, shown.length);
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = shown[selected];
      if (command) void choose(command);
    }
  }

  overlay.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target === overlay) {
      close();
      return;
    }

    const button = target.closest<HTMLElement>(".cmdItem");
    if (button) {
      const command = visible()[Number(button.dataset["index"])];
      if (command) void choose(command);
    }
  });

  searchEl.addEventListener("input", () => {
    selected = 0;
    draw();
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  draw();
  searchEl.focus();
}

/** Глобальная горячая клавиша. Вешается один раз при старте приложения. */
export function installCommandlineHotkey(): void {
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openCommandline();
    }
  });
}
