import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { registerBackgroundTransport } from './controller-background';
import { createRealController } from './controller-real';

const mock = vi.hoisted(() => {
  const event = () => {
    const listeners = new Set<(...args: unknown[]) => void>();
    return {
      addListener: vi.fn((fn: (...args: unknown[]) => void) => { listeners.add(fn); }),
      removeListener: vi.fn((fn: (...args: unknown[]) => void) => { listeners.delete(fn); }),
      emit: (...args: unknown[]) => [...listeners].forEach((fn) => fn(...args)),
      clear: () => listeners.clear(),
    };
  };
  const connected = event();
  const updated = event();
  const activated = event();
  const removed = event();
  const sent: unknown[] = [];
  const ports: { disconnect(): void }[] = [];
  const connect = () => {
    const clientMessages = event(), serverMessages = event();
    const clientDisconnect = event(), serverDisconnect = event();
    let closed = false;
    const disconnect = () => {
      if (closed) return;
      closed = true;
      clientDisconnect.emit(); serverDisconnect.emit();
    };
    const client = {
      name: 'amifooled:popup:v1', onMessage: clientMessages, onDisconnect: clientDisconnect,
      disconnect, postMessage: (value: unknown) => {
        sent.push(value);
        queueMicrotask(() => { if (!closed) serverMessages.emit(value); });
      },
    };
    const server = {
      name: 'amifooled:popup:v1', sender: { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' },
      onMessage: serverMessages, onDisconnect: serverDisconnect, disconnect,
      postMessage: (value: unknown) => queueMicrotask(() => { if (!closed) clientMessages.emit(value); }),
    };
    ports.push(client);
    connected.emit(server);
    return client;
  };
  return { connected, updated, activated, removed, ports, sent,
    browser: {
      runtime: { id: 'extension-id', getURL: (path: string) => 'chrome-extension://extension-id' + path, onConnect: connected, connect: vi.fn(connect) },
      permissions: { contains: vi.fn(), request: vi.fn() },
      tabs: { query: vi.fn(), get: vi.fn(), onUpdated: updated, onActivated: activated, onRemoved: removed },
      scripting: { executeScript: vi.fn() },
    },
  };
});
vi.mock('wxt/browser', () => ({ browser: mock.browser }));

const analysis = { hostname: 'example.com', status: 'ok', mode: 'rules', summary: 'Result', findings: [], limitations: [] };
let doc = 'document-A';
beforeEach(() => {
  mock.sent.length = 0;
  doc = 'document-A';
  mock.connected.clear(); mock.updated.clear(); mock.activated.clear(); mock.removed.clear();
  mock.browser.tabs.query.mockResolvedValue([{ id: 7, url: 'https://example.com/policy?secret=1', active: true }]);
  mock.browser.tabs.get.mockResolvedValue({ id: 7, url: 'https://example.com/policy?secret=1', active: true });
  mock.browser.scripting.executeScript.mockImplementation((options) => Promise.resolve([{
    documentId: doc, frameId: 0, result: options.args ? {
      hostname: 'example.com', resourceHosts: ['cdn.other.com'], resourceScanLimited: false,
      resourcesAvailable: true, visibleCookieCount: 2, selectedText: options.args[0] ? 'Selected public policy.' : '',
      selectionState: options.args[0] ? 'ok' : 'skipped', selectionTruncated: false,
    } : 'example.com',
  }]));
  registerBackgroundTransport('http://127.0.0.1:8000');
});
afterEach(() => {
  mock.ports.splice(0).forEach((port) => port.disconnect());
  vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers();
});

it('prepares and reads policy locally, then sends confirmed analysis only through the background', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(analysis));
  vi.stubGlobal('fetch', fetcher);
  const controller = createRealController();
  const prepared = await controller.prepare();
  expect(controller.demo).toBe(false);
  expect(prepared.evidence).toHaveLength(2);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await controller.readPolicyFromPage?.()).toBe('Selected public policy.');
  expect(fetcher).not.toHaveBeenCalled();
  const input = { hostname: 'example.com', policyText: 'Public policy.', evidence: prepared.evidence };
  expect(await controller.analyze(input, new AbortController().signal)).toEqual(analysis);
  const body = String(fetcher.mock.calls[0]?.[1].body);
  expect(body).not.toContain('secret=1');
  expect(JSON.parse(body)).toEqual({ hostname: input.hostname, policy_text: input.policyText, evidence: prepared.evidence });
});

it('rejects modified evidence and unsanitized policy before network', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = createRealController();
  const prepared = await controller.prepare();
  for (const input of [
    { hostname: 'example.com', policyText: 'email user@example.com', evidence: prepared.evidence },
    { hostname: 'example.com', policyText: 'Public policy.', evidence: [] },
  ]) {
    await expect(controller.analyze(input, new AbortController().signal)).rejects.toMatchObject({ failure: { kind: 'invalid_request' } });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('invalidates document generation and cancels HTTP on navigation, even for the same hostname', async () => {
  let aborted = false;
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
  })));
  const controller = createRealController();
  const invalidated = vi.fn(); controller.subscribeInvalidation?.(invalidated);
  const prepared = await controller.prepare();
  const pending = controller.analyze({ hostname: 'example.com', policyText: 'Public policy.', evidence: prepared.evidence }, new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ failure: { kind: 'page_changed' } });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  doc = 'document-B';
  mock.updated.emit(7, { status: 'loading' });
  await rejected;
  expect(invalidated).toHaveBeenCalled();
  expect(aborted).toBe(true);
});

it('drops late HTTP data when document changes without a delivered tab event', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => { doc = 'document-B'; return Promise.resolve(Response.json(analysis)); }));
  const controller = createRealController();
  const prepared = await controller.prepare();
  await expect(controller.analyze({ hostname: 'example.com', policyText: 'Public policy.', evidence: prepared.evidence }, new AbortController().signal))
    .rejects.toMatchObject({ failure: { kind: 'page_changed' } });
});

it('cancels requests when popup closes and prepares a fresh context after worker/port restart', async () => {
  const controller = createRealController();
  await controller.prepare();
  mock.ports.at(-1)?.disconnect();
  doc = 'document-restarted';
  const next = await controller.prepare();
  expect(next.page).toEqual({ status: 'ready', hostname: 'example.com' });
  expect(next.evidence).toHaveLength(2);
  controller.dispose?.();
});

it('propagates AbortSignal cancellation and leaves the independent card usable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })));
  const controller = createRealController();
  await controller.prepare();
  const aborter = new AbortController();
  const pending = controller.checkBreaches('example.com', aborter.signal);
  const rejected = expect(pending).rejects.toMatchObject({ failure: { kind: 'timeout' } });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  aborter.abort(); await rejected;
  expect(await controller.readPolicyFromPage?.()).toBe('Selected public policy.');
});

it('does not duplicate HTTP on concurrent repeat clicks', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const controller = createRealController();
  const prepared = await controller.prepare();
  const input = { hostname: 'example.com', policyText: 'Public policy.', evidence: prepared.evidence };
  const first = controller.analyze(input, new AbortController().signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await expect(controller.analyze(input, new AbortController().signal)).rejects.toMatchObject({ failure: { kind: 'unknown' } });
  expect(fetcher).toHaveBeenCalledOnce();
  finish(Response.json(analysis));
  expect(await first).toEqual(analysis);
});

it('does not hijack unrelated extension ports', () => {
  const disconnect = vi.fn();
  mock.connected.emit({ name: 'another-feature', disconnect });
  expect(disconnect).not.toHaveBeenCalled();
});

it('keeps an idle popup context alive without collecting again or sending HTTP', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValue(Response.json(analysis));
  vi.stubGlobal('fetch', fetcher);
  const controller = createRealController();
  const invalidated = vi.fn(); controller.subscribeInvalidation?.(invalidated);
  const prepared = await controller.prepare();
  const inspections = mock.browser.scripting.executeScript.mock.calls.length;
  await vi.advanceTimersByTimeAsync(75_000);
  expect(mock.sent.filter((message) => JSON.stringify(message) === '{"type":"ping"}')).toHaveLength(5);
  expect(invalidated).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(mock.browser.scripting.executeScript).toHaveBeenCalledTimes(inspections);
  expect(vi.getTimerCount()).toBe(1); // One heartbeat, no pending request timers.
  const result = await controller.analyze({ hostname: 'example.com', policyText: 'Public policy.', evidence: prepared.evidence }, new AbortController().signal);
  expect(result).toEqual(analysis);
  controller.dispose?.();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops heartbeat on worker disconnect and starts exactly one for a new connection', async () => {
  vi.useFakeTimers();
  const controller = createRealController();
  await controller.prepare();
  expect(vi.getTimerCount()).toBe(1);
  mock.ports.at(-1)?.disconnect();
  expect(vi.getTimerCount()).toBe(0);
  await controller.prepare();
  await controller.readPolicyFromPage?.();
  expect(vi.getTimerCount()).toBe(1);
  controller.dispose?.();
  expect(vi.getTimerCount()).toBe(0);
});

it('discovers in the bound document and only POSTs after explicit analyze; source URLs stay local', async () => {
  const text = 'Our terms describe cookies, collection of personal data and retention periods. '.repeat(4);
  const previous = mock.browser.scripting.executeScript.getMockImplementation()!;
  mock.browser.scripting.executeScript.mockImplementation((options) => options.func.name === 'readPolicyLinks'
    ? Promise.resolve([{ documentId: doc, frameId: 0, result: { url: 'https://example.com/page?private=1',
      links: [{ href: '/terms?language=ru', label: 'Terms of service' }] } }])
    : previous(options));
  const fetcher = vi.fn().mockImplementation((url) => Promise.resolve(String(url).includes('/v1/analyze')
    ? Response.json(analysis)
    : new Response('<main>' + text + '</main>', { headers: { 'content-type': 'text/html' } })));
  vi.stubGlobal('fetch', fetcher);
  const controller = createRealController();
  const prepared = await controller.prepare();
  const found = await controller.discoverPolicy!(new AbortController().signal);
  expect(found.status).toBe('ready');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/terms?language=ru');
  const injection = mock.browser.scripting.executeScript.mock.calls.find(([options]) => options.func.name === 'readPolicyLinks');
  expect(injection?.[0].target).toEqual({ tabId: 7, documentIds: ['document-A'] });
  if (found.status !== 'ready') throw new Error('expected document');
  await controller.analyze({ hostname: 'example.com', policyText: found.document.text, evidence: prepared.evidence }, new AbortController().signal);
  const sent = JSON.stringify(fetcher.mock.calls[1]?.[1]);
  expect(sent).not.toMatch(/language=|private=|https:\/\/example/);
});

it('rejects a loaded document after navigation even if the old network request completes', async () => {
  const previous = mock.browser.scripting.executeScript.getMockImplementation()!;
  mock.browser.scripting.executeScript.mockImplementation((options) => options.func.name === 'readPolicyLinks'
    ? Promise.resolve([{ documentId: doc, frameId: 0, result: { url: 'https://example.com/', links: [{ href: '/terms', label: 'Terms' }] } }])
    : previous(options));
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
    doc = 'document-B';
    return Promise.resolve(new Response('Our policy covers data collection and cookies. '.repeat(5), { headers: { 'content-type': 'text/plain' } }));
  }));
  const controller = createRealController();
  await controller.prepare();
  await expect(controller.discoverPolicy!(new AbortController().signal)).rejects.toMatchObject({ failure: { kind: 'page_changed' } });
});

it('requests only the explicit document origin and preserves a permission denial without fetching', async () => {
  const controller = createRealController();
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  mock.browser.permissions.request.mockResolvedValue(false);
  const result = await controller.loadPolicy!('https://other.com/terms', new AbortController().signal, true);
  expect(result).toMatchObject({ status: 'missing', problem: 'denied', url: 'https://other.com/terms' });
  expect(mock.browser.permissions.request).toHaveBeenCalledWith({ origins: ['https://other.com/*'] });
  expect(fetcher).not.toHaveBeenCalled();
});
