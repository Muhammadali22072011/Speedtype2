/**
 * Вход и регистрация — одна страница в двух режимах.
 *
 * Разметка собрана по их исходникам: ts/components/pages/login/Login.tsx
 * и Register.tsx. Колонка 20rem, заголовок с иконкой кеглем основного
 * текста, поля подряд. Кнопки входа через Google и GitHub у них есть,
 * у нас такого входа нет — не переносим.
 *
 * Логика формы не менялась: обработчик тот же, что был.
 */

import "../styles/auth.css";

import { api, ApiError, setToken } from "../api/client";
import { navigate, type PageContext } from "../router";
import { escapeHtml } from "../ui/format";
import { icon } from "../ui/icons";

/** Поле с видимой подписью. Метка обёрнута вокруг input — связь без id. */
function field(options: {
  label: string;
  name: string;
  type?: string;
  autocomplete: string;
  hint?: string;
  attrs?: string;
}): string {
  const { label, name, type = "text", autocomplete, hint, attrs = "" } = options;
  return `
    <label class="authField">
      <span class="authLabel">${label}</span>
      <input class="input" name="${name}" type="${type}" required
             autocomplete="${autocomplete}" ${attrs}>
      ${hint ? `<span class="authHint">${hint}</span>` : ""}
    </label>
  `;
}

function form(kind: "login" | "register"): string {
  const isRegister = kind === "register";

  return `
    <div class="authPage">
      <form class="authForm" id="form">
        <h1 class="authTitle">
          ${icon(isRegister ? "userPlus" : "signIn")}
          ${isRegister ? "регистрация" : "вход"}
        </h1>

        ${field({
          label: "имя пользователя",
          name: "username",
          autocomplete: isRegister ? "new-username" : "username",
          attrs: 'minlength="3" maxlength="50"',
          ...(isRegister ? { hint: "от 3 до 50 символов, менять нельзя" } : {}),
        })}

        ${
          isRegister
            ? field({
                label: "почта",
                name: "email",
                type: "email",
                autocomplete: "new-email",
                hint: "нужна для восстановления доступа",
              })
            : ""
        }

        ${field({
          label: "пароль",
          name: "password",
          type: "password",
          autocomplete: isRegister ? "new-password" : "current-password",
          attrs: 'minlength="6"',
          ...(isRegister ? { hint: "не короче 6 символов" } : {}),
        })}

        <!-- role="alert" — экранный диктор прочитает ошибку сам,
             не дожидаясь, пока человек до неё дойдёт -->
        <p class="error authError" id="error" role="alert"></p>

        <button class="button authSubmit" type="submit">
          ${icon(isRegister ? "userPlus" : "signIn")}
          ${isRegister ? "создать аккаунт" : "войти"}
        </button>

        <p class="authSwitch">
          ${
            isRegister
              ? `уже есть аккаунт? <a href="/login">войти</a>`
              : `нет аккаунта? <a href="/register">зарегистрироваться</a>`
          }
        </p>
      </form>
    </div>
  `;
}

function makePage(kind: "login" | "register") {
  return function page({ container }: PageContext): void {
    container.innerHTML = form(kind);

    const formEl = container.querySelector<HTMLFormElement>("#form")!;
    const errorEl = container.querySelector<HTMLElement>("#error")!;

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";

      const data = new FormData(formEl);
      const username = String(data.get("username") ?? "");
      const password = String(data.get("password") ?? "");
      const email = String(data.get("email") ?? "");

      const button = formEl.querySelector("button")!;
      button.disabled = true;

      try {
        const response =
          kind === "register"
            ? await api.register(username, email, password)
            : await api.login(username, password);

        setToken(response.access_token);
        navigate("/");
      } catch (error) {
        errorEl.innerHTML = escapeHtml(
          error instanceof ApiError ? error.message : "Сервер недоступен",
        );
        button.disabled = false;
      }
    });
  };
}

export const loginPage = makePage("login");
export const registerPage = makePage("register");
