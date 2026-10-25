---
version: alpha
name: AmIFooled
description: Компактная проверка сайта — локальные наблюдения, документ и краткая сводка.
colors:
  primary: "#196c61"
  background: "#f3f5f4"
  surface: "#ffffff"
  text: "#233c37"
  muted: "#60716b"
  border: "#dce4df"
  tint: "#eaf2ed"
  attention: "#8b581c"
  attention-background: "#fff4e2"
typography:
  display:
    fontFamily: "'Avenir Next', 'Trebuchet MS', sans-serif"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
rounded:
  panel: "16px"
  popup: "22px"
spacing:
  page: "20px"
  section: "16px"
components:
  notice: {}
---

# AmIFooled design context

## Overview

Русскоязычное расширение для быстрого просмотра фактов о текущем сайте. Решение #25:
пользователь попросил интерфейс в духе AdBlock, меньше текста, счётчики и последовательность
«Найти соглашение → ссылка → Проверить → короткая сводка». Это заменяет автоматический
поиск при открытии popup из #23. Сразу и после нахождения документа видна альтернатива «Вставить свою ссылку». Клик на поиск загружает документ локально; отдельное
нажатие «Проверить» подтверждает отправку. Не смешивать discovery и анализ.

North Star — небольшой прибор для проверки сайта. Имя сайта, две равные плитки с крупными
числами, одна основная кнопка; спокойный зелёный акцент и тёплая отметка известных утечек.
Без выдуманного security score, маркетингового заголовка и зелёной оценки безопасности.
Длинные пояснения доступны в нативных раскрываемых деталях. Результат — короткая сводка
и до трёх заголовков замечаний; остальное раскрывается, а не исчезает из ответа.

Обычный popup использует реальный background/API. Demo controller предназначен только
для тестов и помечает синтетические данные. Анализ и утечки независимы; смена документа
сбрасывает только анализ, навигация сбрасывает всё и отменяет pending requests.

## Runtime ownership

`apps/extension/styles/base.css` — canonical runtime (Model B). DESIGN.md отражает его
семантические токены: `colors.X → --color-X`, `typography.display/body → --font-display/body`,
`rounded.panel/popup → --radius-panel/popup`, `spacing.page/section → --space-page/section`.
При изменении CSS обновлять этот документ; отдельный ThemeProvider/token pipeline не нужен.
Потребители — popup и notice. Не дублировать эти значения в локальных стилях компонентов.

## Colors

Светлый серо-зелёный фон, белые рабочие поверхности, тёмные чернила. Primary обозначает
действие/ссылку/focus, не уровень безопасности. Amber означает «требует внимания» или
известный инцидент; рядом всегда текст/число. Unknown отображается «—», а не нулём.
`not_found` означает только отсутствие совпадений в HIBP. Цвет не заменяет смысл.
Light theme, без внешних шрифтов и удалённых ресурсов; forced-colors использует системные
рамки и scrollbar. Рамка плитки внимания #ead9bb — локальный декоративный тон, не статус.

## Typography

Avenir Next/Trebuchet для бренда, hostname и цифр; системный шрифт с кириллицей для текста.
Body 14px/1.5, заголовок сайта 22px/1.25, счётчик 34px с tabular-nums, управляющий текст
12–14px, вспомогательные подписи 10–11px. Числа/даты ru-RU. Домены и длинные заголовки
переносятся, полный адрес документа остаётся ссылкой. У сокращённой сводки есть раскрытие.

## Layout

Popup шириной 400px, min-width 320px, max-width 100vw. Две колонки счётчиков сохраняются
на 320px. Поля 20px, ниже 360px — 16px. Между разделами 16px. Начальный экран содержит
сайт, счётчики, поиск и свёрнутые настройки. После загрузки документа — источник и кнопка
проверки; после ответа — сводка. Общий контейнер popup скруглён на 22px и ограничен 600px по высоте; длинный результат
прокручивается внутри него, сохраняя скругления сверху/снизу. Прозрачные html/body не
закрашивают углы прямоугольным фоном; нативная рамка окна остаётся под управлением Chrome.
Дополнительная прокрутка только у ограниченного 180px read-only текста документа.

## Elevation & Depth

Плоские поверхности и тонкие рамки без blur/градиентов/декоративных теней. Вертикальный
акцент только на активной карточке соглашения. Скругления панелей 16px, кнопок 10px.
Маленькие локальные SVG в одном штрихе дополняют подписи, всегда aria-hidden.

## Components

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Scrollbar | styles/base.css | semantic scrollbar tokens | global, forced colors | browser + static audit |
| Button | components/ActionButton.tsx | `.action` | primary, secondary, icon, busy | keyboard, pending tests |
| Card | components/CardShell.tsx | `.card` | analysis, breaches, unsupported | independent result/error states |
| Field | components/PolicyForm.tsx | `.field__*` | URL fallback, read-only preview | validation, focus, retries |
| Counters | components/SiteStats.tsx | `.site-stats`, `.stat` | local cookies, automatic HIBP + retry | unknown vs zero tests |
| Disclosure | native details/summary | `.disclosure`, detail classes | source, evidence, settings | keyboard and browser |
| Icon | components/Icon.tsx | shared local SVG paths | decorative beside text | accessible names remain text |

Нативная кнопка проверки HIBP использует компактный `.text-button` внутри SiteStats;
она не эквивалент full-width основному действию. Настройки остаются NavigationOptIn,
только свёрнуты: согласие, отзыв разрешения и отдельные ошибки не меняются.

Форма URL использует noValidate, label/aria-describedby, inline ошибки, сохранение ввода
и focus на невалидном поле. Публичный источник виден перед анализом. Краткая подпись
рядом с кнопкой объясняет отправку текста и наблюдений; перечень payload/preview раскрывается.
Обрезка длинного документа видна сразу. Цитаты, evidence IDs/ограничения и метод проверки
доступны в деталях, точный текст не изменяется ради краткости.

## Motion & Accessibility

Hover 160ms, стрелка сдвигается на 3px, spinner только во время ожидания. Reduced-motion
полностью отключает анимацию и переходы; текст ожидания остаётся. Нативные button/a/details,
видимый focus 3px, no icon-only actions. Размер busy кнопки и текст остаются стабильными.
Не заменять status/error цветом. Результаты/загрузка/ошибки объявляются через status/live
regions; idle анализ не занимает отдельную пустую карточку.
Scrollbar общий: thumb/track/hover/active tokens, standard + WebKit, forced-colors → auto.

## Do's and Don'ts

- Показывать только наблюдаемое количество cookies (без HttpOnly), отсутствие данных ≠ 0.
- По прямому запросу пользователя #25 запрашивать HIBP автоматически после определения сайта при открытии popup. Отправляется только hostname; кнопка остаётся для повтора. Фоновая проверка при навигации сохраняет отдельный opt-in.
- Поиск и отправка документа — два отдельных действия. URL fallback вместо вставки текста.
- Не называть document-only warning доказанным нарушением. Отсутствие сигнала ≠ безопасность.
- Не скрывать ошибки проверки, частичные данные, truncation или demo/stale метки.
- Сохранять доступ к полному ответу, источникам, цитатам и ограничениям через раскрытие.
- Не добавлять новые permissions, backend endpoints или библиотеки ради декора.
