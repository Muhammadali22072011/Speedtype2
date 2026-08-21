/**
 * Настройки аккаунта: имя, почта, пароль, выгрузка, сброс истории,
 * удаление аккаунта.
 *
 * Отдельная страница, а не раздел профиля: здесь живут действия, которые
 * нельзя отменить, и рядом с обычной таблицей результатов им не место.
 *
 * Всё, что трогает безопасность или удаляет данные, требует текущий
 * пароль — его проверяет сервер, клиент только отправляет.
 */

import { api, ApiError, getToken, setToken, type User } from "../api/client";
import { navigate, type PageContext } from "../router";
import { escapeHtml, formatDate } from "../ui/format";
import { icon } from "../ui/icons";

export async function accountPage({ container }: PageContext): Promise<void> {
  if (!getToken()) {
    navigate("/login", true);
    return;
  }

  container.innerHTML = `<div class="loadingState"><div class="spinner"></div>загрузка</div>`;

  let user: User;
  try {
    user = await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      navigate("/login", true);
      return;
    }
    container.innerHTML = `<div class="errorState">${icon("triangleExclamation")}${escapeHtml(
      error instanceof ApiError ? error.message : "Сервер недоступен",
    )}</div>`;
    return;
  }

  container.innerHTML = `
    <h2 class="sectionTitle">${icon("user")} аккаунт</h2>
    <p class="muted">${escapeHtml(user.username)} · с ${formatDate(user.created_at)}</p>

    <div class="accountCard">
      <h3>имя и почта</h3>
      <p class="hint">Имя видно в лидерборде. Почта нужна только для восстановления доступа.</p>
      <form class="accountForm" data-form="profile">
        <label>имя <input class="input" name="username" value="${escapeHtml(user.username)}"
                          autocomplete="username" maxlength="50"></label>
        <label>почта <input class="input" name="email" type="email"
                            value="${escapeHtml(user.email ?? "")}" autocomplete="email"></label>
        <label>текущий пароль <input class="input" name="current_password" type="password"
                                     autocomplete="current-password" required></label>
        <button class="button" type="submit">${icon("check")} сохранить</button>
        <p class="formNote" data-note></p>
      </form>
    </div>

    <div class="accountCard">
      <h3>пароль</h3>
      <p class="hint">Не короче шести знаков. После смены вход на других устройствах остаётся.</p>
      <form class="accountForm" data-form="password">
        <label>текущий пароль <input class="input" name="current_password" type="password"
                                     autocomplete="current-password" required></label>
        <label>новый пароль <input class="input" name="new_password" type="password"
                                   autocomplete="new-password" minlength="6" required></label>
        <label>ещё раз <input class="input" name="repeat" type="password"
                              autocomplete="new-password" minlength="6" required></label>
        <button class="button" type="submit">${icon("check")} сменить пароль</button>
        <p class="formNote" data-note></p>
      </form>
    </div>

    <div class="accountCard">
      <h3>метки</h3>
      <p class="hint">Метка — это ярлык на результате: «утро», «новая раскладка», «с музыкой».
         Ставится в истории, ими же можно фильтровать.</p>
      <div id="tagList" class="tagList"><div class="loadingState"><div class="spinner"></div>загрузка</div></div>
      <form class="accountForm" data-form="tag">
        <label>новая метка <input class="input" name="name" maxlength="30" required></label>
        <button class="button" type="submit">${icon("check")} завести</button>
        <p class="formNote" data-note></p>
      </form>
    </div>

    <div class="accountCard">
      <h3>выгрузка данных</h3>
      <p class="hint">Все ваши результаты и профиль одним файлом json. Забирайте когда угодно.</p>
      <button class="button" id="export">${icon("save")} скачать мои данные</button>
      <p class="formNote" data-export-note></p>
    </div>

    <div class="accountCard danger">
      <h3>${icon("triangleExclamation")} необратимое</h3>

      <p class="hint">Сброс истории удаляет все результаты. Аккаунт и имя остаются.</p>
      <button class="button danger" id="clearResults">${icon("eraser")} сбросить историю</button>

      <p class="hint">Удаление аккаунта уносит и результаты — иначе они повисли бы в лидерборде без владельца.</p>
      <form class="accountForm" data-form="delete">
        <label>текущий пароль <input class="input" name="current_password" type="password"
                                     autocomplete="current-password" required></label>
        <button class="button danger" type="submit">${icon("xmark")} удалить аккаунт</button>
        <p class="formNote" data-note></p>
      </form>
    </div>
  `;

  /** Подпись под формой: ошибка красным, успех обычным. */
  function note(form: HTMLElement, text: string, ok = false): void {
    const el = form.querySelector<HTMLElement>("[data-note]");
    if (!el) return;
    el.textContent = text;
    el.className = `formNote ${ok ? "sub" : "error"}`;
  }

  /** Пока запрос в пути, кнопка выключена — иначе форму шлют дважды. */
  async function submitting<T>(form: HTMLFormElement, run: () => Promise<T>): Promise<T | null> {
    const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
    if (button) button.disabled = true;

    try {
      return await run();
    } catch (error) {
      note(form, error instanceof ApiError ? error.message : "Сервер недоступен");
      return null;
    } finally {
      if (button) button.disabled = false;
    }
  }

  // ---------- метки ----------

  const tagListEl = container.querySelector<HTMLElement>("#tagList")!;
  const tagForm = container.querySelector<HTMLFormElement>('[data-form="tag"]')!;

  async function drawTags(): Promise<void> {
    try {
      const tags = await api.tags();

      tagListEl.innerHTML =
        tags.length === 0
          ? `<p class="sub">меток пока нет</p>`
          : tags
              .map(
                (tag) => `
          <span class="tagChip editable">
            ${escapeHtml(tag.name)}
            <button class="textButton" data-rename="${tag.id}"
                    aria-label="переименовать" data-balloon-pos="up">${icon("copy")}</button>
            <button class="textButton danger" data-remove="${tag.id}"
                    aria-label="удалить метку" data-balloon-pos="up">${icon("xmark")}</button>
          </span>`,
              )
              .join("");
    } catch {
      tagListEl.innerHTML = `<p class="error">не удалось загрузить метки</p>`;
    }
  }

  tagListEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;

    const rename = target.closest<HTMLElement>("button[data-rename]");
    if (rename) {
      const id = Number(rename.dataset["rename"]);
      const now = rename.parentElement?.textContent?.trim() ?? "";
      const next = prompt("Новое имя метки", now);
      if (next && next !== now) void api.renameTag(id, next).then(drawTags);
      return;
    }

    const remove = target.closest<HTMLElement>("button[data-remove]");
    if (remove) {
      // Метка снимается со всех результатов, но сами результаты остаются
      if (!confirm("Удалить метку? Результаты останутся, метка с них снимется.")) return;
      void api.deleteTag(Number(remove.dataset["remove"])).then(drawTags);
    }
  });

  tagForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(new FormData(tagForm).get("name") ?? "").trim();
    if (!name) return;

    void submitting(tagForm, async () => {
      await api.createTag(name);
      tagForm.reset();
      note(tagForm, "метка заведена", true);
      await drawTags();
    });
  });

  void drawTags();

  // ---------- имя и почта ----------

  const profileForm = container.querySelector<HTMLFormElement>('[data-form="profile"]')!;
  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(profileForm);

    void submitting(profileForm, async () => {
      const updated = await api.updateProfile({
        username: String(data.get("username") ?? ""),
        email: String(data.get("email") ?? ""),
        current_password: String(data.get("current_password") ?? ""),
      });

      note(profileForm, "сохранено", true);
      profileForm.querySelector<HTMLInputElement>("[name=current_password]")!.value = "";
      return updated;
    });
  });

  // ---------- пароль ----------

  const passwordForm = container.querySelector<HTMLFormElement>('[data-form="password"]')!;
  passwordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const next = String(data.get("new_password") ?? "");

    // Совпадение проверяем здесь: сервер второго поля не видит, а ошибиться
    // в невидимом пароле легко
    if (next !== String(data.get("repeat") ?? "")) {
      note(passwordForm, "новый пароль и повтор не совпадают");
      return;
    }

    void submitting(passwordForm, async () => {
      await api.changePassword(String(data.get("current_password") ?? ""), next);
      passwordForm.reset();
      note(passwordForm, "пароль изменён", true);
    });
  });

  // ---------- выгрузка ----------

  container.querySelector<HTMLElement>("#export")?.addEventListener("click", () => {
    const noteEl = container.querySelector<HTMLElement>("[data-export-note]")!;
    noteEl.className = "formNote sub";
    noteEl.textContent = "собираем…";

    void api
      .exportData()
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `speedtype-${user.username}.json`;
        link.click();
        URL.revokeObjectURL(url);
        noteEl.textContent = "файл скачан";
      })
      .catch((error: unknown) => {
        noteEl.className = "formNote error";
        noteEl.textContent = error instanceof ApiError ? error.message : "Сервер недоступен";
      });
  });

  // ---------- сброс истории ----------

  container.querySelector<HTMLElement>("#clearResults")?.addEventListener("click", () => {
    const noteEl = container.querySelector<HTMLElement>("[data-export-note]")!;

    // Спрашиваем именем: «вы уверены» люди подтверждают не читая
    const answer = prompt(
      `Это удалит все результаты без возможности вернуть.\nВведите имя аккаунта, чтобы подтвердить:`,
    );
    if (answer !== user.username) return;

    void api
      .clearResults()
      .then(() => {
        noteEl.className = "formNote sub";
        noteEl.textContent = "история очищена";
      })
      .catch((error: unknown) => {
        noteEl.className = "formNote error";
        noteEl.textContent = error instanceof ApiError ? error.message : "Сервер недоступен";
      });
  });

  // ---------- удаление аккаунта ----------

  const deleteForm = container.querySelector<HTMLFormElement>('[data-form="delete"]')!;
  deleteForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const answer = prompt(
      `Аккаунт и все результаты будут удалены навсегда.\nВведите имя аккаунта, чтобы подтвердить:`,
    );
    if (answer !== user.username) return;

    const data = new FormData(deleteForm);
    void submitting(deleteForm, async () => {
      await api.deleteAccount(String(data.get("current_password") ?? ""));
      // Токен теперь указывает на несуществующего человека
      setToken(null);
      navigate("/");
    });
  });
}
