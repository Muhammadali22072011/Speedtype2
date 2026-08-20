/**
 * Посадочная страница теста на узбекском.
 *
 * Текст здесь на узбекском, а не на русском, и это осознанно: страница
 * ловит запросы вида «klaviatura tezligi test», а они задаются на узбекском.
 * Обёртке проставлен lang="uz" — интерфейс сайта остаётся русским,
 * но поисковик должен видеть язык содержимого, а не язык оболочки.
 */

import { navigate, type PageContext } from "../router";
import { updateSettings } from "../state/settings";
import { icon } from "../ui/icons";

export function uzbekPage({ container }: PageContext): void {
  container.innerHTML = `
    <div class="textPage" lang="uz">
      <div class="section">
        <h1 class="title">${icon("keyboard")} Klaviatura tezligi testi — o'zbek tilida</h1>
        <p>
          Yozish tezligingizni o'zbek tilida tekshiring. Testda o'zbek tilining
          eng ko'p ishlatiladigan 196 ta so'zi bor, kengaytirilgan lug'atlar
          esa mingdan yetmish minggacha so'zni qamrab oladi.
        </p>
        <p>
          <button id="startUzbek" class="button">${icon("bolt")} Testni boshlash</button>
        </p>
      </div>

      <div class="section">
        <h2 class="title">${icon("chart")} Natija qanday hisoblanadi</h2>
        <p>
          Tezlik wpm — daqiqadagi so'zlar soni bilan o'lchanadi. Bir so'z deb
          besh belgi olinadi, shuning uchun natijalarni boshqa tillar bilan
          solishtirish mumkin. Faqat to'g'ri yozilgan belgilar hisobga olinadi.
        </p>
        <p>
          Aniqlik — to'g'ri bosishlarning umumiy bosishlarga nisbati. Tuzatilgan
          xato ham xato bo'lib qoladi: hisob yozish jarayonida yuritiladi,
          tayyor matn bo'yicha emas. Barcha ko'rsatkichlarni server hisoblaydi.
        </p>
      </div>

      <div class="section">
        <h2 class="title">${icon("cursor")} O'zbek tilida yozishning o'ziga xosligi</h2>
        <ul class="aboutList">
          <li>
            <b>Apostrof.</b> <i>o'</i> va <i>g'</i> harflari qo'shimcha belgi
            talab qiladi. Aynan shu yerda tezlik ko'pincha pasayadi.
          </li>
          <li>
            <b>Ikki harfli birikmalar.</b> <i>sh</i>, <i>ch</i>, <i>ng</i> —
            ularni bitta harakat sifatida yozishga o'rganish kerak.
          </li>
          <li>
            <b>Uzun qo'shimchalar.</b> <i>-lardan</i>, <i>-ligini</i>,
            <i>-moqchiman</i> — bunday zanjirlarni harf-harf emas, bir butun
            sifatida yozgan ma'qul.
          </li>
          <li>
            <b>Klaviatura tanlovi.</b> Lotin yozuvida odatdagi QWERTY ishlatiladi,
            saytda 239 ta klaviatura sxemasi mavjud.
          </li>
        </ul>
      </div>

      <div class="section">
        <h2 class="title">${icon("crown")} Qayerdan boshlash kerak</h2>
        <p>
          Agar klaviaturaga qaramasdan yozishni endi o'rganayotgan bo'lsangiz,
          barmoqlarni to'g'ri qo'yishdan boshlang. Qo'llanma rus tilida:
          <a href="/guide">ko'r yozuvga o'rganish bo'yicha qo'llanma</a>.
          Natijangiz qanchalik yaxshi ekanini bilish uchun
          <a href="/norms">daraja jadvaliga</a> qarang.
        </p>
        <p>
          <a href="/russian">Rus tilida test</a> ·
          <a href="/">Barcha tillar va rejimlar</a>
        </p>
      </div>
    </div>
  `;

  container.querySelector<HTMLElement>("#startUzbek")?.addEventListener("click", () => {
    updateSettings({ language: "uzbek" });
    navigate("/");
  });
}
