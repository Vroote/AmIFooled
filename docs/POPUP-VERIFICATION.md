# Popup: исправления review #15

Транспорт по-прежнему задаётся через PopupController. Production entrypoint использует
помеченный demo controller; подключение реального collector/backend выполняется в #6.

## Границы ответа

- `action.hostname` проверяет, относится ли завершившийся запрос к текущей странице.
  Поздний результат другого запроса игнорируется.
- `data.hostname` дополнительно обязан совпасть с hostname запроса. Иначе только эта
  карточка получает failed/malformed с возможностью повторения; чужие данные не выводятся.
- `matched_domain` не сравнивается с hostname: различие допустимо после PSL-нормализации.
- HTTP 200 с `status=unavailable` сохраняет источник и время проверки, но общий статус
  становится failed либо partial, если другая карточка содержит результат.
- Текст об отсутствии записей показывается для not_found. Unavailable означает неизвестный
  результат, а не ноль; независимая карточка анализа остаётся видна.

## Автоматические проверки

`npm test` запускает collector и component render tests, включая unavailable/not_found
и недоступный анализ. `npm run test:popup` запускает reducer tests, включая сочетания
unavailable, чужой data.hostname при корректном action.hostname и допустимый matched_domain.
Оба скрипта включены в CI. Новых зависимостей исправления не добавляют.

Локально после объединения с main: 38 Vitest tests, 21 popup state tests, 137 backend
tests; lint/typecheck/build, Ruff и regeneration без drift — passed.

## Проверка в настоящем Chrome

25 октября 2026: отдельный headless Google Chrome, временный профиль, Vite production
build временного harness, импортирующего настоящий App и base.css этой ветки. Controller
возвращал только synthetic fixtures, внешних запросов к сервисам не было. Это проверка
popup UI; реальный Chrome extension transport в #6 ею не заменяется.

Длинный допустимый hostname для воспроизведения:

```ts
const hostname = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'example'].join('.');
```

Проверены ширины 320, 380 и 420px: idle, HTTP 200 unavailable, затем независимый успешный
анализ. Во всех случаях documentElement.scrollWidth <= clientWidth; переносы видны в
общей строке состояния, preview payload и карточке утечек. Tab из textarea переводит
фокус на «Отправить и сверить», outline 3px, Enter запускает анализ. После результата
общий статус partial, текст о неизвестном числе утечек и retry остаются доступны.

Дополнительно обе карточки получили typed ответы с data.hostname='other.example' при
корректном hostname запроса: каждая показала malformed, чужие данные не появились.
Not_found отдельно показал отсутствие совпадений, а не unavailable. Ошибок JavaScript нет.

Снимок 320px: `screenshots/popup/fix-unavailable-long-320.png`, данные синтетические.
