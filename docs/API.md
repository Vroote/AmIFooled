# Границы MVP и API v1

Источник схем — `apps/api/app/models.py`; OpenAPI генерируется из FastAPI, frontend types —
из OpenAPI. Fixtures синтетические, только для разработки, не факты о реальных сервисах.

| Endpoint | Реализовано в setup | Контракт feature |
|---|---|---|
| GET /health | 200 status=ok | Без внешних зависимостей |
| POST /v1/analyze | Rules + optional LLM | hostname, policy_text, evidence → summary/findings/limitations/mode |
| GET /v1/breaches?hostname=... | HIBP public catalogue | matched_domain, breaches, count/status/source/checked_at |

Pydantic запрещает лишние поля. Политика ограничена 20 000 символов, факты — 100 элементами.
GET /v1/breaches нормализует DNS/IDNA/PSL, включая private suffixes, и принимает до 254
символов query hostname с завершающей точкой; ответ содержит ASCII hostname до 253 символов.
Для analyze hostname ограничен базовым regex, тело запроса — 256 KiB до JSON parsing. Клиент проверяет
схему неизвестных сетевых данных; TS тип не заменяет
runtime validation. Не добавлять URL-fetch endpoint: так избегаем crawler/SSRF в scope MVP.

`AnalysisResponse.status`: ok / insufficient_data / unavailable. `mode`: rules / llm / fixture.
LLM Finding содержит точную подстроку документа и только переданные IDs релевантных evidence.
Для риска в самом тексте (например условия автопродления) допустимы `evidence_ids=[]`.
Rules может отдельно сообщить об отсутствии упоминания cookies с пустой цитатой.
`policy_text` принимает один документ: соглашение/политику/раздел cookies до 20 000 символов.
Без наблюдений `status=insufficient_data` сохраняется даже при найденных условиях в тексте:
покажите findings и summary/limitations, не трактуйте этот статус как пустой результат.
`mode=llm` означает успешный ответ провайдера с проверенными цитатами/IDs или корректным
пустым findings. Если все предложенные findings отвергнуты, остаётся `mode=rules` с пояснением.
Никаких выводов «сайт мошеннический» из отсутствия сведений или стороннего ресурса.

`BreachesResponse.status`: ok с count>0; not_found с count=0; unavailable с count=null.
При возврате stale cache показывать дату и stale=true, не выдавать за свежее наблюдение.
Инварианты status/count реализованы в сервисе breaches и проверены offline tests.
Не использовать HTTP 404 для upstream outage; классифицировать недоступность отдельно.

Сопоставление домена, кэш, fixture mode и проверка HIBP: [BREACHES.md](BREACHES.md).

Ключ LLM живёт на сервере. Backend работает локально на loopback, тело запросов не логируется.
Опциональный провайдер ограничен общим отменяемым deadline в оставшемся бюджете анализа
(не более 15 секунд на анализ) и ответом до 128 KiB. Ошибки формата, таймаут и превышение
размера оставляют rules с пояснением; finding с любым неизвестным evidence ID отклоняется целиком.
По умолчанию используется DeepSeek `deepseek-flash`, JSON output, thinking disabled, один
запрос без retries. При 401/402/429/timeout дополнительно возвращается безопасное пояснение,
а не сырой ответ провайдера. Точная цитата и существующий ID проверяются кодом; это не
гарантия правильности интерпретации модели. Пользователь должен проверить смысл цитаты.
Настройки и ручной live smoke: [START.md](START.md#deepseek--опциональный-анализ-соглашения-и-cookies).
Для публичного deployment отдельно нужны auth/quotas/rate limiting/HTTPS; публичный сервис
не является условием шестичасового MVP. Политика отправляется только после подтверждения
пользователем, автоматический режим утечек отправляет только hostname после opt-in.

## Источники и принятые ограничения

- [DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/),
  [JSON Output](https://api-docs.deepseek.com/guides/json_mode/): API base, модель, отключение
  thinking, JSON и ограничение output; пустые/обрезанные ответы обрабатываются как fallback.
- [WXT installation](https://wxt.dev/guide/installation.html): React + TypeScript, Node ≥22
  для использованной версии 0.21.4; Chrome MV3 — целевая платформа этого хакатона.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab):
  доступ после жеста пользователя временный. Навигационная проверка #7 требует отдельного opt-in.
- [HIBP API](https://haveibeenpwned.com/API/v3#AllBreaches): использовать публичный каталог
  `/api/v3/breaches?Domain=...`, а не приватный поиск email `/breachedDomain`.
  Указывать [Have I Been Pwned](https://haveibeenpwned.com/) как источник. Отсутствие записи
  значит только отсутствие совпадения в этом каталоге. Live API availability проверяется #4.
- Resource Timing показывает только доступные наблюдения страницы; JS cookies исключают
  HttpOnly и не дают полного списка сторонних cookies. Список всех permission prompts
  сайта браузер не предоставляет таким сбором. Не обещать полную проверку поведения.

## Изменение контракта

Согласуйте в comments с владельцами UI/интеграции, обновите models/routes и fixtures:

```sh
.venv/bin/python scripts/export-openapi.py
npm run contracts:types
```

В feature PR замените только относящийся к реализуемому endpoint тест 501 реальными
happy/error-path tests. Не меняйте другие заглушки/контракты без владельца.
