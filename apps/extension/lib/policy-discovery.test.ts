import { beforeEach, expect, it, vi } from 'vitest';
import { discoverPolicy, retrievePolicy } from './policy-discovery';

const mocks = vi.hoisted(() => ({ contains: vi.fn(), load: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: mocks.contains } } }));
vi.mock('./policy-loader', () => ({ loadPolicyDocument: mocks.load, PolicyLoadError: class extends Error {} }));
const candidate = (url: string) => ({ url, kind: 'terms' as const, title: 'Terms' });
beforeEach(() => { mocks.contains.mockResolvedValue(false); mocks.load.mockResolvedValue({ text: 'document' }); });

it('never fetches another origin automatically, even with a previously granted permission', async () => {
  mocks.contains.mockResolvedValue(true);
  const result = await discoverPolicy('https://example.com', [candidate('https://other.com/terms')], new AbortController().signal);
  expect(result).toMatchObject({ status: 'missing', problem: 'permission' });
  expect(mocks.load).not.toHaveBeenCalled();
});

it('asks for exact origin permission before a user-requested cross-origin fetch', async () => {
  const item = candidate('https://other.com/terms');
  expect(await retrievePolicy(item.url, 'https://example.com', [item], new AbortController().signal)).toMatchObject({ problem: 'permission' });
  expect(mocks.contains).toHaveBeenCalledWith({ origins: ['https://other.com/*'] });
  expect(mocks.load).not.toHaveBeenCalled();
  mocks.contains.mockResolvedValue(true);
  expect(await retrievePolicy(item.url, 'https://example.com', [item], new AbortController().signal)).toMatchObject({ status: 'ready' });
  expect(mocks.load).toHaveBeenCalledOnce();
});

it('loads same-origin without persistent permission and limits automatic attempts', async () => {
  mocks.load.mockRejectedValue(new Error('offline'));
  const items = Array.from({ length: 6 }, (_, i) => candidate('https://example.com/terms/' + i));
  expect(await discoverPolicy('https://example.com', items, new AbortController().signal)).toMatchObject({ problem: 'network' });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(mocks.contains).not.toHaveBeenCalled();
});
