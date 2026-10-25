---
version: alpha
name: AmIFooled
description: Спокойная карточка наблюдений о сайте с явным разделением фактов и неизвестного.
colors:
  primary: "#315c96"
  background: "#eef3f9"
  surface: "#ffffff"
  text: "#162b43"
  muted: "#51647a"
  border: "#bac9db"
typography:
  display:
    fontFamily: "'Avenir Next', 'Trebuchet MS', sans-serif"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
rounded:
  panel: "12px"
spacing:
  page: "24px"
  section: "28px"
components:
  notice: {}
---

# AmIFooled design context

## Overview

Product/tool register: компактное расширение для русскоязычного участника хакатона,
который хочет понять условия сайта и увидеть источники. География и юридические
обязательства пользователей не определяются языком интерфейса. Язык ru, Latin в доменах.

North Star — карточка наблюдений исследователя: цитата, наблюдение, ограничение.
Синяя вертикальная отметка связывает блок с источником, а не изображает оценку риска.
Пространство и спокойный шрифт важнее тревожного «security score». Не делать красный
щит, зелёную галочку безопасности, dashboard ради dashboard или маркетинговый лендинг.

Popup (#5) состоит из формы соглашения и двух независимых карточек — сверка и утечки.
Карточка несёт собственный статус, собственную ошибку и собственный retry: отказ одной
никогда не прячет результат другой. Результат по чужому hostname отбрасывается.
Обычный popup подключён к реальному background/API; demo controller остаётся только
для отдельных тестов. При смене документа обе карточки и текст сбрасываются.

Runtime owner — `apps/extension/styles/base.css` (Model B). Этот документ отражает его
семантические значения; другой token package/ThemeProvider не добавляется. Mapping:
`colors.X → --color-X`; `typography.display/body → --font-display/body`;
`rounded.panel → --radius-panel`; `spacing.page/section → --space-page/section`.
Потребители — popup и notice. При изменении токенов обновлять CSS и документ вместе.

## Colors

Холодный светлый background, белый surface, тёмный text, muted для пояснений. Primary
только акцент и focus; не означает риск/безопасность. Severity не кодируется цветом:
`Требует внимания` и `К сведению` различаются текстом, а отметка слева лишь связывает блок с
источником. Цвет никогда не единственный носитель состояния. Border отделяет области;
forced-colors возвращает системные цвета и рисует рамки через CanvasText/ButtonText.
Warning не объявляет противоречие: это может быть открыто описанное условие самого документа.
Пока только light theme, без переключателя и удалённых font/theme запросов.

## Typography

Display с округлыми формами для названия/заголовка, system body с поддержкой кириллицы
для доказательств. Body 15px/1.55; заголовок 25px/1.3, основной статус 16px. Никаких
капслок-параграфов. Длинные домены переносить без потери данных. Внешние шрифты не грузить.

## Layout

Popup 380px с max-width 100vw; проверено 320, 380 и 420px без горизонтального overflow.
Минимум body 320px предотвращает сжатие нативного Chrome action popup при вычислении
его начального preferred size; это также минимальная поддерживаемая ширина интерфейса.
`overflow-wrap: anywhere` на `.popup` наследуется общей строкой состояния, preview payload,
карточками и источниками: допустимый длинный hostname переносится во всех состояниях.
Поля 24px (ниже 360px — 16px), разделы 28px, естественный вертикальный скролл. Один
заголовок и одна общая строка состояния, затем форма и две карточки. Кнопка действия
имеет min-width 220px и во время загрузки меняет только aria-busy/disabled, поэтому
основное действие не смещается; ниже 360px кнопки занимают всю ширину.

## Elevation & Depth

Плоская поверхность, различие через тон и левую отметку, без теней и blur.
Нет всплывающих слоёв в setup. Будущие overlays должны сохранять focus.

## Shapes

Panel radius 12px. Не превращать каждый текстовый фрагмент в pill; факты читаются как
обычный текст с источником. Смысловая отметка 4px не обозначает степень угрозы.

## Components

Notice: h2 + пояснение, без неработающей кнопки. Card: h2 + строка статуса с aria-live +
тело + необязательный footer с собственным retry. Button: нативный `button` в двух
вариантах, hover/active/disabled/busy описаны в одном месте. Field: `label[for]` +
`textarea` + счётчик символов, при превышении лимита — aria-invalid и текстовая подсказка.
Payload: перечисление того, что уйдёт на сервер, рядом с кнопкой отправки.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Scrollbar | styles/base.css | CSS semantic tokens | global baseline, forced colors | browser computed style |
| Button | components/ActionButton.tsx | styles/base.css `.action` | primary, secondary | клавиатура + computed style |
| Card | components/CardShell.tsx | styles/base.css `.card` | analysis, breaches, unsupported | ручной обход состояний |
| Field | components/PolicyForm.tsx | styles/base.css `.field__*` | textarea с счётчиком | label/aria-invalid в браузере |

Scrollbar общий: thumb/track/hover/active tokens, standard properties + WebKit fallback,
forced-colors → auto. Новые scroll surfaces наследуют baseline. Не скрывать скроллбар.

Будущие controls — native button/a, видимый focus, hover/active/disabled/busy в одном
общем компоненте, labels и status text; idle/loading/partial/error/unknown все отличимы
текстом. Сейчас движение отсутствует, поэтому reduced-motion не меняет содержимое.
Иконок нет; символ вопроса — часть марки, скрыт от screen reader рядом с названием.
Дата/число в ru-RU; источники показывать ссылками. Не писать «безопасен» при count=0.

## Do's and Don'ts

- Do: показывать источник, точную цитату и предел наблюдения рядом с выводом.
- Do: маркировать synthetic/rules/llm, ошибки и неполноту данных.
- Do: писать «цитировать нечего», когда вывод построен на отсутствии фразы в тексте.
- Do: называть ошибку ошибкой — «результата нет», а не пустой результат.
- Do: отличать HTTP 200 с unavailable от not_found; общий статус остаётся failed/partial.
- Don't: подменять ноль найденных записей обещанием безопасности.
- Don't: показывать декоративные risk scores или отключённые псевдо-действия.
- Don't: отправлять текст соглашения без явного нажатия пользователя.
