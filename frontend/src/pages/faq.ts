/**
 * Частые вопросы.
 *
 * Вопросы и ответы лежат в backend/app/data/faq.json и импортируются на
 * сборке — не копируются сюда. Причина не в красоте: этот же список
 * бэкенд отдаёт разметкой FAQPage, а Google требует, чтобы размеченный
 * текст совпадал с видимым на странице. Две копии разошлись бы молча,
 * и разметку перестали бы показывать.
 */

import faqItems from "../../../backend/app/data/faq.json";
import { escapeHtml } from "../ui/format";
import type { PageContext } from "../router";
import { icon } from "../ui/icons";

interface FaqItem {
  q: string;
  a: string;
}

export function faqPage({ container }: PageContext): void {
  const items = (faqItems as FaqItem[])
    .map(
      (item) => `
      <div class="section">
        <h2 class="title">${escapeHtml(item.q)}</h2>
        <p>${escapeHtml(item.a)}</p>
      </div>`,
    )
    .join("");

  container.innerHTML = `
    <div class="textPage">
      <div class="section">
        <h1 class="title">${icon("info")} Частые вопросы</h1>
        <p>
          Что означают цифры после теста, откуда они берутся и почему их
          считает сервер. Формулы те же, что в monkeytype, — чтобы результаты
          можно было сравнивать.
        </p>
      </div>

      ${items}

      <div class="section">
        <h2 class="title">${icon("keyboard")} Остались вопросы</h2>
        <p>
          Подробнее о проекте и лицензии — на странице <a href="/about">о проекте</a>.
          Как ставить руки и с чего начинать — в <a href="/guide">гайде по слепой печати</a>.
        </p>
        <p>
          <a href="/" class="button">Перейти к тесту</a>
          <a href="/norms">Какая скорость считается нормальной</a>
        </p>
      </div>
    </div>
  `;
}
