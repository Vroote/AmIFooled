# GitHub: фактические настройки и завершение владельцем

## Проверенное состояние

- Repo `Vroote/AmIFooled` приватный, default `main`, исходный HEAD `ec3af63`.
- Аккаунт setup: `DREdward-chell`, роль Write, **admin=false**.
- Другие участники: `Nar2924`, `Br1ght-SuN-lab` — Write; `Vroote` — Admin.
- Project `KrapivaTeam AmIFooled?` приватный, №1; после расширения scope `project`
  текущий аккаунт может его редактировать. Токены не сохранены в repo.
- Setup создаёт issues #1–#10, milestone, метки, поля Priority / Estimate (min) / Lane /
  Depends on и заполняет существующий Project, не заменяя колонки/настройки владельца.
- Существующий View 1 уже имеет BOARD_LAYOUT; сохранён. Между задачами добавлены native
  GitHub issue dependencies `blocked by`, без удаления существующих связей.
- GraphQL подтвердил `enabled=true` у существующих workflows: Auto-add to project,
  Auto-add sub-issues to project, Auto-close issue, Item added to project, Item closed,
  Pull request linked to issue и Pull request merged. Эти настройки сохранены;
  точные фильтры и целевые поля/статусы API не раскрывает, их нужно проверить владельцу.
- Rulesets при проверке setup отсутствовали. Чтение branch protection вернуло 404 при роли
  без Admin; это не доказывало отсутствия старого branch protection.
- Попытка создать отдельный additive ruleset через POST `/repos/Vroote/AmIFooled/rulesets`
  вернула под Write **404**. Защита **не была включена setup**: подтверждённых Admin-прав
  у `DREdward-chell` нет. Секретов Actions в repo не было.
- Перепроверено под Admin в #10: `rulesets` отдавал пустой список, а
  `branches/main/protection` — «Branch not protected». Старой классической защиты не было,
  прошлый 404 объяснялся только правами. Применён additive ruleset, см. раздел ниже.

## Защита main — включена в #10

Ruleset `AmIFooled main review and CI`, id **25818867**, создан под Admin (`Vroote`)
25 октября 2026 из `.github/ruleset.json` после первого успешного `ci` на main `6178c84`:

```sh
gh api --method POST repos/Vroote/AmIFooled/rulesets --input .github/ruleset.json
```

Применён additive POST, а не PUT: он не заменяет существующие настройки. Классический
`.github/branch-protection.json` остаётся резервным вариантом на случай, если ruleset
придётся пересоздавать:

```sh
gh api --method PUT repos/Vroote/AmIFooled/branches/main/protection --input .github/branch-protection.json
```

Перед PUT читать существующие настройки: он заменяет конфигурацию целиком. Если появились
более строгие правила, сохранить их и добавить только недостающее. Наши JSON предназначены
для первоначальной настройки, не для ослабления существующей защиты.

Действует на `refs/heads/main`: PR-only, **1 approve**, stale approvals dismissed,
required `ci` со strict-политикой актуальной main, resolved conversations, linear history,
запрет deletion и non-fast-forward. Code owners не требуются.

Пустой `bypass_actors` и ответ `current_user_can_bypass: never` наблюдались в сессии
владельца под Admin — это утверждение владельца, а не независимо перепроверенный факт:
GitHub скрывает `bypass_actors` от аккаунтов, которые не могут редактировать ruleset,
поэтому под ролью Write отсутствие поля ничего не доказывает. `current_user_can_bypass`
говорит только о текущем аккаунте. Перепроверять это может другой Admin.

GitHub добавил к `pull_request` собственный параметр по умолчанию
`require_extra_approval_for_unattributed_changes: true`; он записан в `.github/ruleset.json`,
чтобы файл совпадал с сервером. Для commits, автор которых не связан с GitHub-аккаунтом,
это может потребовать второй approve вместо согласованного одного. На PR #14 параметр
второй approve не запросил, то есть на обычных commits участников он не срабатывает.

Если PR неожиданно просит два approve — причина здесь. Снимать только решением владельца
под Admin, с записью в этом файле. REST обновляет repository ruleset методом **PUT**
`/repos/{owner}/{repo}/rulesets/{ruleset_id}`; PATCH для этого endpoint не поддерживается:

```sh
gh api repos/Vroote/AmIFooled/rulesets/25818867 > /tmp/ruleset-25818867.json
# отредактировать в копии только нужный параметр
gh api --method PUT repos/Vroote/AmIFooled/rulesets/25818867 --input /tmp/ruleset-25818867.json
```

PUT заменяет ruleset целиком, поэтому сначала GET под Admin, затем менять ровно один
параметр в полученном объекте, сохранив остальные `rules`, `conditions` и `bypass_actors`.
Тело GET содержит лишние для записи поля (`id`, `created_at`, `_links`) — их убрать.
[Update a repository ruleset](https://docs.github.com/en/rest/repos/rules#update-a-repository-ruleset).

### Проверено на реальном PR

PR [#12](https://github.com/Vroote/AmIFooled/pull/12) при зелёных `ci`/`backend`/`extension`/
`process` и `mergeable: MERGEABLE` отдаёт `mergeStateStatus: BLOCKED` и
`reviewDecision: REVIEW_REQUIRED`. Approval gate работает на стороне GitHub, а не только
в `merge-pr.py`. Проверка выполнена чтением состояния PR; чужой PR для теста не мерджился.

Settings → General проверены: squash merge разрешён, merge commit и rebase тоже доступны,
но linear history отклонит merge commit. Auto-merge **выключен** и в #10 не включался:
включать его — отдельное решение владельца. Auto-delete branches выключен; `merge-pr.py`
передаёт `--delete-branch` сам. Правила не обходить через `--admin`.

GitHub [документирует ограничения protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches):
приватным репозиториям может понадобиться платный план. Здесь ограничение не возникло —
POST ruleset прошёл на текущем тарифе; видимость и тариф не менялись. Write позволяет
issues/PR, но не изменение правил. `merge-pr.py` остаётся полезной предварительной
проверкой review/CI/current HEAD/threads, но теперь **не единственным** барьером:
прямой push и merge без approve отклоняет сам GitHub.

## Project sync

Прямой локальный путь уже доступен:

```sh
gh auth refresh -h github.com -s project
python3 scripts/project-sync.py --init-fields
```

Статус на момент #10: Actions secrets пусты, `PROJECT_TOKEN` **не установлен**, поэтому
workflow только пишет сообщение в summary и ничего не синхронизирует; его успешный
результат не означает обновление доски.

Локальный путь проверен и работает. Доступ к Project зависит от scope **конкретной сессии**,
а не от настроек проекта: токен `DREdward-chell` scope `project` имеет и sync выполнял,
а у сессии владельца `Vroote` его сначала не было, что и чинится `gh auth refresh`. После
расширения scope `python3 scripts/project-sync.py` под `Vroote` обновил все 15 карточек.
Scope расширяет каждый участник сам, токены в repo не сохраняются.

Встроенные Project workflows остаются включёнными с момента setup; их точные фильтры и
целевые статусы API не раскрывает, это по-прежнему ручная проверка владельца в
Project → Workflows.

**Решение владельца по `PROJECT_TOKEN`:** secret не создаётся, команда осознанно остаётся
на локальном запуске `python3 scripts/project-sync.py` после claim/review/merge. Причина —
объём хакатона: отдельный PAT пришлось бы создать, хранить и отозвать, а локальный запуск
уже проверен. Поэтому автоматическая синхронизация Project по событиям **не работает**, и
объявлять её работающей нельзя: `project-sync.yml` остаётся в repo и включится сам, если
secret появится позже. Ответственность за актуальность доски — на том, кто делает claim,
review или merge.

`--init-fields` только добавляет отсутствующие поля; повторный запуск не дублирует items.
Обычный `project-sync.py` обновляет Status и плановые поля; сохраните эту семантику,
не редактируйте плановые поля вручную без обновления `scripts/tasks.json`.

- Open issue: Todo; claimed/review: In Progress; closed: Done.
- Open PR: In Progress; merged: Done; closed without merge: Todo.
- После закрытия всех dependencies добавляется `status:ready`; admin/stretch требуют
  решения координатора. Перед claim обязательно проверить, что зависимости merged,
  а не просто закрыты; скрипт не является планировщиком/атомарной блокировкой.
- Если доска меняется вручную, следующий sync восстановит эти значения для repo items.
  Чужие repositories/items не трогаются.

Для полностью автоматического режима workflow `.github/workflows/project-sync.yml`
реагирует на issue/PR/review события после merge setup. Ему нужен отдельный secret
`PROJECT_TOKEN`: для user-owned Project обычно dedicated classic PAT со scope `project`
и `repo` для приватного repo (или подходящий GitHub App token). Установить в Settings →
Secrets and variables → Actions. Токен создаёт/вводит владелец; не пересылайте его в чат.
Срок ограничить хакатоном/короткой ротацией. **OAuth token разработчика автоматически
не копируется в Actions.** Пока secret отсутствует, workflow сообщает это в summary,
а board обновляется локальным script после claim/review/merge.

Вариант без отдельного PAT: существующие встроенные workflows уже включены (см. выше).
Владельцу проверить в Project → Workflows их **параметры**: Item closed и Pull request
merged → Done, reopen → Todo, auto-add с фильтром `repo:Vroote/AmIFooled` (если доступно).
Особенно проверить Auto-close issue: перенос карточки в Done может закрыть issue, поэтому
не использовать Done для просто готового к review PR. Изменение этих переключателей не
доступно через используемый API; наличие enabled=true не подтверждает точный фильтр или
target status. Локальная синхронизация остаётся проверенным запасным способом.

Обычный GITHUB_TOKEN не имеет доступа к user Projects —
[ограничение GitHub Actions](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).
Workflow с Project secret читает только trusted default branch, не выполняет PR code.
CI вообще не получает этот secret. Feature ветки не запускают arbitrary commands через
метаданные issues/PR; все входные строки передаются как данные.

## Повторная публикация

`python3 scripts/publish-tasks.py` только показывает план. `--publish` создаёт недостающее
и обновляет тела **собственных помеченных задач** из catalog, не их comments. Не запускайте
его после ручного редактирования этих issue без review — тела вернутся к catalog.
`docs/issues.json` содержит фактические номера; это не предположенные ссылки.
