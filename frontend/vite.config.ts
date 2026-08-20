import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// Версия одна на проект и лежит в package.json. Второй список держать
// нельзя: разъедется — в футере будет одно, в пакете другое.
const version = (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    proxy: {
      // В dev фронт и бэк на разных портах — проксируем, чтобы
      // в коде можно было писать просто fetch("/api/...")
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        // Гонки ходят по вебсокету на /api/race/{code}/ws
        ws: true,
      },
      // Темы, языки, раскладки и звуки лежат на бэкенде.
      // Без этого Vite отдаёт на них index.html, и css темы приходит пустым.
      "/static": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // Манифест нужен бэкенду: по нему он находит чанк конкретной страницы
    // и ставит на него modulepreload. Без этого страница, загруженная
    // динамическим import(), приезжает после первой отрисовки и двигает
    // вёрстку — CLS на /guide был 0.134 при пороге 0.1.
    manifest: true,
    // Карты исходников в прод не кладём: 225 КБ на пустом месте.
    // Проект под GPL-3.0, исходники и так открыты — прятать нечего,
    // вопрос только в весе.
    sourcemap: false,
  },
});
