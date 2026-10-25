import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { components } from './api.generated';
import { STORAGE_KEY } from './navigation-optin';
import {
  CACHE_LIMIT,
  CACHE_TTL_MS,
  createNavigationChecks,
  navigableHostname,
  registerNavigationChecks,
  type NavigationChecks,
} from './navigation';

type BreachesResponse = components['schemas']['BreachesResponse'];

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  contains: vi.fn(),
  tabsGet: vi.fn(),
  setBadgeText: vi.fn(),
  setTitle: vi.fn(),
  setBadgeBackgroundColor: vi.fn(),
  onUpdated: vi.fn(),
  onRemoved: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: mocks.storageGet, set: mocks.storageSet } },
    permissions: { contains: mocks.contains },
    tabs: {
      get: mocks.tabsGet,
      onUpdated: { addListener: mocks.onUpdated },
      onRemoved: { addListener: mocks.onRemoved },
    },
    action: {
      setBadgeText: mocks.setBadgeText,
      setTitle: mocks.setTitle,
      setBadgeBackgroundColor: mocks.setBadgeBackgroundColor,
    },
  },
}));

const response = (hostname: string, count: number | null): BreachesResponse => ({
  hostname,
  matched_domain: hostname,
  status: count === null ? 'unavailable' : count > 0 ? 'ok' : 'not_found',
  count,
  breaches: [],
  checked_at: '2026-10-25T10:00:00Z',
  source: 'hibp',
  stale: false,
  attribution_url: 'https://haveibeenpwned.com/',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const enable = (...hosts: string[]) =>
  mocks.storageGet.mockResolvedValue({ [STORAGE_KEY]: hosts });

const badgeTextFor = (tabId: number): string[] =>
  mocks.setBadgeText.mock.calls
    .filter((call) => call[0].tabId === tabId)
    .map((call) => call[0].text as string);

beforeEach(() => {
  enable('example.com');
  mocks.storageSet.mockReset().mockResolvedValue(undefined);
  mocks.contains.mockReset().mockResolvedValue(true);
  mocks.tabsGet.mockReset().mockResolvedValue({ id: 1, url: 'https://example.com/page' });
  mocks.setBadgeText.mockReset().mockResolvedValue(undefined);
  mocks.setTitle.mockReset().mockResolvedValue(undefined);
  mocks.setBadgeBackgroundColor.mockReset().mockResolvedValue(undefined);
  mocks.onUpdated.mockReset();
  mocks.onRemoved.mockReset();
});

describe('what is allowed to reach the network', () => {
  it('sends only the hostname of an opted-in site and shows its count', async () => {
    const checkBreaches = vi.fn().mockResolvedValue(response('example.com', 2));
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, 'https://example.com/private?token=SECRET#x');

    expect(checkBreaches).toHaveBeenCalledTimes(1);
    expect(checkBreaches.mock.calls[0]?.[0]).toBe('example.com');
    expect(JSON.stringify(checkBreaches.mock.calls[0])).not.toContain('SECRET');
    expect(badgeTextFor(1)).toEqual(['2']);
  });

  it.each([
    ['not opted in', () => enable('other.example')],
    ['permission revoked outside the popup', () => mocks.contains.mockResolvedValue(false)],
  ])('sends nothing when the site is %s, and clears a previous number', async (_label, arrange) => {
    arrange();
    const checkBreaches = vi.fn();
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, 'https://example.com/page');

    expect(checkBreaches).not.toHaveBeenCalled();
    expect(badgeTextFor(1)).toEqual(['']);
  });

  it('sends nothing in incognito', async () => {
    const checkBreaches = vi.fn();
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, 'https://example.com/page', true);
    expect(checkBreaches).not.toHaveBeenCalled();
    expect(badgeTextFor(1)).toEqual(['']);
  });

  it.each([
    'chrome://settings',
    'file:///private/file',
    'chrome-extension://abc/page.html',
    'about:blank',
    undefined,
  ])('ignores an unsupported navigation target %s', async (url) => {
    const checkBreaches = vi.fn();
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, url);
    expect(checkBreaches).not.toHaveBeenCalled();
    expect(badgeTextFor(1)).toEqual(['']);
    expect(navigableHostname(url)).toBeNull();
  });

  it('normalizes IDNA and case like the API hostname contract', () => {
    expect(navigableHostname('https://ПРИМЕР.РФ./policy')).toBe('xn--e1afmkfd.xn--p1ai');
    expect(navigableHostname('https://WWW.Example.com')).toBe('www.example.com');
  });
});

describe('repeated events and the bounded cache', () => {
  it('asks once while a request for the same navigation is still in flight', async () => {
    const pendingCall = deferred<BreachesResponse>();
    const checkBreaches = vi.fn().mockReturnValue(pendingCall.promise);
    const checks = createNavigationChecks({ checkBreaches });

    const first = checks.onNavigated(1, 'https://example.com/a');
    const second = checks.onNavigated(1, 'https://example.com/a');
    pendingCall.resolve(response('example.com', 1));
    await Promise.all([first, second]);

    expect(checkBreaches).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached count inside the TTL and asks again once it expires', async () => {
    let clock = 1_000;
    const checkBreaches = vi.fn().mockResolvedValue(response('example.com', 4));
    const checks = createNavigationChecks({ checkBreaches, now: () => clock });

    await checks.onNavigated(1, 'https://example.com/a');
    await checks.onNavigated(2, 'https://example.com/b');
    expect(checkBreaches).toHaveBeenCalledTimes(1);
    expect(badgeTextFor(2)).toEqual(['4']);

    clock += CACHE_TTL_MS + 1;
    await checks.onNavigated(3, 'https://example.com/c');
    expect(checkBreaches).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry instead of growing into a record of visited sites', async () => {
    const hosts = Array.from({ length: CACHE_LIMIT + 1 }, (_, i) => `site${i}.example`);
    enable(...hosts);
    const checkBreaches = vi
      .fn()
      .mockImplementation(async (hostname: string) => response(hostname, 1));
    const checks = createNavigationChecks({ checkBreaches });

    for (const [index, host] of hosts.entries()) {
      mocks.tabsGet.mockResolvedValue({ id: index, url: `https://${host}/` });
      await checks.onNavigated(index, `https://${host}/`);
    }
    expect(checkBreaches).toHaveBeenCalledTimes(CACHE_LIMIT + 1);

    // The first host was pushed out, so it is asked about again rather than remembered.
    mocks.tabsGet.mockResolvedValue({ id: 99, url: 'https://site0.example/' });
    await checks.onNavigated(99, 'https://site0.example/');
    expect(checkBreaches).toHaveBeenCalledTimes(CACHE_LIMIT + 2);
  });

  it('forgets cached counts when asked to', async () => {
    const checkBreaches = vi.fn().mockResolvedValue(response('example.com', 1));
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, 'https://example.com/a');
    checks.clearCache();
    await checks.onNavigated(2, 'https://example.com/a');
    expect(checkBreaches).toHaveBeenCalledTimes(2);
  });
});

describe('an answer never lands on the wrong site', () => {
  it('drops a late answer when the tab already moved to another site', async () => {
    enable('example.com', 'second.example');
    const slow = deferred<BreachesResponse>();
    const checkBreaches = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(response('second.example', 5));
    const checks = createNavigationChecks({ checkBreaches });

    const first = checks.onNavigated(1, 'https://example.com/a');
    mocks.tabsGet.mockResolvedValue({ id: 1, url: 'https://second.example/b' });
    await checks.onNavigated(1, 'https://second.example/b');
    slow.resolve(response('example.com', 9));
    await first;

    expect(badgeTextFor(1)).toEqual(['5']);
    expect(badgeTextFor(1)).not.toContain('9');
  });

  it('does not paint a badge when the tab navigated away during the request', async () => {
    const checkBreaches = vi.fn().mockResolvedValue(response('example.com', 7));
    const checks = createNavigationChecks({ checkBreaches });
    mocks.tabsGet.mockResolvedValue({ id: 1, url: 'https://elsewhere.example/' });

    await checks.onNavigated(1, 'https://example.com/a');
    expect(badgeTextFor(1)).toEqual([]);
  });

  it('drops the answer for a tab that was closed meanwhile', async () => {
    const slow = deferred<BreachesResponse>();
    // The tab must close while the request is already in flight, which is the moment
    // checkBreaches is entered: closing before that would race the opt-in lookups.
    const holder: { checks?: NavigationChecks } = {};
    holder.checks = createNavigationChecks({
      checkBreaches: () => {
        holder.checks?.onTabClosed(1);
        return slow.promise;
      },
    });

    const navigation = holder.checks.onNavigated(1, 'https://example.com/a');
    slow.resolve(response('example.com', 3));
    await navigation;

    expect(badgeTextFor(1)).toEqual([]);
  });

  it('does not paint a cached count after the tab moved on while storage was slow', async () => {
    enable('a.example', 'b.example');
    const checkBreaches = vi
      .fn()
      .mockImplementation(async (host: string) => response(host, host === 'a.example' ? 9 : 5));
    const checks = createNavigationChecks({ checkBreaches });

    // Warm the cache for a.example, so the stale handler takes the cached branch.
    mocks.tabsGet.mockResolvedValue({ id: 2, url: 'https://a.example/' });
    await checks.onNavigated(2, 'https://a.example/');

    // The a.example event in tab 1 stalls inside the opt-in lookup.
    const slowStorage = deferred<Record<string, string[]>>();
    mocks.storageGet.mockReturnValueOnce(slowStorage.promise);
    const stale = checks.onNavigated(1, 'https://a.example/');

    // Meanwhile tab 1 goes to b.example and finishes.
    mocks.tabsGet.mockResolvedValue({ id: 1, url: 'https://b.example/' });
    await checks.onNavigated(1, 'https://b.example/');
    slowStorage.resolve({ [STORAGE_KEY]: ['a.example', 'b.example'] });
    await stale;

    expect(badgeTextFor(1)).toEqual(['5']);
  });

  it('does not clear a newer badge when a stale handler finds the site disabled', async () => {
    enable('b.example');
    const checkBreaches = vi.fn().mockImplementation(async (host: string) => response(host, 5));
    const checks = createNavigationChecks({ checkBreaches });

    // The a.example event stalls, and a.example turns out not to be opted in.
    const slowStorage = deferred<Record<string, string[]>>();
    mocks.storageGet.mockReturnValueOnce(slowStorage.promise);
    const stale = checks.onNavigated(1, 'https://a.example/');

    mocks.tabsGet.mockResolvedValue({ id: 1, url: 'https://b.example/' });
    await checks.onNavigated(1, 'https://b.example/');
    slowStorage.resolve({ [STORAGE_KEY]: ['b.example'] });
    await stale;

    expect(badgeTextFor(1)).toEqual(['5']);
  });

  it('refuses an answer about a different hostname', async () => {
    const checkBreaches = vi.fn().mockResolvedValue(response('other.example', 8));
    const checks = createNavigationChecks({ checkBreaches });
    await checks.onNavigated(1, 'https://example.com/a');
    expect(badgeTextFor(1)).toEqual(['?']);
  });
});

describe('unknown is shown as unknown', () => {
  it.each([
    ['a transport failure', () => Promise.reject(new Error('offline'))],
    ['an aborted request', () => Promise.reject(new DOMException('x', 'AbortError'))],
    ['HTTP 200 with unavailable status', () => Promise.resolve(response('example.com', null))],
  ])('shows "?" for %s', async (_label, outcome) => {
    const checks = createNavigationChecks({ checkBreaches: outcome });
    await checks.onNavigated(1, 'https://example.com/a');
    expect(badgeTextFor(1)).toEqual(['?']);
    expect(mocks.setTitle).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('это не «утечек не было»') }),
    );
  });

  it('asks again after an HTTP 200 unavailable, instead of freezing "?" for the whole TTL', async () => {
    const checkBreaches = vi
      .fn()
      .mockResolvedValueOnce(response('example.com', null))
      .mockResolvedValue(response('example.com', 4));
    const checks = createNavigationChecks({ checkBreaches });

    await checks.onNavigated(1, 'https://example.com/a');
    expect(badgeTextFor(1)).toEqual(['?']);

    // Same site, well inside the TTL: the recovered source must be asked again.
    await checks.onNavigated(2, 'https://example.com/a');
    expect(checkBreaches).toHaveBeenCalledTimes(2);
    expect(badgeTextFor(2)).toEqual(['4']);
  });

  it('does not cache a failure, so the next visit asks again', async () => {
    const checkBreaches = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response('example.com', 1));
    const checks = createNavigationChecks({ checkBreaches });

    await checks.onNavigated(1, 'https://example.com/a');
    await checks.onNavigated(2, 'https://example.com/a');

    expect(checkBreaches).toHaveBeenCalledTimes(2);
    expect(badgeTextFor(2)).toEqual(['1']);
  });

  it('survives a browser that refuses to paint the badge at all', async () => {
    mocks.setBadgeText.mockRejectedValue(new Error('no such tab'));
    const checks = createNavigationChecks({
      checkBreaches: () => Promise.resolve(response('example.com', 1)),
    });
    await expect(checks.onNavigated(1, 'https://example.com/a')).resolves.toBeUndefined();
  });
});

describe('registration', () => {
  it('reacts only to a finished top-level navigation', async () => {
    const checkBreaches = vi.fn().mockResolvedValue(response('example.com', 1));
    registerNavigationChecks({ checkBreaches });

    const listener = mocks.onUpdated.mock.calls[0]?.[0] as (
      tabId: number,
      info: { status?: string },
      tab: { url?: string; incognito?: boolean },
    ) => void;
    expect(mocks.onRemoved).toHaveBeenCalledTimes(1);

    listener(1, { status: 'loading' }, { url: 'https://example.com/a' });
    expect(checkBreaches).not.toHaveBeenCalled();

    listener(1, { status: 'complete' }, { url: 'https://example.com/a' });
    await vi.waitFor(() => expect(checkBreaches).toHaveBeenCalledTimes(1));
  });
});
