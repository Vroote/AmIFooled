# Запуск для организаторов через Docker

Нужны Git, Chrome/Chromium и работающий Docker с Compose v2+ и BuildKit.
На Windows/macOS подойдёт Docker Desktop с Linux containers; на Linux — Docker Engine
с плагинами Compose и Buildx. Python, Node.js, БД и платный ключ на компьютере не нужны.
Первой сборке нужен интернет для скачивания образов и зависимостей.

Backend запускается в контейнере, расширение устанавливается в обычный Chrome на компьютере.
Backend проверяет текст по правилам или через серверный DeepSeek и ищет утечки через HIBP.
Ручной путь «текущая страница → API → popup» подключён в #6; ZIP использует настоящий
контроллер. Автоматический opt-in бейдж — #7, финальная приёмка — #8. Ручной Chrome smoke
и ограничения описаны в [INTEGRATION.md](INTEGRATION.md).

## 1. Получить код и запустить API

У репозитория должен быть доступ для организаторов; пока он private, выдайте Read-доступ
или передайте архив исходников согласованной версии. Из корня полученного репозитория:

```sh
git clone https://github.com/Vroote/AmIFooled.git
cd AmIFooled
docker compose up --build -d --wait
```

Если исходники уже скачаны, выполните только последнюю команду в их корне.
`.env` создавать не обязательно: без ключа работает `mode=rules`.
Откройте http://127.0.0.1:8000/health — ожидается `{"status":"ok"}`.
В http://127.0.0.1:8000/docs доступны ручные запросы API.

```sh
docker compose ps
docker compose logs --tail 50 api
docker compose down
```

Последняя команда останавливает этот Compose-проект. Базы и постоянных томов нет.
API слушает `0.0.0.0:8000` внутри контейнера, но опубликован только на `127.0.0.1`
компьютера. Процесс работает от UID 10001, healthcheck проверяет `/health`,
Compose ожидает его готовности. Access log отключён, текст политики не логируется.

## 2. Собрать расширение без Node.js

В корне репозитория, одной строкой (подходит также для PowerShell):

```sh
docker build --file apps/extension/Dockerfile --target export --output type=local,dest=./dist .
```

Результат:

- `dist/chrome-mv3/` — готовая папка расширения;
- `dist/amifooled-chrome.zip` — ZIP для передачи организаторам.

Откройте `chrome://extensions`, включите **Developer mode**, нажмите **Load unpacked**
и выберите `dist/chrome-mv3`. Если получили ZIP, сначала распакуйте его и выберите папку,
в которой лежит `manifest.json`. Закрепите AmIFooled на панели Chrome.
После обновления исходников пересоберите расширение и нажмите Reload на его карточке.

В GitHub Actions у зелёного запуска CI есть artifact `docker-chrome-mv3` с обоими файлами.
Его можно скачать и передать организаторам: отдельная сборка на их компьютере тогда не нужна.
Архив Actions — внешняя упаковка: распакуйте его, затем выберите вложенную папку `chrome-mv3`.

После интеграции #6: откройте обычный HTTP/HTTPS сайт, запустите проверку в popup,
выберите публичную политику/соглашение или вручную вставьте его текст и подтвердите отправку.
На `chrome://…`, страницах магазина расширений и других защищённых страницах сбор недоступен.
Автоматическая загрузка политики может быть ограничена сайтом — используйте ручной текст.
Не вставляйте личную переписку, пароли и данные форм. Автоматический бейдж #7 включается
отдельно для выбранных сайтов. Отсутствие известных утечек или замечаний не гарантирует безопасность.

## 3. Включить DeepSeek при необходимости

Скопируйте корневой `.env.example` в `.env` и заполните `LLM_API_KEY` локально в редакторе.
На macOS/Linux: `cp .env.example .env`; в PowerShell: `Copy-Item .env.example .env`.
Compose читает именно корневой `.env`, файл `apps/api/.env` сюда автоматически не подключается.
Затем снова выполните:

```sh
docker compose up -d --wait
```

По умолчанию используются `https://api.deepseek.com`, `deepseek-flash` и timeout 12 секунд.
Оплачиваются только реальные запросы анализа с включённым ключом; при сбое API остаются
правила с пояснением. Ключ передаётся контейнеру при запуске, в Docker image и расширение
не попадает. Не передавайте организаторам свой `.env`; они могут использовать свой ключ
или режим без ключа. Не публикуйте `docker compose config`/`docker inspect` с заполненным
ключом: эти команды показывают runtime environment.

Для реальных утечек остаётся `AMIFOOLED_BREACHES_MODE=hibp`, нужен интернет до HIBP.
Недоступность источника отображается как unknown/unavailable, а не ноль утечек.
`fixture` — только синтетическая проверка: `example.com` даёт одну вымышленную запись,
остальные домены — unavailable. Не используйте этот режим для демонстрации реальных сайтов.

## Если порт 8000 занят

Создайте корневой `.env` из примера и измените `AMIFOOLED_API_PORT=18000`, затем запустите
Compose повторно. Health будет на http://127.0.0.1:18000/health. Пересоберите расширение
с тем же публичным адресом:

```sh
docker build --file apps/extension/Dockerfile --target export --build-arg WXT_API_BASE_URL=http://127.0.0.1:18000 --output type=local,dest=./dist .
```

`WXT_API_BASE_URL` задаётся при сборке, не через runtime `.env` backend. Используйте
`127.0.0.1`, а не `api:8000`: Chrome работает вне Docker-сети.
После смены адреса перезагрузите расширение и при необходимости подтвердите новый доступ.
При выключенном backend popup должен показывать ошибку, а не успешную проверку (#6/#8).

Если Docker не подключается к daemon, запустите Docker Desktop/Engine. Если `--wait`
или `--output` не поддерживаются, обновите Compose/Buildx. При ошибке скачивания образа
проверьте доступ к Docker Hub, PyPI и npm; после восстановления повторите команду.

## Проверки и сопровождение

Для разработчиков с Python 3.10+ и Docker, без pip/npm install:

```sh
python3 scripts/smoke-docker.py
```

Скрипт создаёт отдельный Compose-проект на свободном loopback-порту, отключает ключ,
проверяет HTTP health, rules с цитатой/evidence ID, fixture/unknown breaches, непривилегированный
процесс, отсутствие текста запроса в логах, сборку ZIP и совпадение его файлов с unpacked.
Временные контейнеры удаляются в `finally`; другие проекты не затрагиваются. Проверки
не вызывают DeepSeek/HIBP. Для сохранения артефактов: `--extension-output dist`.
В CI это job `containers`, включённый в обязательный итоговый check `ci`.

API и Node образы закреплены digest многоархитектурного manifest, зависимости берутся
из npm lock и Python lock. В API образ устанавливаются только runtime dependencies;
`requirements-dev.lock` используется как constraints, pytest/ruff в runtime отсутствуют.
При обновлении зависимостей или базовых образов повторите smoke и review lock/digest.
Локальная проверка выполняется на Linux/ARM64 в Docker Desktop, CI — на Linux/AMD64.
Нативная работа Windows/Linux браузера проверяется при финальной приёмке #8.

Документация: [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/),
[BuildKit local export](https://docs.docker.com/build/exporters/local-tar/),
[Chrome Load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).
