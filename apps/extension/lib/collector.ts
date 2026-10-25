import { getDomain } from 'tldts';
import { browser } from 'wxt/browser';
import type { components } from './api.generated';
import { readPageSnapshot, type PageSnapshot } from './collector-page';
import { sanitizePolicyText } from './collector-policy';
import { normalizeHostname } from './hostname';

export type AnalysisRequest = components['schemas']['AnalysisRequest'];
// Kept exported here: the collector has been this module's import path since #2.
export { normalizeHostname };
type Evidence = components['schemas']['Evidence'];
type Observations = Pick<AnalysisRequest, 'hostname' | 'evidence'>;

export type PolicyInput = { source: 'selection' } | { source: 'manual'; text: string };
export type CollectorError = 'no_active_tab' | 'unsupported_page' | 'incognito' |
  'page_changed' | 'access_denied' | 'timeout' | 'unavailable';
export type CollectionResult =
  | { status: 'ready'; payload: AnalysisRequest; notices: string[] }
  | { status: 'needs_policy'; observations: Observations; reason: 'empty' | 'blocked_selection'; notices: string[] }
  | { status: 'error'; code: CollectorError; message: string };

const resourceLimitation = 'Resource Timing — неполное наблюдение главного документа, не история сети. '
  + 'Другой регистрируемый домен не доказывает трекинг, другого владельца или нарушение.';
const cookieLimitation = 'Только количество cookies, доступных document.cookie в главном документе. '
  + 'HttpOnly не видны; это не полный учёт partitioned или сторонних cookies.';
const errors: Record<CollectorError, string> = {
  no_active_tab: 'Нет доступной активной вкладки. Откройте обычную веб-страницу.',
  unsupported_page: 'Эту страницу нельзя проверить. Откройте HTTP(S)-страницу вне магазина расширений.',
  incognito: 'Сбор в режиме инкогнито отключён.',
  page_changed: 'Страница изменилась во время сбора. Запустите проверку ещё раз.',
  access_denied: 'Не удалось прочитать страницу. Откройте расширение на обычной вкладке и повторите действие.',
  timeout: 'Страница не ответила вовремя. Попробуйте ещё раз.',
  unavailable: 'Наблюдения страницы сейчас недоступны. Попробуйте ещё раз.',
};
const failure = (code: CollectorError): CollectionResult => ({ status: 'error', code, message: errors[code] });

function supportedPage(rawUrl: string | undefined): URL | null {
  try {
    const url = new URL(rawUrl ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || !normalizeHostname(url.hostname)) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (hostname === 'chromewebstore.google.com' ||
        (hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(url.pathname))) return null;
    return url;
  } catch { return null; }
}

export function buildCollection(snapshot: PageSnapshot, policy: PolicyInput): CollectionResult {
  const hostname = normalizeHostname(snapshot.hostname);
  if (!hostname) return failure('unsupported_page');
  const site = getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
  const resourceHosts = [...new Set(snapshot.resourceHosts.map(normalizeHostname).filter(
    (value): value is string => value !== null && value !== hostname &&
      (getDomain(value, { allowPrivateDomains: true }) ?? value) !== site,
  ))].sort();
  const evidence: Evidence[] = [];
  const notices = [resourceLimitation, cookieLimitation,
    'Отсутствие наблюдений не означает отсутствие трекинга или безопасность сайта.'];
  if (snapshot.visibleCookieCount !== null && Number.isSafeInteger(snapshot.visibleCookieCount) && snapshot.visibleCookieCount >= 0) {
    evidence.push({ id: 'visible-cookies', kind: 'visible_cookie_count', value: String(snapshot.visibleCookieCount), limitation: cookieLimitation });
  } else {
    notices.push('Количество доступных JavaScript cookies определить не удалось.');
  }
  for (const host of resourceHosts.slice(0, 100 - evidence.length)) {
    evidence.push({ id: `resource-${evidence.length}`, kind: 'resource_domain', value: host, limitation: resourceLimitation });
  }
  if (!snapshot.resourcesAvailable) notices.push('Resource Timing недоступен. Список ресурсов неизвестен.');
  if (snapshot.resourceScanLimited || resourceHosts.length > 100 - (snapshot.visibleCookieCount === null ? 0 : 1)) {
    notices.push('Достигнут предел наблюдений ресурсов; список сокращён.');
  }
  const sanitized = sanitizePolicyText(policy.source === 'manual' ? policy.text : snapshot.selectedText);
  if (sanitized.truncated || (policy.source === 'selection' && snapshot.selectionTruncated)) {
    notices.push('Текст политики сокращён до 20 000 символов; анализ охватит только этот фрагмент.');
  }
  if (sanitized.redacted) notices.push('Из текста удалены email, части URL и управляющие символы.');
  if (policy.source === 'selection' && snapshot.selectionState === 'blocked') {
    return { status: 'needs_policy', observations: { hostname, evidence }, reason: 'blocked_selection', notices };
  }
  if (!sanitized.text) return { status: 'needs_policy', observations: { hostname, evidence }, reason: 'empty', notices };
  return { status: 'ready', payload: { hostname, evidence, policy_text: sanitized.text }, notices };
}

async function collect(policy: PolicyInput, signal: AbortSignal): Promise<CollectionResult> {
  let tab;
  try {
    [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  } catch { return failure('unavailable'); }
  if (signal.aborted) return failure('timeout');
  if (tab?.id === undefined) return failure('no_active_tab');
  if (tab.incognito) return failure('incognito');
  const page = supportedPage(tab.url);
  if (!page) return failure('unsupported_page');
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: readPageSnapshot,
      args: [policy.source === 'selection'],
    });
    if (signal.aborted) return failure('timeout');
    if (!injection?.result) return failure('unavailable');
    const current = await browser.tabs.get(tab.id);
    if (current.url !== tab.url || current.pendingUrl || !current.active ||
        normalizeHostname(injection.result.hostname) !== normalizeHostname(page.hostname)) return failure('page_changed');
    return buildCollection(injection.result, policy);
  } catch {
    // Browser error strings may contain a full URL. Never expose or log them.
    return failure('access_denied');
  }
}

/** Call from an explicit extension action; review the result before sending payload to the API.
 * No network, listeners, storage, permission prompts or background collection occur here.
 */
export async function collectPageEvidence(policy: PolicyInput = { source: 'selection' }): Promise<CollectionResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      collect(policy, controller.signal),
      new Promise<CollectionResult>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(failure('timeout')); }, 5_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
