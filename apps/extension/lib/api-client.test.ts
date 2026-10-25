import { afterEach, expect, it, vi } from 'vitest';
import { requestApi } from './api-client';
import { parseApiBase, apiHostPermission } from './api-config';

const input = { hostname: 'example.com', policy_text: 'Public policy', evidence: [] };
const response = { hostname: 'example.com', status: 'ok', mode: 'rules', summary: 'Summary', findings: [], limitations: [] };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('accepts only HTTPS or loopback HTTP with a concrete permission', () => {
  expect(parseApiBase('https://api.example.com/v1base/')).toBe('https://api.example.com/v1base');
  expect(apiHostPermission('http://127.0.0.1:8000')).toBe('http://127.0.0.1/*');
  for (const url of ['http://remote.example', 'https://user:pass@api.example', 'https://api.example/?secret=x', 'https://*.example.com']) {
    expect(() => parseApiBase(url)).toThrow();
  }
});

it('POSTs only the strict payload without credentials, redirects, referrer or caching', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(response));
  vi.stubGlobal('fetch', fetcher);
  expect(await requestApi('analyze', input, signal(), 'http://127.0.0.1:8000')).toEqual(response);
  expect(fetcher).toHaveBeenCalledWith(new URL('http://127.0.0.1:8000/v1/analyze'), expect.objectContaining({
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
    body: JSON.stringify(input), referrerPolicy: 'no-referrer',
  }));
});

it.each([[501, 'not_implemented'], [422, 'invalid_request'], [413, 'too_large'], [503, 'server']])('classifies HTTP %i without displaying its body', async (status, kind) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE BODY', { status: Number(status) })));
  await expect(requestApi('analyze', input, signal(), 'http://127.0.0.1:8000')).rejects.toMatchObject({ failure: { kind } });
});

it.each([
  '{invalid', JSON.stringify({ ...response, hostname: 'other.com' }),
  JSON.stringify({ ...response, status: ['ok'] }),
  JSON.stringify({ ...response, findings: [{ title: 'bad', explanation: 'bad', severity: 'warning', policy_quote: 'fabricated', evidence_ids: [] }] }),
])('rejects malformed responses and fabricated findings', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(requestApi('analyze', input, signal(), 'http://127.0.0.1:8000')).rejects.toMatchObject({ failure: { kind: 'malformed' } });
});

it('keeps unavailable distinct from zero breaches and validates count/status', async () => {
  const data = { hostname: 'example.com', matched_domain: 'example.com', status: 'unavailable', count: null, breaches: [], checked_at: '2026-10-25T11:00:00Z', source: 'hibp', stale: false, attribution_url: 'https://haveibeenpwned.com/' };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(data))));
  expect(await requestApi('breaches', { hostname: 'example.com' }, signal(), 'http://127.0.0.1:8000')).toEqual(data);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...data, count: 0 })));
  await expect(requestApi('breaches', { hostname: 'example.com' }, signal(), 'http://127.0.0.1:8000')).rejects.toMatchObject({ failure: { kind: 'malformed' } });
});

it('rejects oversized bodies before parsing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1))));
  await expect(requestApi('analyze', input, signal(), 'http://127.0.0.1:8000')).rejects.toMatchObject({ failure: { kind: 'malformed' } });
});

it('reports offline separately and propagates cancellation to HTTP', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
  await expect(requestApi('analyze', input, signal(), 'http://127.0.0.1:8000')).rejects.toMatchObject({ failure: { kind: 'offline' } });
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })));
  const pending = requestApi('analyze', input, controller.signal, 'http://127.0.0.1:8000');
  controller.abort();
  await expect(pending).rejects.toMatchObject({ failure: { kind: 'timeout' } });
});
