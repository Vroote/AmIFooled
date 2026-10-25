import { browser } from 'wxt/browser';
import { RequestError } from '../entrypoints/popup/controller';
import type { DocumentContext } from './controller-context';
import { policyCandidates, policyKind, policyUrl, POLICY_KIND_LABEL, type PolicyCandidate, type PolicyResult } from './policy-document';
import { loadPolicyDocument, PolicyLoadError } from './policy-loader';

/** Chrome serializes this function; no outside runtime dependencies. Only bounded links, no page body. */
export function readPolicyLinks() {
  const links: { href: string; label: string }[] = [];
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (let i = 0; i < Math.min(anchors.length, 1000); i++) {
    const anchor = anchors[i]!;
    const href = anchor.getAttribute('href') ?? '';
    const label = (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 200);
    if (href.length <= 2048 && /terms|agreement|privacy|cookie|соглашен|конфиденциальност|персональн|условия|куки/iu.test(label + ' ' + href)) {
      links.push({ href, label });
      if (links.length >= 30) break;
    }
  }
  return { url: location.href, links };
}

export async function findPolicyLinks(context: DocumentContext) {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId: context.tabId, documentIds: [context.documentId] }, world: 'ISOLATED', func: readPolicyLinks,
  });
  if (injection?.documentId !== context.documentId || !injection.result) throw new RequestError({ kind: 'page_changed' });
  const { url, links } = injection.result;
  const current = policyUrl(url);
  const currentKind = current && policyKind(current.pathname.replace(/[-_/]/g, ' '));
  const candidates = policyCandidates(currentKind ? [{ href: url, label: POLICY_KIND_LABEL[currentKind] }, ...links] : links, url);
  return { origin: new URL(url).origin, candidates };
}

export async function retrievePolicy(
  url: string, origin: string, candidates: PolicyCandidate[], signal: AbortSignal,
): Promise<PolicyResult> {
  const safe = policyUrl(url);
  if (!safe) return { status: 'missing', problem: 'invalid_url', candidates };
  if (safe.origin !== origin && !await browser.permissions.contains({ origins: [safe.origin + '/*'] })) {
    return { status: 'missing', problem: 'permission', url: safe.href, candidates };
  }
  signal.throwIfAborted();
  const candidate = candidates.find((item) => item.url === safe.href) ??
    { url: safe.href, kind: policyKind(safe.pathname) ?? 'terms', title: 'Документ по ссылке' };
  try {
    return { status: 'ready', document: await loadPolicyDocument(candidate, signal), candidates };
  } catch (error) {
    return { status: 'missing', problem: error instanceof PolicyLoadError ? error.problem : 'network', candidates, url: safe.href };
  }
}

export async function discoverPolicy(origin: string, candidates: PolicyCandidate[], signal: AbortSignal): Promise<PolicyResult> {
  let result: PolicyResult = { status: 'missing', problem: 'not_found', candidates };
  // Never automatically fetch another origin, even if previously granted.
  for (const candidate of candidates.filter((item) => new URL(item.url).origin === origin).slice(0, 2)) {
    signal.throwIfAborted();
    result = await retrievePolicy(candidate.url, origin, candidates, signal);
    if (result.status === 'ready') return result;
  }
  signal.throwIfAborted();
  if (result.problem === 'not_found' && candidates.length) {
    return { status: 'missing', problem: 'permission', url: candidates[0]!.url, candidates };
  }
  return result;
}
