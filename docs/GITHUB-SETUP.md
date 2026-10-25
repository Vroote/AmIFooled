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
- Rulesets при проверке отсутствовали. Чтение branch protection вернуло 404 при роли
  без Admin; это не доказывает отсутствия старого branch protection.
- Попытка создать отдельный additive ruleset через POST `/repos/Vroote/AmIFooled/rulesets`
  также вернула **404**. Защита и обязательный approve **не включены этим setup**:
  подтверждённых Admin-прав у текущего аккаунта нет. Секретов Actions в repo пока нет.

## Защита main — задача владельцу #10

После первого успешного CI применить из корня repo **под Admin**:

Предпочтительный additive вариант (создать один раз, не меняет старые защиты):

```sh
gh api --method POST repos/Vroote/AmIFooled/rulesets --input .github/ruleset.json
```

Или классический branch protection:

```sh
gh api --method PUT repos/Vroote/AmIFooled/branches/main/protection --input .github/branch-protection.json
```

Сначала прочитать существующие настройки: PUT заменяет конфигурацию. Если появились более
строгие правила, сохранить их и добавить только недостающее. Наш JSON предназначен для
первоначальной настройки, не для ослабления существующей защиты.

Результат: PR-only, **1 approve**, stale approvals dismissed, required `ci` с актуальной
main, resolved conversations, linear history, без force push/delete, включая администраторов.
Code owners не обязательны. До появления check `ci` не угадывать другое имя job.

В Settings → General: разрешить squash merge; по желанию auto-delete branches и auto-merge.
Auto-merge можно включать только после реальной защиты, иначе нет обязательного review gate.
Не обходить правила `--admin`. Если тариф владельца не поддерживает protection для приватного
repo, зафиксировать это в #10: не менять видимость или тариф без отдельного решения.

GitHub [документирует ограничения protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches):
приватным репозиториям может понадобиться платный план. Write позволяет issues/PR,
но не изменение правил. До #10 скрипт `merge-pr.py` проверяет review/CI/current HEAD/threads,
однако участник всё ещё может обойти его вручную — это **не серверное enforcement**.

## Project sync

Прямой локальный путь уже доступен:

```sh
gh auth refresh -h github.com -s project
python3 scripts/project-sync.py --init-fields
```

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
