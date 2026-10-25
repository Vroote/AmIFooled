# Сборщик страницы — handoff для #5/#6

`apps/extension/lib/collector.ts` экспортирует:

```ts
collectPageEvidence(policy?: PolicyInput): Promise<CollectionResult>
type PolicyInput = { source: 'selection' } | { source: 'manual'; text: string };
```

Вызов без аргумента читает выделенный текст. Вызывать из popup после явного действия
пользователя на активной странице. Импорт модуля ничего не запускает. Никаких fetch,
storage, navigation listeners, content scripts, permission probes/prompts нет.
`activeTab` + `scripting` — единственные permissions production manifest. Код не
запрашивает `tabs`, `cookies`, `<all_urls>` или host_permissions. Popup и background
подключает #6; в этом PR рабочий popup ещё показывает исходный setup.

| status | Данные | Действие интеграции |
|---|---|---|
| `ready` | `payload: AnalysisRequest`, `notices: string[]` | Показать собранное, источник/ограничения; отправить **только payload** после подтверждения публичности политики |
| `needs_policy` | `observations: {hostname,evidence}`, `reason: empty / blocked_selection`, `notices` | Предложить выделение публичного текста или ручной ввод; API пока не вызывать |
| `error` | `code`, безопасное `message` | Показать сообщение, дать повторить; не подставлять пустой «безопасный» результат |

`error.code`: `no_active_tab`, `unsupported_page`, `incognito`, `page_changed`,
`access_denied`, `timeout`, `unavailable`. На повторном клике #6 должен сбрасывать старый
результат и не показывать его как ответ новой вкладки. Snapshot проверяет URL/active/
pendingUrl после injection; переходы SPA без изменения URL не определяются. Таймаут —
5 с; уже выполняющийся Chrome injection отменить нельзя, его поздний результат игнорируется.

## Что наблюдается

- Только главный frame, `ISOLATED` world. HTTP(S); внутренние страницы, Chrome Web Store,
  `file://`, IPv6 (не поддержан текущим API hostname), incognito недоступны.
- Первые 1 000 Resource Timing entries, максимум 200 уникальных отличающихся hostname;
  максимум 100 фактов в payload. Cookie count занимает один слот, если доступен.
- URL parser нормализует IDNA/регистр. `tldts` с private suffixes сравнивает регистрируемые
  домены: `cdn.example.com` свой для `www.example.com`; `two.github.io` сторонний для
  `one.github.io`. Это граница доменов, не доказательство разных владельцев/трекеров.
- Cookie names/values и пути/query/fragment ресурсных URL сворачиваются внутри страницы,
  до возврата через scripting API. Возвращается только JS-visible count. При ошибке count
  отсутствует, это не ноль. HttpOnly не видны; полного списка third-party/partitioned
  cookies нет. Resource Timing также не является полной историей сети. Каждое evidence
  содержит limitation; отсутствие наблюдения не доказывает безопасность.
- Читается только выделение или явно введённая публичная политика. DOM целиком,
  input/textarea/select, формы и contenteditable не читаются. Выделение, пересекающее форму
  или редактор, отклоняется целиком. Shadow DOM/недоступное выделение может дать empty.
- Политика — plain text, до 20 000 UTF-16 units (без разрыва surrogate pair), без исполнения
  HTML. Обычные/Unicode email маскируются, URL со схемой и `www.` сводятся к hostname,
  невидимые управляющие символы удаляются. Это минимизация данных, **не универсальный
  детектор персональных данных**: не вставляйте личные документы. Обфусцированные email,
  имена, телефоны и произвольный секрет в публичном тексте автоматически не распознаются.
  Точные цитаты backend должны относиться к отправленному очищенному фрагменту.

## Синтетический пример payload

```json
{
  "hostname": "www.example.com",
  "policy_text": "Fixture public policy: cookies are used. Contact [email скрыт]",
  "evidence": [
    {
      "id": "visible-cookies",
      "kind": "visible_cookie_count",
      "value": "2",
      "limitation": "Только количество cookies, доступных document.cookie в главном документе. HttpOnly не видны; это не полный учёт partitioned или сторонних cookies."
    },
    {
      "id": "resource-1",
      "kind": "resource_domain",
      "value": "stats.example.net",
      "limitation": "Resource Timing — неполное наблюдение главного документа, не история сети. Другой регистрируемый домен не доказывает трекинг, другого владельца или нарушение."
    }
  ]
}
```

`AnalysisRequest`/`Evidence` взяты из `api.generated.ts`; API schema не менялась.
Идентификаторы evidence уникальны внутри запроса, не предназначены для сопоставления истории.
`notices`/`reason`/`status` — локальный интерфейс, в strict API body их включать нельзя.

## Проверки и ручной Chrome smoke

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Unit suite проверяет минимизацию, limits, IDNA/PSL, пустую/длинную политику, формы,
запретные страницы, отказ injection, таймаут и смену вкладки. `npm test` включён в CI.
Отдельный тестовый popup не входит в production entrypoints и ничего не отправляет:

```sh
npx wxt build apps/extension/tests/collector-smoke
python3 -m http.server 8765 --bind 127.0.0.1 --directory apps/extension/tests/collector-smoke/site
```

В Chrome Developer mode загрузить unpacked `apps/extension/.output/collector-smoke/chrome-mv3`.
Открыть `http://127.0.0.1:8765`; страница создаёт только синтетические fixture cookies.
Ресурс с `localhost:8765` нужен для проверки другого hostname без внешней сети.

1. Нажать значок **AmIFooled collector smoke** → «Собрать с ручным текстом».
   Ожидается ready, hostname `127.0.0.1`, cookie count `2`, ресурс `localhost`.
   В результате нет COOKIE_SECRET/PRIVATE VALUE, имён cookies, URL paths/query или email.
2. Закрыть popup; на странице нажать «Выделить публичную политику»; открыть popup →
   «Собрать выделение». Ready, только выбранная политика, email замаскирован.
3. На странице нажать «Выделить всё, включая форму» → в popup собрать выделение.
   Ожидается needs_policy / blocked_selection, никакого form content.
4. Снять выделение → needs_policy / empty. Ввести в ручное поле длинный публичный текст
   → ready с policy_text ≤20 000 и notice о сокращении.
5. Открыть `chrome://settings`, Chrome Web Store и `file://` → error / unsupported_page.
6. В manifest проверить только activeTab+scripting; при открытии страницы сбор не идёт.

После проверки удалить только тестовое расширение; обычную production сборку подключит #6.
Фактически выполненные браузерные сценарии и ограничения среды записываются в PR.

Источники: [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[tldts private suffixes](https://github.com/remusao/tldts#usage).
