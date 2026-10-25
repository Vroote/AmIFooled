# Ручная проверка: Chrome → background → FastAPI

Обычный popup использует createRealController. Demo controller не подключён в entrypoint,
query `?demo=...` не подменяет реальные ответы. Открытие popup собирает ограниченные
наблюдения локально; ручной HTTP начинается по отдельной кнопке анализа или утечек.
После opt-in для конкретного сайта navigation badge отдельно проверяет его hostname
при открытии. Этот режим выключен по умолчанию; сценарий — `docs/NAVIGATION.md`.

## Запуск

1. Запустите FastAPI по START.md. По умолчанию — http://127.0.0.1:8000, без БД.
   Опциональный DeepSeek включается только серверными LLM_* переменными.
2. При другом адресе задайте публичный WXT_API_BASE_URL в apps/extension/.env либо окружении
   процесса сборки. Затем `npm run build` и заново загрузите unpacked extension из
   apps/extension/.output/chrome-mv3. Ключи в WXT_* помещать нельзя.
3. На обычном HTTP(S)-сайте нажмите значок расширения. Вставьте публичную политику либо
   выделите её на странице и нажмите «Взять текст с открытой страницы».
4. Проверьте текст и состав отправки. Если ручной текст содержал email/URL/control chars,
   первое нажатие только показывает очищенную версию; отправка требует повторного нажатия.
   Анализ и утечки запускаются отдельно и не скрывают ошибки друг друга.

Пример другого локального порта: backend `--port 18006`, build с
`WXT_API_BASE_URL=http://127.0.0.1:18006 npm run build`.

## Границы и отмена

HTTP выполняется только в background. Endpoint и origin фиксированы при сборке;
runtime messages не принимают произвольные URLs. По умолчанию host permission только
`http://127.0.0.1/*`; HTTPS разрешён для конкретного заданного backend host. HTTP вне
loopback, credentials/query/fragment в API base отвергаются при сборке. Match pattern
разрешает порты этого хоста, но fetch всегда использует конкретный порт API base.
CORS backend не расширялся: privileged extension fetch с host permission работает без
preview-origin. Обычный веб-preview не поддерживается реальным контроллером.

Канал runtime.Port разрешён только собственному popup; content scripts и посторонние
extension pages не могут вызвать транспорт. Payload содержит только hostname, выбранный
публичный policy_text и исходные ограниченные evidence, показанные в popup. Подмена evidence
после prepare отклоняется. Cookies values/names, DOM и URL paths/query не уходят в API.

Контекст порта содержит tabId и Chrome documentId. Навигация, включая reload на том же
hostname, смена вкладки и disconnect инвалидируют контекст и отменяют HTTP. Документ
дополнительно проверяется до/после запроса; поздний ответ не заменяет результат новой
генерации. Смена документа сбрасывает обе карточки и текст. Нажатие «Обновить контекст
проверки» получает свежие факты без автоматической повторной отправки политики.

Пока popup открыт и его Port подключён, локальный ping/pong раз в 15s удерживает worker
от обычного idle shutdown. Heartbeat не читает страницу, не обращается к API и не меняет
контекст/карточки. При disconnect или закрытии popup interval удаляется; worker снова
может штатно уснуть. Принудительное завершение worker и реальная навигация по-прежнему
инвалидируют контекст, чтобы не присвоить старые данные новому документу.

HTTP deadline — 16s, background operation — 19s, popup request — 20s; AbortSignal и закрытие
порта отменяют сетевой запрос. Даже adapter, игнорирующий AbortSignal, не оставляет spinner.
Параллельный повтор analyze/breaches не делает второй HTTP-запрос. MV3 restart не требует
восстановления in-memory cache: pending завершаются ошибкой, затем пользователь явно
обновляет контекст. Никакие документы/результаты автоматически не сохраняются.

Ответы JSON проверяются runtime: типы, hostname, status/count, источник/ссылки HIBP, цитаты
и evidence IDs. Body ограничен 2 MiB. 501/422/413/5xx, malformed и offline различаются;
unavailable не превращается в ноль. API v1 и его генерации не изменены.

## Фактически выполненный smoke

25 октября 2026: production unpacked MV3 в отдельном Chrome-профиле (headless и обычное окно). Настоящее
действие расширения запускалось через CDP Extensions.triggerAction с activeTab grant.
Страница — локальная синтетическая fixture на reserved example.com, cookies/форма/query
содержали только synthetic markers. FastAPI на loopback:18006, без БД, без fixture adapter.

- Полный путь collector → port → background HTTP → FastAPI → платный DeepSeek deepseek-flash:
  mode=llm. Три платных вызова: 1.55s, 1.537s и финальный 1.673s. Ключ вводился скрыто только в память серверного процесса;
  в файлы, .env, Git, сообщения PR или bundle не записывался.
- Независимый HIBP lookup: not_found/count=0, matched_domain=example.com, источник и дата.
- После принудительного ServiceWorker.stopAllWorkers старые результаты сброшены; явное
  обновление контекста восстанавливает работу без повторного платного вызова.
- Настоящий background Network trace: один POST на вызов; в body отсутствуют synthetic
  markers cookies/form/query. Worker network offline даёт отдельную ошибку утечек и
  сохраняет успешный анализ. Навигация на том же hostname инвалидирует popup.
- Начальное сжатие нативного action popup исправлено minimum width 320px; в конечном
  Chrome UI body/viewport=320, горизонтального overflow нет. Снимок сделан в обычном окне.

Снимок: screenshots/integration/real-paid-deepseek.png. Это реальный UI/HTTP smoke на
синтетической странице, не fixture response. Semantic качество всех документов этот
smoke не гарантирует; полная acceptance matrix и opt-in навигация остаются #8/#7.

Автотесты: 65 Vitest tests, 21 popup tests, 164 backend tests; lint/typecheck/build и Ruff passed.
Все внешние HTTP/Chrome вызовы в unit tests замоканы; paid smoke запускается отдельно.

Повторный idle smoke после review #22: native Chrome, без DevTools/Playwright auto-attach
к worker. Через 35s и 70s простоя сохранены введённая политика, реальный HIBP результат и
тот же активный worker. После закрытия popup worker штатно остановился через 35s.
Платный LLM для этой проверки не вызывался. Для воспроизведения не подключайте debugger
к worker: он может скрыть обычный idle shutdown. Основание heartbeat:
[Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome-114).
