# Запуск и первая задача

Для организаторов: [Docker-запуск backend и сборка ZIP расширения](DOCKER.md)
без установки Python и Node.js на компьютер.

Проверено для Node 22 и Python 3.12. PostgreSQL, Redis, Docker, платный API и ключ не нужны
для запуска. Ручной popup соединён с collector, HIBP API и анализом. Автоматический opt-in
бейдж и итоговая приёмка выполняются отдельно в #7/#8.

## Получить код

Каркас и backend находятся в main:

```sh
gh repo clone Vroote/AmIFooled
cd AmIFooled
git switch main
```

На машине, где подготовлен setup, исходный clone найден в `~/PycharmProjects/AmIFooled`
(в указанном `~/Documents/PycharmProjects/AmIFooled` его нет). Исходный `.idea/` сохранён.
Worktree setup находится в отдельной папке проекта Codex; исходный main не переключался.

## Backend — первый терминал, из корня repo

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements-dev.lock
.venv/bin/python -m pip install --no-deps -e apps/api
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --no-access-log
```

Проверка: `curl http://127.0.0.1:8000/health` → `{"status":"ok"}`.
Интерактивный контракт: http://127.0.0.1:8000/docs . Без серверного ключа анализ работает
по детерминированным правилам. Подключение DeepSeek описано ниже. Не вставляйте ключ
в WXT-переменные: они попадают в браузерную сборку.

## DeepSeek — опциональный анализ соглашения и cookies

Оплаченный ключ хранится только на сервере. Можно создать локальный игнорируемый git
файл `apps/api/.env` по `.env.example` и заполнить ключ в редакторе. Файл автоматически
не загружается: перед запуском backend явно экспортируйте его переменные:

```sh
set -a
. apps/api/.env
set +a
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

По умолчанию `LLM_BASE_URL=https://api.deepseek.com`, `LLM_MODEL=deepseek-flash`,
`LLM_TIMEOUT_SECONDS=12`. Base с `/v1` также поддерживается. Для другого совместимого
провайдера указывайте API base (например `https://provider.example/v1`): к нему добавляется
только `/chat/completions`. DeepSeek вызывается без thinking/tools, без streaming и
автоматических повторов; весь анализ ограничен 15 секундами. Модель можно сменить через env.

Проверка с реальным API (до трёх платных запросов, только синтетические документы):

```sh
.venv/bin/python scripts/smoke-deepseek.py
```

Скрипт берёт ключ из env либо запрашивает скрытым вводом, проверяет FastAPI endpoint
внутри процесса и реальную сеть до DeepSeek. Выводит модель, latency, режим и проверки
цитат/IDs, не ключ или сырой ответ провайдера. При недоступности прекращает запросы.
Это отдельная ручная проверка; pytest отключает ключ окружения и не расходует баланс.
Проверка полного пути из Chrome остаётся в #6/#8.

В `/v1/analyze` поле `policy_text` принимает один подтверждённый пользователем документ:
соглашение, политику или текст раздела cookies. DeepSeek выделяет условия с цитатами и
сопоставляет их с переданными наблюдениями. Без наблюдений ответ остаётся
`status=insufficient_data`, но может содержать замечания к самому документу; поведение
сайта в этом случае не проверено. 401/402/429, timeout или непроверяемый JSON сохраняют
`mode=rules` с пояснением. Ни отсутствие замечаний, ни ноль cookies не означают безопасность.

## Расширение — второй терминал, из корня repo

```sh
npm ci
npm run dev
```

WXT запускает Chrome с расширением. Для ручной загрузки/демо:

```sh
npm run build
```

В `chrome://extensions` включите Developer mode → Load unpacked →
`apps/extension/.output/chrome-mv3`. Нажмите значок AmIFooled.
Popup по умолчанию использует реальный backend http://127.0.0.1:8000. Для другого адреса
задайте WXT_API_BASE_URL в apps/extension/.env или окружении сборки и пересоберите расширение;
manifest автоматически получает permission конкретного backend host. Ключ LLM — только
на сервере. Соглашение ищется автоматически; запасной вариант — ссылка, не полный текст.
[Границы автопоиска](POLICY-DISCOVERY.md). Полный сценарий, отмена и MV3 restart: [INTEGRATION.md](INTEGRATION.md).

## Агенту

После merge setup: «Возьми issue #2 в Vroote/AmIFooled. Прочитай AGENTS.md, зависимости и
comments; заяви CLAIM, создай отдельный worktree, выполни AC, прогони проверки и открой PR
с Closes #2. Запроси одного независимого reviewer. Не обходи merge gates».

Reviewer: «Проверь PR #N на текущем HEAD по AGENTS.md и AC исходного issue. Не правь ветку
автора. Сообщи конкретные дефекты через inline review/comments. При готовности поставь
approve под своим GitHub identity с Write; иначе request changes».

После claim/review/merge: `python3 scripts/project-sync.py`. Нужен `gh auth refresh -s project`
и Write-доступ к Project. Список ссылок: `docs/issues.json`.

## Если git по SSH не работает

Для нового clone используйте `gh repo clone` после `gh auth setup-git`, либо HTTPS.
Не меняйте remote другого агента. Одноразовый fetch без изменения remote:

```sh
git -c credential.helper='!gh auth git-credential' fetch https://github.com/Vroote/AmIFooled.git main
```

Зависимости зафиксированы в npm lock и Python requirements-dev.lock. Обновляя Python deps,
пересоздайте чистое venv, установите изменённый `apps/api[dev]`, выполните `pip freeze
--exclude-editable` и review diff lockfile. Не добавляйте локальные пути в lockfile.
