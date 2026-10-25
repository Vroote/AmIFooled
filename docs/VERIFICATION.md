# Проверки setup

Локально на macOS, Node 22.23.1, Python 3.12, 25 октября 2026:

- `npm ci` / lockfile install: успешно, npm audit 0 vulnerabilities на момент установки.
- `npm run lint`, `npm run typecheck`, `npm run build`: успешно.
- Сгенерированный manifest имеет version 3, service worker и popup. Permissions и
  host_permissions отсутствуют: каркас не собирает и не отправляет данные сайтов.
- `ruff check apps/api scripts` и `ruff format --check apps/api scripts`: успешно.
- `pytest apps/api/tests -q`: **12 passed**. FastAPI/Starlette выдаёт non-blocking
  deprecation warning о будущем переходе TestClient с httpx на httpx2.
- Реальный HTTP `GET /health` у запущенного Uvicorn: 200 `{"status":"ok"}`.
- OpenAPI/TS regeneration выполнена; CI также проверяет отсутствие drift.
- Собранный popup открыт в браузере: текст, русские заголовки, честное пустое состояние.
  Проверены 380px и viewport 320×640: body/content width 320, horizontal overflow отсутствует,
  computed scrollbar-color использует системные токены проекта. Кнопок/форм в setup нет.
- Это проверка HTML popup preview, **не** полный unpacked-extension acceptance test.
  Полный Chrome/MV3 flow и service-worker restart входят в #6–#8 после реализации функций.
- DESIGN.md lint: 0 errors, 3 advisory unused token warnings; static UI audit: 0 findings.
- Поиск паттернов токенов/private keys не нашёл секретов в файлах.
- Исходный README сохранён, добавлен только раздел ссылок. Параллельный commit main
  `65aec0b` (пунктуация в README) включён через fast-forward; изменение команды сохранено.
- Исходный clone и незакоммиченные `.idea/` не менялись; setup выполнен в отдельном worktree.

GitHub: 10 issues, milestone, метки, реальные blocked-by dependencies; Project заполнен,
4 поля добавлены, существующий board view сохранён. Ruleset creation вернул 404 при
Write/admin=false; секрет PROJECT_TOKEN отсутствует. Эти ограничения вынесены в #10.
Итог удалённого CI и review смотреть в setup PR; локальные проверки не заменяют approve.
