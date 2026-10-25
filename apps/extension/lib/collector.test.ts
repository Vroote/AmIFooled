import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCollection, collectPageEvidence, normalizeHostname } from './collector';
import type { PageSnapshot } from './collector-page';
import { sanitizePolicyText } from './collector-policy';

const mocks = vi.hoisted(() => ({ query: vi.fn(), get: vi.fn(), inject: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  tabs: { query: mocks.query, get: mocks.get }, scripting: { executeScript: mocks.inject },
} }));

const fixture = (overrides: Partial<PageSnapshot> = {}): PageSnapshot => ({
  hostname: 'www.example.com', resourceHosts: ['cdn.example.com', 'stats.example.net'],
  resourceScanLimited: false, resourcesAvailable: true, visibleCookieCount: 2,
  selectedText: 'Мы используем cookies.', selectionState: 'ok', selectionTruncated: false,
  ...overrides,
});

describe('bounded payload and public policy', () => {
  it('normalizes IDNA and rejects URL syntax and invalid DNS labels', () => {
    expect(normalizeHostname('ПРИМЕР.РФ.')).toBe('xn--e1afmkfd.xn--p1ai');
    for (const value of ['https://example.com', 'me@example.com', 'a/b', 'a?b', 'a#b', 'a:80', '[::1]', '-a.com', 'a..com', 'a'.repeat(64) + '.com']) {
      expect(normalizeHostname(value)).toBeNull();
    }
  });

  it('excludes same-site subdomains, deduplicates resources and distinguishes private suffix tenants', () => {
    const result = buildCollection(fixture({ hostname: 'one.github.io', resourceHosts: [
      'cdn.one.github.io', 'two.github.io', 'TWO.GITHUB.IO', 'example.net', 'not a host',
    ] }), { source: 'selection' });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected payload');
    expect(result.payload.evidence?.map((entry) => entry.value)).toEqual(['2', 'example.net', 'two.github.io']);
    expect(Object.keys(result.payload).sort()).toEqual(['evidence', 'hostname', 'policy_text']);
  });

  it('keeps at most 100 facts and a bounded policy without splitting a surrogate pair', () => {
    const result = buildCollection(fixture({ resourceHosts: Array.from({ length: 150 }, (_, i) => `site${i}.net`) }), {
      source: 'manual', text: 'x'.repeat(19_999) + '😀 tail',
    });
    if (result.status !== 'ready') throw new Error('Expected payload');
    expect(result.payload.policy_text).toBe('x'.repeat(19_999));
    expect(result.payload.evidence).toHaveLength(100);
    expect(new Set(result.payload.evidence?.map((entry) => entry.id)).size).toBe(100);
    expect(result.payload.evidence?.every((entry) => entry.value.length <= 500 && entry.limitation.length <= 500)).toBe(true);
    expect(result.notices.some((notice) => notice.includes('сокращён'))).toBe(true);
  });

  it('redacts email, URL credentials, paths and queries; preserves unexecuted plain text', () => {
    const result = sanitizePolicyText('Hi\u200B user@example.com https://example.net/private?token=SECRET#email <script>alert(1)</script>');
    expect(result.text).toBe('Hi [email скрыт] example.net <script>alert(1)</script>');
    expect(result.redacted).toBe(true);
    expect(sanitizePolicyText('https://user:password@example.net/private').text).toBe('example.net');
    expect(sanitizePolicyText('контакт@пример.рф').text).toBe('[email скрыт]');
    expect(sanitizePolicyText('"John Doe"@example.org').text).not.toContain('@');
    expect(sanitizePolicyText('A\u200bB')).toMatchObject({ text: 'AB', redacted: true });
  });

  it.each(['', ' \n\t ', '\u0000\u200b'])('returns needs_policy for empty text %j', (text) => {
    const result = buildCollection(fixture(), { source: 'manual', text });
    expect(result).toMatchObject({ status: 'needs_policy', reason: 'empty' });
    expect(result).not.toHaveProperty('payload');
  });

  it('does not mistake denied cookie/resource access for a zero count or safety', () => {
    const result = buildCollection(fixture({ visibleCookieCount: null, resourcesAvailable: false, resourceHosts: [] }), { source: 'selection' });
    if (result.status !== 'ready') throw new Error('Expected payload');
    expect(result.payload.evidence).toEqual([]);
    expect(result.notices.join(' ')).toContain('не означает');
    expect(result.notices.join(' ')).toContain('определить не удалось');
  });

  it('requires manual input after blocked form selection, and never reuses that selection', () => {
    const snapshot = fixture({ selectionState: 'blocked', selectedText: 'private form' });
    expect(buildCollection(snapshot, { source: 'selection' })).toMatchObject({ status: 'needs_policy', reason: 'blocked_selection' });
    expect(buildCollection(snapshot, { source: 'manual', text: 'Public policy' })).toMatchObject({ status: 'ready', payload: { policy_text: 'Public policy' } });
  });
});

describe('user-invoked browser collection', () => {
  beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([{ id: 7, url: 'https://www.example.com/policy?private=1', active: true }]);
    mocks.get.mockReset().mockResolvedValue({ id: 7, url: 'https://www.example.com/policy?private=1', active: true });
    mocks.inject.mockReset().mockResolvedValue([{ frameId: 0, result: fixture() }]);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('injects only into the main isolated frame and returns no full page URL', async () => {
    const result = await collectPageEvidence();
    expect(result.status).toBe('ready');
    expect(mocks.inject).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7, frameIds: [0] }, world: 'ISOLATED', args: [true],
    }));
    expect(JSON.stringify(result)).not.toContain('private=1');
  });

  it('does not read page selection for manual policy input', async () => {
    expect(await collectPageEvidence({ source: 'manual', text: 'Public policy' })).toMatchObject({ status: 'ready', payload: { policy_text: 'Public policy' } });
    expect(mocks.inject).toHaveBeenCalledWith(expect.objectContaining({ args: [false] }));
  });

  it.each(['chrome://settings', 'chrome-extension://other/page.html', 'file:///private/file',
    'https://chromewebstore.google.com/detail/foo', 'https://chrome.google.com/webstore/detail/foo', 'about:blank'])('rejects restricted page %s without injection', async (url) => {
    mocks.query.mockResolvedValue([{ id: 7, url }]);
    expect(await collectPageEvidence()).toMatchObject({ status: 'error', code: 'unsupported_page' });
    expect(mocks.inject).not.toHaveBeenCalled();
  });

  it('handles no tab, unavailable URL and incognito', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await collectPageEvidence()).toMatchObject({ code: 'no_active_tab' });
    mocks.query.mockResolvedValue([{ id: 7 }]);
    expect(await collectPageEvidence()).toMatchObject({ code: 'unsupported_page' });
    mocks.query.mockResolvedValue([{ id: 7, incognito: true }]);
    expect(await collectPageEvidence()).toMatchObject({ code: 'incognito' });
    expect(mocks.inject).not.toHaveBeenCalled();
  });

  it('does not leak browser exception URLs when injection is denied', async () => {
    mocks.inject.mockRejectedValue(new Error('Cannot access https://secret.example/private?email=me@secret.example'));
    const result = await collectPageEvidence();
    expect(result).toMatchObject({ code: 'access_denied' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    { url: 'https://www.example.com/other', active: true },
    { url: 'https://www.example.com/policy?private=1', active: false },
    { url: 'https://www.example.com/policy?private=1', pendingUrl: 'https://other.net', active: true },
  ])('discards observations after a navigation or tab switch', async (current) => {
    mocks.get.mockResolvedValue({ id: 7, ...current });
    expect(await collectPageEvidence()).toMatchObject({ code: 'page_changed' });
  });

  it('checks the injected document hostname too', async () => {
    mocks.inject.mockResolvedValue([{ frameId: 0, result: fixture({ hostname: 'other.net' }) }]);
    expect(await collectPageEvidence()).toMatchObject({ code: 'page_changed' });
  });

  it('bounds a hung browser call and removes its timer', async () => {
    vi.useFakeTimers();
    mocks.query.mockReturnValue(new Promise(() => {}));
    const result = collectPageEvidence();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ code: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not inject after a timed-out tab query eventually resolves', async () => {
    vi.useFakeTimers();
    let finishQuery!: (tabs: { id: number; url: string }[]) => void;
    mocks.query.mockReturnValue(new Promise((resolve) => { finishQuery = resolve; }));
    const result = collectPageEvidence();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ code: 'timeout' });
    finishQuery([{ id: 7, url: 'https://www.example.com' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.inject).not.toHaveBeenCalled();
  });
});
