/** Вход и регистрация — одна страница в двух режимах. */

import { api, ApiError, setToken } from "../api/client";
import { navigate, type PageContext } from "../router";
import { escapeHtml } from "../ui/format";

function form(kind: "login" | "register"): string {
  const isRegister = kind === "register";
  return `
    <form class="form" id="form">
      <h2 style="text-align:center">${isRegister ? "регистрация" : "вход"}</h2>
      <input class="input" name="username" placeholder="имя пользователя" required
             minlength="3" maxlength="50" autocomplete="username">
      ${
        isRegister
          ? `<input class="input" name="email" type="email" placeholder="email" required
                    autocomplete="email">`
          : ""
      }
      <input class="input" name="password" type="password" placeholder="пароль" required
             minlength="6" autocomplete="${isRegister ? "new-password" : "current-password"}">
      <p class="error" id="error"></p>
      <button class="btn" type="submit">${isRegister ? "создать аккаунт" : "войти"}</button>
      <p class="muted" style="text-align:center; font-size:0.85rem">
        ${
          isRegister
            ? `уже есть аккаунт? <a href="/login">войти</a>`
            : `нет аккаунта? <a href="/register">зарегистрироваться</a>`
        }
      </p>
    </form>
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
