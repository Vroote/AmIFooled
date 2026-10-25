import { afterEach, expect, it, vi } from 'vitest';
import { policyCandidates, policyKind, policyUrl, validPolicyResult } from './policy-document';
import { extractPolicy, loadPolicyDocument, POLICY_DOWNLOAD_LIMIT } from './policy-loader';

const candidate = { url: 'https://example.com/terms', kind: 'terms' as const, title: 'Terms' };
const text = 'Our terms of service describe how we use cookies and personal data. '.repeat(5);
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  'javascript:alert(1)', 'http://example.com/terms', 'https://user:pass@example.com/',
  'https://127.0.0.1/', 'https://0x7f000001/', 'https://[::1]/', 'https://192.168.1.2/',
  'https://localhost/', 'https://service.local/', 'https://intranet/', 'https://example.com:8443/',
  'https://example.com/\nterms', 'https://example.com\\@127.0.0.1/', 'file:///tmp/policy',
])('rejects unsafe or non-public URL %s', (url) => expect(policyUrl(url)).toBeNull());

it('normalizes relative links, deduplicates, ranks same-origin agreements before privacy and caps candidates', () => {
  const links = [
    { href: 'https://external.com/terms', label: 'Terms' },
    { href: '/privacy', label: 'Privacy policy' },
    { href: '#cookies-modal', label: 'Cookies' },
    { href: './terms#section', label: 'Пользовательское соглашение' },
    { href: 'https://example.com/terms', label: 'Terms' },
    ...Array.from({ length: 20 }, (_, i) => ({ href: '/cookies/' + i, label: 'Cookies' })),
  ];
  const result = policyCandidates(links, 'https://example.com/');
  expect(result).toHaveLength(6);
  expect(result[0]).toMatchObject({ url: 'https://example.com/terms', kind: 'terms' });
  expect(result[1]?.kind).toBe('privacy');
  expect(result.some((item) => item.url === 'https://example.com/')).toBe(false);
  expect(policyKind('Политика обработки персональных данных')).toBe('privacy');
  expect(policyUrl('https://example.com/terms?language=ru#s')?.href).toBe('https://example.com/terms?language=ru');
  expect(() => policyCandidates([{ href: '/%EF/privacy', label: '' }], 'https://example.com')).not.toThrow();
});

it('extracts semantic content without executing markup or collecting forms/navigation/hidden values', () => {
  const html = '<title>Terms</title><nav>NAV_SECRET</nav><main><h1>Agreement</h1><p>' + text +
    '</p><script>throw "SECRET"</script><form>FORM_SECRET<input value="PASSWORD"></form>' +
    '<div hidden>HIDDEN_SECRET</div><img src="https://tracker.com/pixel"><p>A &amp; B</p></main><footer>FOOTER_SECRET</footer>';
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const result = extractPolicy(html);
  expect(result.text).toContain('A & B');
  expect(result.text).not.toMatch(/SECRET|PASSWORD|tracker/);
  expect(fetcher).not.toHaveBeenCalled();
  expect(extractPolicy('<main></main><aside>Our privacy and cookies text</aside>').text).toBe('');
});

it('loads a bounded public document without cookies/referrer/redirect and sanitizes before preview', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('<main>' + text + ' user@example.com https://example.com/x?token=SECRET</main>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  vi.stubGlobal('fetch', fetcher);
  const document = await loadPolicyDocument(candidate, signal());
  expect(document.text).not.toMatch(/user@|token=|SECRET/);
  expect(document.redacted).toBe(true);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
  expect(validPolicyResult({ status: 'ready', document, candidates: [candidate] })).toBe(true);
  expect(validPolicyResult({ status: 'ready', document: { ...document, url: 'file:///etc/passwd' }, candidates: [] })).toBe(false);
});

it('labels truncation and never sends more than the API policy limit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text.repeat(100), { headers: { 'content-type': 'text/plain' } })));
  const document = await loadPolicyDocument(candidate, signal());
  expect(document.truncated).toBe(true);
  expect(document.text.length).toBeLessThanOrEqual(20000);
});

it.each([
  [new Response(text, { status: 403, headers: { 'content-type': 'text/html' } }), 'network'],
  [new Response(text, { headers: { 'content-type': 'application/pdf' } }), 'unsupported'],
  [new Response('<main>Please sign in</main>', { headers: { 'content-type': 'text/html' } }), 'empty'],
  [new Response(text, { headers: { 'content-type': 'text/html', 'content-length': String(POLICY_DOWNLOAD_LIMIT + 1) } }), 'too_large'],
  [new Response('x'.repeat(POLICY_DOWNLOAD_LIMIT + 1), { headers: { 'content-type': 'text/plain' } }), 'too_large'],
])('rejects HTTP/format/empty/declared and streamed oversized responses', async (response, problem) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  await expect(loadPolicyDocument(candidate, signal())).rejects.toMatchObject({ problem });
});

it('aborts a hanging fetch at the deadline and does not start pre-cancelled requests', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }));
  vi.stubGlobal('fetch', fetcher);
  const pending = expect(loadPolicyDocument(candidate, signal())).rejects.toMatchObject({ problem: 'timeout' });
  await vi.advanceTimersByTimeAsync(6000); await pending;
  const aborter = new AbortController(); aborter.abort();
  await expect(loadPolicyDocument(candidate, aborter.signal)).rejects.toMatchObject({ problem: 'timeout' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['<section hidden>', '<form>', '<nav>', '<div aria-hidden="true">', '<section style="display: none">'])('does not promote a container inside excluded ancestor %s', (wrapper) => {
  const close = '</' + wrapper.slice(1).split(/[ >]/)[0] + '>';
  const result = extractPolicy(wrapper + '<article>' + 'HIDDEN account data and privacy. '.repeat(40) + '</article>' + close + '<main>' + text + '</main>');
  expect(result.text).toBe(text.trim());
  expect(result.text).not.toContain('HIDDEN');
});
