import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { sanitizePolicyText } from './collector-policy';
import { policyKind, policyUrl, type PolicyCandidate, type PolicyDocument, type PolicyProblem } from './policy-document';

export const POLICY_DOWNLOAD_LIMIT = 1024 * 1024;
export class PolicyLoadError extends Error {
  constructor(readonly problem: PolicyProblem) { super(problem); }
}

type HtmlNode = DefaultTreeAdapterMap['node'];
const skipped = new Set(['script', 'style', 'noscript', 'template', 'head', 'nav', 'header', 'footer',
  'form', 'input', 'textarea', 'select', 'button', 'svg', 'iframe']);

/** Parse data without a browser DOM: no scripts, images, frames, or linked resources execute/load. */
export function extractPolicy(html: string): { text: string; title: string } {
  const root = parse(html);
  const containers: HtmlNode[] = [];
  const excluded = (node: HtmlNode) => 'tagName' in node && (skipped.has(node.tagName) ||
    node.attrs.some((attr) => attr.name === 'hidden' || attr.name === 'aria-hidden' && attr.value === 'true' ||
      attr.name === 'style' && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr.value)));
  const chunks = (node: HtmlNode, depth = 0): string => {
    if (depth > 100) return '';
    if ('value' in node) return node.value;
    if (excluded(node)) return '';
    return 'childNodes' in node ? node.childNodes.map((child) => chunks(child, depth + 1)).join(' ') : '';
  };
  let title = '';
  const visit = (node: HtmlNode, depth = 0) => {
    if (depth > 100 || excluded(node)) return;
    if ('tagName' in node) {
      if (['h1', 'title'].includes(node.tagName) && !title) title = chunks(node).trim().slice(0, 200);
      if (node.tagName === 'main' || node.tagName === 'article' ||
          node.attrs.some((attr) => attr.name === 'role' && attr.value === 'main')) containers.push(node);
    }
    if ('childNodes' in node) node.childNodes.forEach((child) => visit(child, depth + 1));
  };
  visit(root);
  // A tiny/empty main is commonly a JS shell. Do not substitute cookie-banner text for its content.
  const text = (containers.length ? containers.map((node) => chunks(node)).sort((a, b) => b.length - a.length)[0]! : chunks(root))
    .replace(/\s+/gu, ' ').trim();
  return { text, title };
}

export async function loadPolicyDocument(candidate: PolicyCandidate, signal: AbortSignal): Promise<PolicyDocument> {
  if (!policyUrl(candidate.url)) throw new PolicyLoadError('invalid_url');
  const aborter = new AbortController();
  const stop = () => aborter.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  const timer = setTimeout(stop, 6000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    aborter.signal.throwIfAborted();
    const response = await fetch(candidate.url, {
      signal: aborter.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      redirect: 'error', cache: 'no-store', headers: { Accept: 'text/html,text/plain' },
    });
    if (!response.ok) throw new PolicyLoadError('network');
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mime !== 'text/html' && mime !== 'text/plain') throw new PolicyLoadError('unsupported');
    if (Number(response.headers.get('content-length')) > POLICY_DOWNLOAD_LIMIT) throw new PolicyLoadError('too_large');
    if (!response.body) throw new PolicyLoadError('empty');
    reader = response.body.getReader();
    let bytes = 0;
    let source = '';
    const decoder = new TextDecoder();
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > POLICY_DOWNLOAD_LIMIT) throw new PolicyLoadError('too_large');
      source += decoder.decode(next.value, { stream: true });
    }
    source += decoder.decode();
    aborter.signal.throwIfAborted();
    const extracted = mime === 'text/html' ? extractPolicy(source) : { text: source, title: candidate.title };
    const cleaned = sanitizePolicyText(extracted.text);
    if (cleaned.text.length < 100 || !/(?:data|cookie|privacy|agreement|terms|данн|куки|соглашен|конфиденциальност|услови)/iu.test(cleaned.text)) {
      throw new PolicyLoadError('empty');
    }
    return { ...candidate, title: extracted.title || candidate.title,
      kind: policyKind(extracted.title) ?? candidate.kind, ...cleaned };
  } catch (error) {
    if (error instanceof PolicyLoadError) throw error;
    if (aborter.signal.aborted) throw new PolicyLoadError('timeout');
    throw new PolicyLoadError('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    await reader?.cancel().catch(() => {});
    aborter.abort();
  }
}
