import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENABLED_SITES,
  STORAGE_KEY,
  disableSite,
  enableSite,
  hasSitePermission,
  isEnabled,
  originPatternFor,
  readEnabledHosts,
} from './navigation-optin';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  request: vi.fn(),
  remove: vi.fn(),
  contains: vi.fn(),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: mocks.get, set: mocks.set } },
    permissions: { request: mocks.request, remove: mocks.remove, contains: mocks.contains },
  },
}));

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ [STORAGE_KEY]: [] });
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockResolvedValue(true);
  mocks.remove.mockReset().mockResolvedValue(true);
  mocks.contains.mockReset().mockResolvedValue(true);
});

describe('stored opt-in is parsed as unknown data', () => {
  it('normalizes hostnames and drops anything that is not a valid host', async () => {
    mocks.get.mockResolvedValue({
      [STORAGE_KEY]: ['EXAMPLE.com.', 'ПРИМЕР.РФ', 'https://evil.example/path', 42, null, 'example.com'],
    });
    expect(await readEnabledHosts()).toEqual(['example.com', 'xn--e1afmkfd.xn--p1ai']);
  });

  it.each([{ [STORAGE_KEY]: 'not-an-array' }, {}, { [STORAGE_KEY]: null }])(
    'treats damaged storage %j as nothing enabled',
    async (stored) => {
      mocks.get.mockResolvedValue(stored);
      expect(await readEnabledHosts()).toEqual([]);
    },
  );

  it('does not fail when storage itself is unavailable', async () => {
    mocks.get.mockRejectedValue(new Error('no storage'));
    expect(await readEnabledHosts()).toEqual([]);
    expect(await isEnabled('example.com')).toBe(false);
  });
});

describe('enabling one site', () => {
  it('asks only for that origin and stores it after Chrome grants it', async () => {
    expect(await enableSite('WWW.Example.com')).toBe('enabled');
    expect(mocks.request).toHaveBeenCalledWith({ origins: ['*://www.example.com/*'] });
    expect(mocks.set).toHaveBeenCalledWith({ [STORAGE_KEY]: ['www.example.com'] });
  });

  it('stores nothing when the user refuses the permission', async () => {
    mocks.request.mockResolvedValue(false);
    expect(await enableSite('example.com')).toBe('denied');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/page', 'me@example.com', '[::1]', ''])(
    'refuses to request anything for %j',
    async (hostname) => {
      expect(await enableSite(hostname)).toBe('invalid');
      expect(mocks.request).not.toHaveBeenCalled();
      expect(originPatternFor(hostname)).toBeNull();
    },
  );

  it('keeps the list bounded instead of collecting sites', async () => {
    const hosts = Array.from({ length: MAX_ENABLED_SITES }, (_, i) => `site${i}.example`);
    mocks.get.mockResolvedValue({ [STORAGE_KEY]: hosts });
    expect(await enableSite('one-more.example')).toBe('limit');
    expect(mocks.request).not.toHaveBeenCalled();
    // An already enabled site is still allowed through at the limit.
    expect(await enableSite('site0.example')).toBe('enabled');
  });

  it('reports an unwritable setting instead of claiming success', async () => {
    mocks.set.mockRejectedValue(new Error('quota'));
    expect(await enableSite('example.com')).toBe('unavailable');
  });
});

describe('disabling one site', () => {
  it('drops the setting before the permission, so the next navigation sends nothing', async () => {
    const order: string[] = [];
    mocks.set.mockImplementation(async () => void order.push('set'));
    mocks.remove.mockImplementation(async () => void order.push('remove'));
    mocks.get.mockResolvedValue({ [STORAGE_KEY]: ['example.com', 'other.example'] });

    expect(await disableSite('example.com')).toBe('disabled');
    expect(order).toEqual(['set', 'remove']);
    expect(mocks.set).toHaveBeenCalledWith({ [STORAGE_KEY]: ['other.example'] });
    expect(mocks.remove).toHaveBeenCalledWith({ origins: ['*://example.com/*'] });
  });

  it('still counts as disabled when only the permission removal fails', async () => {
    mocks.get.mockResolvedValue({ [STORAGE_KEY]: ['example.com'] });
    mocks.remove.mockRejectedValue(new Error('cannot remove'));
    expect(await disableSite('example.com')).toBe('disabled');
    expect(mocks.set).toHaveBeenCalledWith({ [STORAGE_KEY]: [] });
  });
});

describe('granted permission is the authority, not the stored list', () => {
  it('reports a permission revoked outside the popup', async () => {
    mocks.get.mockResolvedValue({ [STORAGE_KEY]: ['example.com'] });
    mocks.contains.mockResolvedValue(false);
    expect(await isEnabled('example.com')).toBe(true);
    expect(await hasSitePermission('example.com')).toBe(false);
  });

  it('never claims a permission for an invalid or unreadable host', async () => {
    expect(await hasSitePermission('a/b')).toBe(false);
    mocks.contains.mockRejectedValue(new Error('denied'));
    expect(await hasSitePermission('example.com')).toBe(false);
  });
});
