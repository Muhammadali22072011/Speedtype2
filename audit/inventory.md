# Инвентаризация — проход A

Два списка: **М** — что есть у monkeytype, **S** — что есть у нас.
Оба построены по коду, не по README.

## Источники

**М** — `git clone --depth 1 --filter=blob:none --sparse https://github.com/monkeytypegame/monkeytype`
(ветка `master`, sparse: `frontend/src`, `packages`). Клон лежит в
`%TEMP%\mtref\mt`. Живой сайт `https://monkeytype.com` открывался в браузере
для снятия `getComputedStyle`.

**S** — `frontend/src` (5682 строки), `backend/app` (1499 строк),
`backend/app/static` (871 файл), `backend/app/data/themes.json` (187 тем).

Важно про структуру М: monkeytype на `master` уже переписан на **SolidJS +
Tailwind 4**. Страницы лежат не в `frontend/src/ts/pages/` (там остались только
`test.ts`, `page.ts`, `loading.ts`), а в `frontend/src/ts/components/pages/*`.
Список путей из задания устарел — фактическая структура ниже.

---

## 1. Страницы

| страница | М (маршрут) | S (маршрут) |
|---|---|---|
| тест | `/` — `components/pages/test/*` + `html/pages/test.html` | `/` — `pages/test.ts` |
| результат | часть страницы теста, `html/pages/test-result.html` | часть `pages/test.ts`, `#result` |
| настройки | `/settings` — `components/pages/settings/SettingsPage.tsx` | `/settings` — `pages/settings.ts` |
| аккаунт (статистика) | `/account` — `components/pages/account/*` (12 файлов) | `/profile` — `pages/profile.ts` |
| настройки аккаунта | `/account-settings` — 6 вкладок | — |
| публичный профиль | `/profile/:name` — `components/pages/profile/*` | — |
| поиск профилей | `/profile` (без имени) | — |
| лидерборды | `/leaderboards` — 7 файлов | `/leaderboard` — `pages/leaderboard.ts` |
| вход/регистрация | `/login` — `Login.tsx` + `Register.tsx` на одной странице | `/login` и `/register` — две страницы |
| о проекте | `/about` — `AboutPage.tsx` | — |
| друзья | `/friends` — `components/pages/connections/*` | — |
| 404 | `/404` — `404Page.tsx` | `/404` |
| загрузка | `html/pages/loading.html` | — |
| гонка | — | `/race` — `pages/race.ts` (наша функция) |
| статические юр. страницы | `terms-of-service.html`, `privacy-policy.html`, `security-policy.html` | — |

## 2. Каркас

| элемент | М | S |
|---|---|---|
| шапка | `layout/header/Header.tsx` (`Logo`, `Nav`, `AccountMenu`, `AccountXpBar`) | `main.ts:20-27` |
| футер | `layout/footer/Footer.tsx` (`Keytips`, `ThemeIndicator`, `VersionButton`, `ScrollToTop`) | `main.ts:29-36` |
| оверлеи | `layout/overlays/Banners.tsx`, `FpsCounter.tsx` | — |
| сетка страницы | `.content-grid` (core.scss:56-95), 9 колонок, `--content-max-width: 1536px` | `#app { max-width: 1000px }` |
| роутер | `controllers/route-controller.ts` + `url-handler.tsx` | `router.ts` (7 маршрутов) |
| тема | `components/core/Theme.tsx` — `<style id="theme">` в head | `state/themes.ts` — inline-стили на `<html>` |

## 3. Панель режимов теста (`data-ui-element="testConfig"`)

| элемент | М | S |
|---|---|---|
| карточек в панели | 3 отдельные (`.card`, `bg-sub-alt`), зазор `--card-gap` | 1 карточка, внутри `.divider` шириной 0.25rem |
| переключатели | `punctuation`, `numbers` (гаснут в zen, блокируются в quote) | `punctuation`, `numbers` |
| режимы | time, words, quote, **zen**, **custom** | time, words, quote |
| значения time | 15/30/60/120 + «своё» (`fa-tools` → модалка) | 15/30/60/120 |
| значения words | 10/25/50/100 + «своё» (`fa-tools` → модалка) | 10/25/50/100 |
| значения quote | all/short/medium/long/thicc + избранное (сердце, для вошедших) + поиск | ничего (группа скрыта) |
| значения custom | кнопка «change» → модалка своего текста | — |
| кнопка «поделиться настройками» | появляется справа на наведении | — |
| анимация смены mode2 | ширина + прозрачность, 250 мс | нет, мгновенная перерисовка |
| мобильный вид | кнопка «test settings» → модалка `MobileTestConfig` (ниже `md` = 849px) | панель просто переносится по словам |
| язык, funbox, сложность | **не в панели**, а в строке `TestModesNotice` под ней | кнопка языка и funbox прямо в панели |

## 4. Строка активных режимов (`TestModesNotice`) — у нас отсутствует целиком

23 индикатора: repeated, saving disabled, подсказка о клавише рестарта,
длинный свой текст, загруженный челлендж, подсказка zen, язык, polyglot,
сложность, blind, lazy, pace caret, среднее, личный рекорд, min speed,
min acc, min burst, funbox, confidence, stop on error, delete on error,
эмулируемая раскладка, opposite shift, теги.

## 5. Область слов

| элемент | М | S |
|---|---|---|
| контейнер | `#wordsWrapper` (высота = 3 строки, `overflow: clip`) + `#words` внутри | `#words` сам с `height: 3lh; overflow: hidden` |
| классы `#words` | `blind`, `hideExtraLetters`, `flipped`, `colorfulMode`, `tape`, `blurred`, `rightToLeftTest`, `joiningScript`, `noErrorBorder`, `highlight-off/-word/-next-word/-next-two-words/-next-three-words`, `typed-effect-hide/-fade/-dots` | `blindMode`, `colorfulMode`, `flipped`, `allLines`, `tape tape-letter/word`, `highlight-*` (с `_`), `typed-keep/hide/fade/dots`, `blurred` |
| классы букв | `correct`, `corrected`, `extraCorrected`, `incorrect`, `incorrect extra`, `missing`, `dead`, `tabChar`, `nlChar` | `correct`, `incorrect`, `extra` |
| подсказки опечаток | `.hints hint` под словом | — |
| подсветка слова | `.highlightContainer .highlight` (для tape/word) | — |
| прокрутка | анимация `anime.js`, длительность зависит от `smoothLineScroll` | CSS `transform` + `transition: transform 0.15s ease` |

## 6. Каретка

| элемент | М | S |
|---|---|---|
| классы | `off`, `default`, `block`, `outline`, `underline`, `carrot`, `banana`, `monkey` | `caret-off`, `caret-line`, `caret-block`, `caret-outline`, `caret-underline` |
| мигание | `caretFlashSmooth` (плавное) / `caretFlashHard` (резкое, при `smoothCaret: off`); **останавливается при наборе** | `caretFlash` всегда |
| движение | `anime.js`, off/slow/medium/fast = 0/150/100/85 мс, ease `inOut(1.25)` | CSS transition 0/0.25/0.12/0.06 с, ease/linear |
| pace caret | `#paceCaret`, отдельный стиль (`paceCaretStyle`), режимы off/average/pb/tagPb/last/custom/daily | `#paceCaret`, только скорость из `paceCaretCustomSpeed` |
| высота | `1.2em`, `border-radius: var(--roundness)` | высота буквы из JS, `border-radius: 0.1em` |

## 7. Живая статистика

| элемент | М | S |
|---|---|---|
| таймер `bar` | `position: fixed`, верх экрана, во всю ширину, высота 8px | полоса внутри `#liveStats` |
| таймер `text` | огромный текст 4rem…10rem, абсолютно над словами, `z-index: -1` | обычный текст 2rem в строке над словами |
| таймер `mini` | размер = `fontSize` rem, над словами слева (или по `tapeMargin` в ленте) | то же, что `text` |
| таймер `flash_text` / `flash_mini` | есть | — |
| live speed/acc/burst `text` | огромный текст **под** словами | в той же строке над словами |
| live speed/acc/burst `mini` | рядом с таймером сверху | класс `.mini` = 1rem |
| цвет и прозрачность | `timerColor` × `timerOpacity` на все элементы | только на таймер |

## 8. Служебные элементы страницы теста

| элемент | М | S |
|---|---|---|
| подсказка клавиш | футер, две строки: «- restart test», «- command line» | `#testHint` под тестом, три пары |
| потеря фокуса | `OutOfFocusWarning`, два текста (окно / поле) | `#focusHint`, один текст |
| Caps Lock | плашка `bg-main`, текст `bg-color`, над словами | `#capsWarning`, текст `main` на `sub-alt` |
| клавиатура | `Keymap.tsx`, 7 форм | `#keymap`, 4 формы |
| обезьянка | `Monkey.tsx` (изображения `m1..m4`, реагирует на wpm) | настройка есть, реализации нет |
| composition display | `CompositionDisplay.tsx` (IME) | — |
| memory / layoutfluid таймеры | `#memoryTimer`, `#layoutfluidTimer` | — |
| кнопка рестарта | `#restartTestButton`, `padding: 16px 32px` | `#restartButton`, `padding: 8px 32px` |
| ошибка инициализации | `#testInitFailed` с кнопкой | текст ошибки внутри `#words` |
| индикатор загрузки | `.loading` с `fa-circle-notch fa-spin` | `…` в `#liveStats` |

## 9. Экран результата

| элемент | М | S |
|---|---|---|
| крупные | wpm (+ корона рекорда), acc | wpm, точность |
| мелкие | test type, other, raw, characters (correct/incorrect/extra/missed), consistency, time (+ afk, время за сегодня), daily leaderboard, source (цитата: репорт/избранное/оценка), tags | raw, ровность, символы (correct/incorrect), время |
| график | Chart.js, легенда-переключатели: scale, pb, tag pb, raw, burst, errors | голый SVG, одна линия wpm |
| история слов | `#resultWordsHistory` + 4 кнопки копирования + тепловая карта с легендой | `.wordsHistory`, только цвет ok/bad |
| реплей | `#resultReplay` | — |
| кнопки | next test, repeat wordset, practise words, toggle history, watch replay, screenshot | «ещё раз», «лидерборд» |
| для гостя | «Sign in to save your result» | текст «сохранено как гостевой…» |
| повтор сохранения | `#retrySavingResultButton` | — |

## 10. Настройки

Разделы **М** (8): behavior, input, sound, caret, appearance, theme,
hide elements, danger zone.
Разделы **S** (8): тест и текст, ввод и поведение, каретка и подсветка,
показатели, оформление, клавиатура, звук, интерфейс.

Ключей: **М — 94**, **S — 84**. Полная машинная сверка: [settings-diff.md](settings-diff.md).

Обвязка страницы:

| элемент | М | S |
|---|---|---|
| быстрая навигация по разделам | `QuickNav`, 8 кнопок, липкая карточка | `.settingsNav`, 8 кнопок |
| поиск по настройкам | `SettingsSearch` + `SearchableSetting` | — |
| подсказка про командную строку | есть (при `showKeyTips`) | — |
| импорт/экспорт JSON | `ImportExport` + команды в командной строке | — |
| пресеты | `Presets` + модалки add/edit | — |
| теги | `Tags` + модалка | — |
| своя тема | `customTheme` + `customThemeColors` (10 цветов) | — |
| избранные темы | `favThemes` | объявлено, не работает |
| свой фон | `CustomBackground` + `CustomBackgroundFilters` (4 числа) | ссылка + строка фильтра |
| ограничение FPS анимаций | `AnimationFpsLimit` | — |
| сброс настроек | кнопка в danger zone + подтверждение | кнопка в шапке, без подтверждения |
| cookie-настройки | есть | — |
| «пока не работает» | нет такого состояния | `.setting.pending`, opacity 0.55 |

## 11. Командная строка

| элемент | М | S |
|---|---|---|
| открытие | `Escape` (или `Tab`, если `quickRestart: esc`) | `ctrl+shift+p` и кнопка в футере |
| команд | ~94 настройки + ~40 действий + темы/шрифты/funbox/теги/пресеты/челленджи | 84 настройки + 6 переходов + сброс |
| поиск | нечёткий, с алиасами (`alias`) | `includes` по подстроке |
| превью при наведении | тема и шрифт применяются сразу (`command.hover`) | — |
| ввод значения в строке | `input: true` (импорт/экспорт JSON, свой фон) | — |
| цветные плашки тем | `customData: {main, bg, sub, text, isFavorite}` | — |
| `singleListCommandLine` | реализовано (manual/on) | объявлено, не работает |

## 12. Модалки

**М — 33 модалки** (`components/modals/`): AddTag, Contact, Cookies,
CustomGenerator, CustomTestDuration, CustomText, CustomWordAmount, DevOptions,
EditProfile, EditResultTags, EventLogViewer, ForgotPassword, GoogleSignUp,
LastSignedOutResult, MobileTestConfig, PbTables, QuoteApprove, QuoteRate,
QuoteReport, QuoteSearch, QuoteSubmit, RegisterCaptcha, SaveCustomText,
SavedTexts, ShareTestSettings, Simple, StreakHourOffset, Support, UserReport,
VersionHistory, WordFilter + 8 для настроек аккаунта + 3 для пресетов.
Плюс попапы: Alerts (инбокс, история уведомлений, PSA), VideoAd.

**S — 2**: `ui/pickers.ts` (одна универсальная модалка выбора: тема, язык,
раскладка, шрифт, funbox) и `ui/commandline.ts`. Уведомлений в углу нет.

## 13. Funbox

**М — 48**, **S — 44** (README говорит 43).
Только у них: `rAnDoMcAsE`, `sPoNgEcAsE`, `IPv4`, `IPv6`, `ALL_CAPS`.
Только у нас: `leet`.
Пустышек у нас — **10**: `zipf`, `weakspot`, `poetry`, `wikipedia`,
`polyglot`, `arrows`, `layout_mirror`, `memory`, `no_quit`, `layoutfluid`
(README говорит 7). Полная таблица: [funbox-diff.md](funbox-diff.md).

## 14. Состояния экранов

| состояние | М | S |
|---|---|---|
| загрузка | скелет + `loading.html` + полоса загрузчика | текст «загрузка…» на профиле и лидерборде, `…` на тесте |
| пусто | «no results», отдельные тексты на каждой странице | «за этот период результатов нет», «результатов пока нет» |
| ошибка сети | уведомление в углу + `#testInitFailed` | текст ошибки внутри блока |
| не авторизован | страницы с `needsAuthentication` показывают заглушку | `/profile` делает `navigate("/login")` |
| оффлайн | баннер | — |
| несовместимая версия сервера | баннер | — |

## 15. Бэкенд (только S — у monkeytype бэкенд свой, не сверяем построчно)

Эндпоинты фактические (список в задании неточен — префикса `assets` нет):

```
GET  /api/health
GET  /api/themes                GET  /api/languages/index
GET  /api/layouts/index         GET  /api/quotes/index
GET  /api/words/{language}
GET  /api/languages             GET  /api/text
POST /api/auth/register         POST /api/auth/login      GET /api/auth/me
POST /api/results               GET  /api/results         GET /api/results/stats
GET  /api/leaderboard
POST /api/race                  GET  /api/race/{code}     WS  /api/race/{code}/ws
```

Таблицы: `User`, `Result`, `Language`, `Word`, `Quote`.
Нет таблиц под: теги, пресеты, личные рекорды по режимам, xp/уровень,
серию дней, друзей, свои темы, свой текст.
