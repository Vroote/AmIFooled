# Бейдж при заходе на сайт — проверка для #8

Добровольный режим: при открытии сайта, который пользователь явно разрешил, на сервер
уходит **только hostname**, а на значке появляется число известных утечек этого сайта.
По умолчанию выключено для всех сайтов.

## Что экспортируется

```ts
// apps/extension/lib/navigation.ts
registerNavigationChecks(deps: NavigationDeps): NavigationChecks   // вызывать из background
createNavigationChecks(deps: NavigationDeps): NavigationChecks     // то же без listeners, для тестов
navigableHostname(url: string | undefined): string | null

interface NavigationDeps {
  checkBreaches(hostname: string, signal: AbortSignal): Promise<BreachesResponse>;
  now?: () => number;
}
```

`checkBreaches` — **тот же контракт**, что `PopupController.checkBreaches` из #5.
HTTP выполняет общий клиент из #6.

### Подключение к backend

В `apps/extension/entrypoints/background.ts` зарегистрированы оба обработчика: transport
для ручного popup и opt-in navigation. Они используют один `WXT_API_BASE_URL`:

```ts
registerBackgroundTransport(apiBase);
registerNavigationChecks({
  checkBreaches: (hostname, signal) => requestApi('breaches', { hostname }, signal, apiBase),
});
```

Production popup получает hostname реальной активной вкладки. Разрешение backend host
выдаётся манифестом; доступ к проверяемым сайтам остаётся optional и требует opt-in.
Отключение сайта убирает его настройку и optional grant; обязательное разрешение самого
backend, если его hostname совпал с сайтом, остаётся для ручных API-запросов.
`lib/navigation-fixture.ts` используется только отдельным smoke harness: синтетические
числа для `demo.example`, `localhost` и `127.0.0.1`, `unavailable` для остальных сайтов.

## Opt-in

```ts
// apps/extension/lib/navigation-optin.ts
enableSite(hostname): Promise<'enabled' | 'denied' | 'invalid' | 'limit' | 'unavailable'>
disableSite(hostname): Promise<'disabled' | 'unavailable'>
isEnabled(hostname): Promise<boolean>        // настройка в chrome.storage.local
hasSitePermission(hostname): Promise<boolean> // фактическое разрешение Chrome
```

`enableSite` вызывать **только из пользовательского жеста**: Chrome отклоняет
`permissions.request` без него. Контрол — `components/NavigationOptIn.tsx`, подключён в
popup двумя строками; он принимает необязательный `adapter`, поэтому тестируется без
браузера.

Настройка и выданное разрешение могут разойтись: пользователь вправе отозвать разрешение
в `chrome://extensions`. Поэтому список в storage — это запрос, а решающим перед отправкой
является `hasSitePermission`. Карточка показывает такое состояние отдельно
(«Разрешение отозвано в настройках Chrome»), не выдавая его за работающую автопроверку.

Выключение сначала убирает настройку, потом разрешение: если второй шаг не удался, сайт
уже исключён из проверок, а не остался включённым молча.

## Что уходит и что не уходит

- Уходит только hostname, нормализованный URL-парсером (lowercase, IDNA, без trailing dot).
- Не уходят path, query, fragment, содержимое страницы, cookie, заголовки.
- Инкогнито, не-http(s) схемы и невключённые сайты не отправляют ничего.
- Без host permission Chrome **не отдаёт** расширению `tab.url`, поэтому сайты, которые
  пользователь не включил, этому модулю не видны: истории посещений здесь нет в принципе.
- `permissions` манифеста: `activeTab`, `scripting`, `storage`.
  `optional_host_permissions: ['*://*/*']` только делает origins запрашиваемыми в рантайме
  и сам по себе ничего не выдаёт. `<all_urls>` в `permissions` и статических content
  scripts нет.

## Семантика бейджа

| Ответ | Бейдж | Title |
|---|---|---|
| `ok`, count > 0 | число, >99 как `99+` | число известных инцидентов сайта, не проверка данных пользователя |
| `not_found`, count 0 | `0` | «только отсутствие записи, а не безопасность сайта» |
| `unavailable`, count null, нечисловой count | `?` | «неизвестно — это не „утечек не было“» |
| ошибка, таймаут, чужой hostname в ответе | `?` | то же |

Цвет один и тот же во всех состояниях: он не носитель смысла. Ноль и `?` нигде не
изображаются как «чисто». Детали, источник HIBP и `matched_domain` раскрываются в popup.

## Границы и гонки

- Реагирует на `tabs.onUpdated` со `status === 'complete'`. SPA-переход без смены URL
  не определяется — то же ограничение, что у сборщика в #2.
- Повторные события одной навигации дедуплицируются: пока запрос в полёте, второй не
  уходит.
- Кэш: TTL 10 минут, не больше 32 записей, вытеснение самой старой. Ошибки **не**
  кэшируются, поэтому следующий заход спрашивает заново вместо залипшего `?`.
  Кэш в памяти и после перезапуска MV3 worker пуст; opt-in живёт в storage и не теряется.
- Каждому ответу соответствует токен навигации. Если вкладка успела уйти на другой сайт,
  закрылась, или ответ пришёл про другой hostname — бейдж не ставится.
- Таймаут запроса 8 секунд.
- Список включённых сайтов ограничен 50 записями.

## Проверки

```sh
npm ci
npm run lint
npm run typecheck
npm test          # 97 Vitest tests, из них 38 на навигацию, бейдж, opt-in и карточку
npm run test:popup
npm run build
```

Покрыто unit-тестами: отсутствие opt-in, отозванное разрешение, инкогнито, запрещённые
схемы, IDNA, дедупликация, TTL и вытеснение кэша, отказ в разрешении, частичное
отключение, гонка «ответ пришёл для другой вкладки/другого сайта», закрытая вкладка,
`unavailable` при HTTP 200, некэширование ошибок, падение самого `setBadgeText`.

### Ручной сценарий в Chrome — **не выполнен автором PR**

Установка unpacked MV3 расширения в окружении автора недоступна, поэтому сценарий ниже
описан, но не пройден. Его нужно выполнить перед закрытием #7.

Для воспроизводимых чисел без сети используйте отдельный harness ниже. Он определяет
реальную активную вкладку и использует production opt-in/navigation с fixture-провайдером.
Production-сборка также определяет настоящую вкладку, но запрашивает backend: числа там
зависят от источника HIBP и не обязаны совпадать с шагами ниже. Полный live-сценарий с
backend нужно отдельно пройти по `docs/START.md` и `docs/INTEGRATION.md`.

```sh
npx wxt build apps/extension/tests/navigation-smoke
python3 -m http.server 8765 --bind 127.0.0.1 --directory apps/extension/tests/collector-smoke/site
```

`chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/.output/navigation-smoke/chrome-mv3`. В списке оно называется
**AmIFooled navigation smoke**; его стоит удалить после проверки. Путь содержит скрытую
папку `.output`: в диалоге Chrome скрытые папки показываются по `Cmd+Shift+.`.

1. Открыть `http://localhost:8765` → значок без бейджа. В popup вверху должно стоять
   «Активная вкладка: localhost», а карточка «Проверять этот сайт при открытии» —
   в состоянии «Выключено», с текстом, что уйдёт только `localhost`.
2. Нажать «Включить для этого сайта» → Chrome спросит разрешение на `*://localhost/*`.
   **Отказать** → карточка остаётся «Выключено», появляется сообщение, что ручная
   проверка продолжает работать. Бейджа нет.
3. Нажать снова и **разрешить** → карточка «Включено для этого сайта». Перезагрузить
   страницу → бейдж `2` (fixture), title про каталог HIBP.
4. Открыть во второй вкладке `http://127.0.0.1:8765` → включить и разрешить → бейдж `0`,
   в title «только отсутствие записи, а не безопасность сайта». Бейджи у вкладок разные.
5. Перейти в первой вкладке на любой внешний https-сайт → бейдж очищается (сайт не
   включён, Chrome даже не отдаёт URL). Вернуться на `localhost` → бейдж `2` снова.
6. Нажать «Отключить и убрать разрешение» → Chrome убирает разрешение. Перезагрузить
   страницу → бейджа нет, запрос не уходит.
7. Проверить окно инкогнито (если расширение там разрешено) → бейджа нет.
8. Перезапустить service worker в `chrome://extensions` → включённый сайт после
   перезагрузки страницы снова получает бейдж: opt-in взят из storage.

Harness не делает HTTP-запросов ни на одном шаге. При повторении на production-сборке
без отдельных ручных проверок в popup: шаги 1, 2, 5, 6 и 7 не отправляют запросов,
а шаги 3–4 отправляют только hostname в `/v1/breaches`, без пути/query посещаемой страницы.
