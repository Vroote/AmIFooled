# Запуск и первая задача

Проверено для Node 22 и Python 3.12. PostgreSQL, Redis, Docker, платный API и ключ не нужны
для запуска каркаса. Это ещё не завершённый MVP: health и HIBP breaches API работают,
analyze возвращает 501 до выполнения #3, popup показывает состояние подготовки.

## Получить код

Основная ветка получит setup после независимого approve и merge. До этого:

```sh
gh repo clone Vroote/AmIFooled
cd AmIFooled
git switch chore/agent-hackathon-setup
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
Интерактивный контракт: http://127.0.0.1:8000/docs . Ключ LLM понадобится только для
опционального provider в #3; формат показан в `apps/api/.env.example`. Сейчас .env API
автоматически не загружается; provider должен явно документировать загрузку. Не вставляйте
ключ в WXT-переменные: они попадают в браузерную сборку.

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
До #6 backend и popup намеренно не соединены, данные страниц не собираются.
В #6 будет подключён `WXT_API_BASE_URL`; `.env.example` в extension — только описание.

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
