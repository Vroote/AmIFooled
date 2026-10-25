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

Текущий setup имеет только честное пустое состояние; анализа ещё нет. Соседних экранов
не было. Будущие состояния описаны в #5 и `docs/API.md`; не имитировать готовый результат.

Runtime owner — `apps/extension/styles/base.css` (Model B). Этот документ отражает его
семантические значения; другой token package/ThemeProvider не добавляется. Mapping:
`colors.X → --color-X`; `typography.display/body → --font-display/body`;
`rounded.panel → --radius-panel`; `spacing.page/section → --space-page/section`.
Потребители — popup и notice. При изменении токенов обновлять CSS и документ вместе.

## Colors

Холодный светлый background, белый surface, тёмный text, muted для пояснений. Primary
только акцент и будущий focus; не означает риск/безопасность. Цвет никогда не единственный
носитель состояния. Border отделяет области; high contrast оставляет системные цвета.
Пока только light theme, без переключателя и удалённых font/theme запросов.

## Typography

Display с округлыми формами для названия/заголовка, system body с поддержкой кириллицы
для доказательств. Body 15px/1.55; заголовок 25px/1.3, основной статус 16px. Никаких
капслок-параграфов. Длинные домены переносить без потери данных. Внешние шрифты не грузить.

## Layout

Popup 380px с max-width 100vw; тестовая узкая ширина 320px. Поля 24px, разделы 28px,
естественный вертикальный скролл. Один заголовок и блок состояния; большой пустой
dashboard не нужен. Дальше #5 добавляет независимые анализ/утечки и устойчивую область
pending/error. Не менять ширину основных кнопок во время загрузки.

## Elevation & Depth

Плоская поверхность, различие через тон и левую отметку, без теней и blur.
Нет всплывающих слоёв в setup. Будущие overlays должны сохранять focus.

## Shapes

Panel radius 12px. Не превращать каждый текстовый фрагмент в pill; факты читаются как
обычный текст с источником. Смысловая отметка 4px не обозначает степень угрозы.

## Components

Notice: h2 + пояснение, без неработающей кнопки. Setup не имеет clickable controls,
forms, selects, tables, toasts или CRUD, поэтому эти capability не применимы.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Scrollbar | styles/base.css | CSS semantic tokens | global baseline, forced colors | browser computed style |

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
- Don't: подменять ноль найденных записей обещанием безопасности.
- Don't: показывать декоративные risk scores или отключённые псевдо-действия.
