import type { BreachesResponse, CardState, Evidence } from '../entrypoints/popup/state';
import Icon from './Icon';

interface Props {
  evidence: Evidence[];
  breaches: CardState<BreachesResponse>;
  canCheck: boolean;
  onCheck: () => void;
}
export default function SiteStats({ evidence, breaches, canCheck, onCheck }: Props) {
  const rawCount = evidence.find((item) => item.kind === 'visible_cookie_count')?.value;
  const cookieCount = rawCount && /^\d+$/.test(rawCount) && Number.isSafeInteger(Number(rawCount)) ? Number(rawCount) : null;
  const result = breaches.phase === 'ok' ? breaches.data : null;
  const count = result && result.status !== 'unavailable' ? result.count : null;
  const loading = breaches.phase === 'loading';
  const caption = loading ? 'Проверяю HIBP…' : result?.status === 'not_found' ? 'Совпадений в HIBP нет' : count !== null ? 'Известные инциденты' : breaches.phase === 'idle' ? 'Ещё не проверены' : 'Число неизвестно';
  return (
    <section className="site-stats" aria-label="Наблюдения о сайте">
      <div className="stat">
        <div className="stat__label"><Icon name="cookie" /><h2>Cookies</h2></div>
        <p className="stat__number">{cookieCount === null ? '—' : cookieCount.toLocaleString('ru-RU')}</p>
        <p className="stat__caption">{cookieCount === null ? 'Число неизвестно' : 'Доступны странице'}</p>
        <span className="stat__local">Локальный подсчёт</span>
      </div>
      <div className={`stat ${count && count > 0 ? 'stat--attention' : ''}`}>
        <div className="stat__label"><Icon name="breach" /><h2>Утечки</h2></div>
        <div role="status"><p className="stat__number">{count === null ? '—' : count.toLocaleString('ru-RU')}</p><p className="stat__caption">{caption}{result?.source === 'fixture' ? ' · демо' : ''}{result?.stale ? ' · кэш' : ''}</p></div>
        <button className="text-button" type="button" onClick={onCheck} disabled={!canCheck || loading} aria-busy={loading || undefined} aria-label="Проверить утечки сайта">{loading ? 'Проверяю…' : 'Проверить'}<Icon name="arrow" /></button>
      </div>
    </section>
  );
}
