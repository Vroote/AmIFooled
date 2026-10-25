# Известные утечки сайта — API #4

`GET /v1/breaches?hostname=www.adobe.com` обращается только к публичному каталогу
[Have I Been Pwned](https://haveibeenpwned.com/API/v3#AllBreaches). Ключ не нужен;
поиска email, паролей и вызова `/breachedDomain` нет. Источник данных — HIBP, не наша БД.

## Сопоставление и ограничения

- `hostname` в ответе — lowercase ASCII IDNA без конечной точки.
- `matched_domain` — домен, переданный HIBP; при unavailable он тоже обозначает запрос,
  а не найденный инцидент. Например, `www.adobe.com` → `adobe.com`,
  `shop.example.co.uk` → `example.co.uk`.
- Используется bundled PSL tldextract с private suffixes, без runtime download и disk cache.
  `www.alice.github.io` → `alice.github.io`, никогда не `github.io`. Сам `github.io`
  проверяется как отдельный hostname платформы. Наличие PSL не доказывает общего владельца;
  каталог сопоставляется по домену, полного аудита конкретного поддомена нет.
- Некорректные DNS имена, URLs, email, IP, bare public suffixes и неизвестные suffixes
  отклоняются с 422 без внешнего запроса. DNS resolution пользовательского hostname нет.
- Каждый инцидент принимается только при точном совпадении его нормализованного Domain
  с matched_domain; некорректный/чужой ответ даёт unavailable, не обвинение чужому сайту.
- `ok` → `count > 0`; `not_found` → `count = 0`; `unavailable` → `count = null`.
  Ноль означает отсутствие совпадений в каталоге, а не безопасность сайта.
- `breaches` содержит название, дату, классы данных, is_verified и HIBP source_url.
  HIBP Description HTML не включается в ответ. UI должен отображать title/classes как текст,
  показывать attribution_url, matched_domain и checked_at (задача #5).

## Upstream и кэш

Фиксированный HTTPS endpoint, hostname только в query `Domain`, User-Agent AmIFooled/0.1.
Redirects и environment proxies отключены. Общий deadline и HTTP phase timeout ≤5 секунд;
body ограничен 2 MiB, список — 2000 записей. Нет автоматических повторов запросов.

Успешные/пустые ответы хранятся в process-local LRU-кэше: 256 доменов, TTL 3600 секунд.
Кэш хранит исходное checked_at, запрос другого поддомена меняет только hostname в копии.
Expired cache не возвращается; stale=false. После restart кэш пуст. При нескольких
worker каждый имеет собственный кэш и cooldown; публичный deploy вне scope MVP.

429 включает общий для этого процесса cooldown по Retry-After (seconds или HTTP date).
При отсутствующем/некорректном заголовке — 60 секунд, минимальный cooldown — 1 секунда.
Во время cooldown пригодный cache остаётся доступен, остальные запросы получают unavailable.
Уже начавшиеся параллельные запросы не отменяются; single-flight не реализован.
5xx, redirect, timeout и некорректный JSON не превращаются в ноль и не кэшируются.

## Явный offline demo

При запуске API экспортируйте `AMIFOOLED_BREACHES_MODE=fixture`. `.env.example` автоматически
не загружается. В fixture mode только `example.com` (и поддомены) получает синтетический
инцидент; прочие домены — unavailable. Все ответы помечены `source=fixture`, название
говорит Synthetic example, сеть не вызывается. Ошибки live mode никогда не включают fixture.
Для возврата к HIBP задайте `AMIFOOLED_BREACHES_MODE=hibp` и перезапустите процесс.

Пример success: `contracts/fixtures/breaches-success-response.json`, синтетический.
Пример unavailable: `contracts/fixtures/breaches-response.json`, синтетический.
Форма ответа v1 сохранена; query принимает Unicode/case/trailing dot, ответ нормализован.
Удалён только 501 response у реализованного breaches endpoint; analyze не изменён.

## Проверка

Offline pytest использует httpx.MockTransport; реальные HTTP transports запрещены в tests
breaches. Проверены www/co.uk/private PSL/IDNA, invalid hostname/IP, 200/empty/429/5xx,
timeouts, redirects, malformed data, TTL/LRU, восстановление после ошибки, fixture mode.

Live smoke 25 октября 2026, 13:47 МСК: `BreachService.lookup('www.adobe.com')` вернул
status=ok, matched_domain=adobe.com, count=1, Adobe, дата 2013-10-04, is_verified=true,
attribution_url=https://haveibeenpwned.com/. Это проверка адаптера с реальным upstream;
интеграция popup и приёмка Chrome выполняются отдельно в #6–#8.
