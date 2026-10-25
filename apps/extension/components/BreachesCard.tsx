/**
 * Known breaches of the site, never of the user.
 *
 * Zero records means "no match in this catalogue", which is stated as such: it is never
 * rendered as a promise that the site is safe.
 */

import type { BreachesResponse, CardState } from '../entrypoints/popup/state';
import ActionButton from './ActionButton';
import CardShell from './CardShell';
import { FAILURE_TEXT, formatDate, formatDateTime } from './messages';

interface Props {
  state: CardState<BreachesResponse>;
  hostname: string | null;
  canCheck: boolean;
  onCheck: () => void;
}

function statusLine(data: BreachesResponse): string {
  if (data.status === 'unavailable') {
    return 'Каталог недоступен · число неизвестно';
  }
  if (data.status === 'not_found') {
    return 'Совпадений в каталоге нет';
  }
  return `Известных инцидентов: ${data.count ?? 0}`;
}

export default function BreachesCard({ state, canCheck, onCheck }: Props) {
  const checkButton = (again: boolean) => (
    <ActionButton variant="secondary" onClick={onCheck} disabled={!canCheck}>
      {again ? 'Проверить заново' : 'Проверить утечки сайта'}
    </ActionButton>
  );

  if (state.phase === 'idle' || state.phase === 'loading') return null;

  if (state.phase === 'failed') {
    return (
      <CardShell
        id="breaches"
        title="Известные утечки сайта"
        status="Проверка не выполнена"
        footer={canCheck ? checkButton(true) : null}
      >
        <p>{FAILURE_TEXT[state.failure.kind]}</p>
        <p className="muted">Ноль не показан: неизвестно — это не «утечек не было».</p>
      </CardShell>
    );
  }

  const { data } = state;
  return (
    <CardShell id="breaches" title="Известные утечки сайта" status={statusLine(data)} footer={checkButton(true)}>
      <ul className="meta">
        <li>Сопоставленный домен: {data.matched_domain ?? 'не определён'}</li>
        <li>Проверено: {formatDateTime(data.checked_at)}</li>
        <li>
          Источник:{' '}
          <a href={data.attribution_url} target="_blank" rel="noreferrer noopener">
            Have I Been Pwned
          </a>
          {data.source === 'fixture' ? ' (демо-данные)' : ''}
        </li>
        {data.stale ? <li className="meta__stale">Ответ из кэша, не свежая проверка.</li> : null}
      </ul>

      {data.status === 'unavailable' ? (
        <p className="muted">
          Каталог HIBP недоступен. Число известных утечек сейчас неизвестно.
          Повторите проверку позже; это не результат об отсутствии записей.
        </p>
      ) : data.breaches.length > 0 ? (
        <ul className="breach__list">
          {data.breaches.map((breach) => (
            <li key={breach.name} className="breach">
              <h3 className="breach__title">{breach.title}</h3>
              <p className="muted">
                {formatDate(breach.breach_date)} ·{' '}
                {breach.is_verified ? 'подтверждена HIBP' : 'не подтверждена HIBP'}
              </p>
              <p>Затронутые данные: {breach.data_classes.join(', ')}</p>
              <p>
                <a href={breach.source_url} target="_blank" rel="noreferrer noopener">
                  Описание инцидента
                </a>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          В каталоге HIBP записей по этому домену нет. Это значит только отсутствие совпадения,
          а не безопасность сайта.
        </p>
      )}
    </CardShell>
  );
}
