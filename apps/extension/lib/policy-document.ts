import { parse as parseDomain } from 'tldts';

export type PolicyKind = 'terms' | 'privacy' | 'cookies';
export interface PolicyCandidate { url: string; title: string; kind: PolicyKind }
export interface PolicyDocument extends PolicyCandidate {
  text: string;
  truncated: boolean;
  redacted: boolean;
}
export type PolicyProblem = 'invalid_url' | 'permission' | 'denied' | 'network' | 'timeout' |
  'too_large' | 'unsupported' | 'empty' | 'not_found';
export type PolicyResult =
  | { status: 'ready'; document: PolicyDocument; candidates: PolicyCandidate[] }
  | { status: 'missing'; problem: PolicyProblem; candidates: PolicyCandidate[]; url?: string };

export const POLICY_KIND_LABEL: Record<PolicyKind, string> = {
  terms: 'Пользовательское соглашение', privacy: 'Политика конфиденциальности', cookies: 'Политика cookies',
};
export const POLICY_PROBLEM_TEXT: Record<PolicyProblem, string> = {
  invalid_url: 'Укажите публичную HTTPS-ссылку без логина и пароля. Локальные адреса и нестандартные порты не поддерживаются.',
  permission: 'Документ размещён на другом сайте. Для загрузки нужен доступ к указанному сайту.',
  denied: 'Доступ не предоставлен. Можно повторить разрешение или указать другую ссылку.',
  network: 'Не удалось загрузить документ. Проверьте ссылку и соединение. Если сайт перенаправляет, укажите конечный адрес.',
  timeout: 'Загрузка заняла слишком много времени. Повторите попытку или укажите другую ссылку.',
  too_large: 'Документ слишком большой для загрузки. Укажите ссылку на отдельный раздел.',
  unsupported: 'Этот формат не поддерживается. Нужна публичная HTML-страница или текст, а не PDF.',
  empty: 'В документе не нашлось читаемого текста соглашения. Возможно, нужен вход или страница загружается скриптами.',
  not_found: 'Ссылку на соглашение найти не удалось. Укажите её — текст загрузим сами.',
};

/** Browser-local URLs only; no endpoint in the backend accepts these addresses. */
export function policyUrl(value: string, base?: string): URL | null {
  if (!value || value.length > 2048 || [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\')) return null;
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const domain = parseDomain(host, { allowPrivateDomains: true });
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        domain.isIp || !domain.domain || !(domain.isIcann || domain.isPrivate) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)) return null;
    url.hash = '';
    url.hostname = host;
    return url;
  } catch { return null; }
}

export function policyKind(label: string): PolicyKind | null {
  if (/(?:terms(?:\s+of\s+(?:use|service))?|user[\s_-]*agreement|пользовательск[а-я]*\s+соглашен|условия\s+(?:использования|обслуживания))/iu.test(label)) return 'terms';
  if (/(?:cookie|куки)/iu.test(label)) return 'cookies';
  if (/(?:privacy|конфиденциальност|персональн[а-я]*\s+данн)/iu.test(label)) return 'privacy';
  return null;
}

export function policyCandidates(links: { href: string; label: string }[], pageUrl: string): PolicyCandidate[] {
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  const candidates: PolicyCandidate[] = [];
  for (const link of links.slice(0, 1000)) {
    if (link.href.startsWith('#')) continue;
    const url = policyUrl(link.href, pageUrl);
    if (!url || seen.has(url.href)) continue;
    let path = url.pathname;
    try { path = decodeURI(path); } catch { /* Keep malformed escapes as literal text. */ }
    const kind = policyKind(link.label.slice(0, 200)) ?? policyKind(path.replace(/[-_/]/g, ' '));
    if (!kind) continue;
    seen.add(url.href);
    candidates.push({ url: url.href, title: link.label.trim().slice(0, 200) || POLICY_KIND_LABEL[kind], kind });
  }
  const rank = (candidate: PolicyCandidate) =>
    ({ terms: 0, privacy: 1, cookies: 2 }[candidate.kind]) + (new URL(candidate.url).origin === origin ? 0 : 10);
  return candidates.sort((a, b) => rank(a) - rank(b)).slice(0, 6);
}

export function validPolicyResult(value: unknown): value is PolicyResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const candidate = (entry: unknown): entry is PolicyCandidate => {
    if (!entry || typeof entry !== 'object') return false;
    const c = entry as Record<string, unknown>;
    return typeof c.url === 'string' && policyUrl(c.url)?.href === c.url &&
      typeof c.title === 'string' && c.title.length <= 200 &&
      typeof c.kind === 'string' && ['terms', 'privacy', 'cookies'].includes(c.kind);
  };
  if (!Array.isArray(v.candidates) || v.candidates.length > 6 || !v.candidates.every(candidate)) return false;
  if (v.status === 'ready') {
    if (!candidate(v.document)) return false;
    const d = v.document as unknown as Record<string, unknown>;
    return typeof d.text === 'string' && d.text.length >= 100 && d.text.length <= 20000 &&
      typeof d.truncated === 'boolean' && typeof d.redacted === 'boolean';
  }
  return v.status === 'missing' && typeof v.problem === 'string' &&
    Object.hasOwn(POLICY_PROBLEM_TEXT, v.problem) &&
    (v.url === undefined || typeof v.url === 'string' && policyUrl(v.url)?.href === v.url);
}
