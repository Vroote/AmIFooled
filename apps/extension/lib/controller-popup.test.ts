// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/popup/App';
import type { PopupController } from '../entrypoints/popup/controller';
import type { PolicyResult } from './policy-document';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const response = { hostname: 'example.com', status: 'ok' as const, mode: 'rules' as const, summary: 'Current result', findings: [], limitations: [] };
const ready = (text = 'Public policy.'): PolicyResult => ({
  status: 'ready', candidates: [],
  document: { text, url: 'https://example.com/terms', title: 'Public terms', kind: 'terms', redacted: false, truncated: false },
});
const missing: PolicyResult = { status: 'missing', problem: 'not_found', candidates: [] };
const controller = (): PopupController => ({
  demo: false,
  async prepare() { return { page: { status: 'ready', hostname: 'example.com' }, evidence: [] }; },
  async discoverPolicy() { return ready(); },
  async loadPolicy() { return ready(); },
  async analyze() { return response; },
  async checkBreaches() { throw new Error('unused'); },
});
const button = (text: string) => [...host.querySelectorAll('button')].find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === text)!;
async function typeUrl(text: string) {
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('discovers only on click, shows source and preview, never asks for pasted text or automatically analyzes', async () => {
  const adapter = controller(); adapter.analyze = vi.fn(adapter.analyze); adapter.discoverPolicy = vi.fn(adapter.discoverPolicy!); adapter.checkBreaches = vi.fn(adapter.checkBreaches);
  await act(async () => root.render(createElement(App, { controller: adapter })));
  expect(adapter.discoverPolicy).not.toHaveBeenCalled();
  expect(adapter.checkBreaches).toHaveBeenCalledOnce();
  expect(adapter.checkBreaches).toHaveBeenCalledWith('example.com', expect.any(AbortSignal));
  expect(host.querySelector('input')).toBeNull();
  await act(async () => button('Найти соглашение').click());
  expect(adapter.discoverPolicy).toHaveBeenCalledOnce();
  expect(adapter.analyze).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('a[href="https://example.com/terms"]')).not.toBeNull();
  expect(host.textContent).toContain('Public policy.');
  await act(async () => button('Проверить').click());
  expect(adapter.analyze).toHaveBeenCalledOnce();
});

it('requires re-confirmation if a controller returns text needing sanitization', async () => {
  const adapter = controller(); adapter.analyze = vi.fn(adapter.analyze);
  adapter.discoverPolicy = async () => ready('Contact user@example.com for details.');
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await act(async () => button('Проверить').click());
  expect(adapter.analyze).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Contact [email скрыт] for details.');
  expect(host.textContent).toContain('нажмите отправку ещё раз');
  await act(async () => button('Проверить').click());
  expect(adapter.analyze).toHaveBeenCalledOnce();
});

it('fallback takes only a URL; validation is inline and failures retain the URL for retry', async () => {
  const adapter = controller();
  adapter.discoverPolicy = async () => missing;
  adapter.loadPolicy = vi.fn().mockResolvedValue({ ...missing, problem: 'network' });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await typeUrl('http://127.0.0.1/secret');
  await act(async () => button('Загрузить по ссылке').click());
  expect(adapter.loadPolicy).not.toHaveBeenCalled();
  expect(host.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(host.querySelector('input'));
  await typeUrl('https://example.com/privacy');
  await act(async () => button('Загрузить по ссылке').click());
  expect(adapter.loadPolicy).toHaveBeenCalledOnce();
  expect(host.querySelector('input')?.value).toBe('https://example.com/privacy');
  expect(host.textContent).toContain('Не удалось загрузить документ');
});

it('permission is requested only from its explicit button, with a recoverable denial', async () => {
  const adapter = controller();
  adapter.discoverPolicy = async () => ({ ...missing, problem: 'permission', url: 'https://other.com/terms' });
  adapter.loadPolicy = vi.fn().mockResolvedValue({ ...missing, problem: 'denied', url: 'https://other.com/terms' });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  expect(adapter.loadPolicy).not.toHaveBeenCalled();
  await act(async () => button('Разрешить доступ и загрузить').click());
  expect(adapter.loadPolicy).toHaveBeenCalledWith('https://other.com/terms', expect.any(AbortSignal), true);
  expect(host.textContent).toContain('Доступ не предоставлен');
  expect(button('Разрешить доступ и загрузить')).toBeDefined();
});

it('changing the document clears old analysis while retaining the independent breaches result', async () => {
  const adapter = controller();
  adapter.checkBreaches = async () => ({
    hostname: 'example.com', matched_domain: 'example.com', status: 'not_found', count: 0, breaches: [],
    source: 'fixture', stale: false, checked_at: '2026-10-25T10:00:00Z', attribution_url: 'https://haveibeenpwned.com/',
  });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await act(async () => button('Проверить').click());
  await act(async () => button('Проверить утечки сайта').click());
  expect(host.textContent).toContain('Current result');
  expect(button('Вставить свою ссылку').closest('details')).toBeNull();
  await act(async () => button('Вставить свою ссылку').click());
  await typeUrl('https://example.com/cookies');
  await act(async () => button('Загрузить по ссылке').click());
  expect(host.textContent).not.toContain('Current result');
  expect(host.textContent).toContain('В каталоге HIBP записей по этому домену нет');
});

it('ends loading on timeout even when an analysis adapter ignores AbortSignal', async () => {
  vi.useFakeTimers();
  const adapter = controller(); adapter.analyze = () => new Promise(() => {});
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await act(async () => button('Проверить').click());
  expect(host.textContent).toContain('Сверяю…');
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(host.textContent).toContain('Проверка не успела завершиться');
  expect(host.textContent).not.toContain('Сверяю…');
});

it('times out discovery and ignores its late answer after a successful manual retry', async () => {
  vi.useFakeTimers();
  const adapter = controller();
  let finish!: (value: PolicyResult) => void;
  adapter.discoverPolicy = () => new Promise((resolve) => { finish = resolve; });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  expect(host.textContent).toContain('Ищу и загружаю');
  await act(async () => vi.advanceTimersByTimeAsync(18_000));
  expect(host.textContent).toContain('Загрузка заняла слишком много времени');
  await typeUrl('https://example.com/terms');
  await act(async () => button('Загрузить по ссылке').click());
  await act(async () => finish(ready('STALE POLICY')));
  expect(host.textContent).toContain('Public policy.');
  expect(host.textContent).not.toContain('STALE POLICY');
});

it('invalidates and drops late analysis even when the new document has the same hostname', async () => {
  const adapter = controller();
  let invalidate = () => {};
  adapter.subscribeInvalidation = (listener) => { invalidate = listener; return () => {}; };
  let finish!: (value: typeof response) => void;
  adapter.analyze = () => new Promise((resolve) => { finish = resolve; });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await act(async () => button('Проверить').click());
  await act(async () => invalidate());
  expect(host.textContent).toContain('Обновить контекст проверки');
  await act(async () => button('Обновить контекст проверки').click());
  await act(async () => finish(response));
  expect(host.textContent).not.toContain('Current result');
});

it('cancels document loading on navigation and never displays the old document', async () => {
  const adapter = controller();
  let invalidate = () => {};
  let finish!: (value: PolicyResult) => void;
  let signal!: AbortSignal;
  adapter.subscribeInvalidation = (listener) => { invalidate = listener; return () => {}; };
  adapter.discoverPolicy = (s) => { signal = s; return new Promise((resolve) => { finish = resolve; }); };
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await act(async () => button('Найти соглашение').click());
  await act(async () => invalidate());
  expect(signal.aborted).toBe(true);
  await act(async () => finish(ready('STALE POLICY')));
  expect(host.textContent).not.toContain('STALE POLICY');
});


it('keeps collector limitations collapsed but sanitization confirmation visible', async () => {
  const adapter = controller();
  adapter.prepare = async () => ({page: {status: 'ready', hostname: 'example.com'}, evidence: [], notices: ['Collector limits']});
  await act(async () => root.render(createElement(App, {controller: adapter})));
  const details = [...host.querySelectorAll('details')].find((item) => item.textContent?.includes('Collector limits'));
  expect(details).toBeDefined();
  expect(details?.open).toBe(false);
});


it('accepts a custom policy URL immediately without discovery or automatic analysis', async () => {
  const adapter = controller();
  adapter.discoverPolicy = vi.fn(adapter.discoverPolicy!);
  adapter.loadPolicy = vi.fn(adapter.loadPolicy!);
  adapter.analyze = vi.fn(adapter.analyze);
  await act(async () => root.render(createElement(App, {controller: adapter})));
  await act(async () => button('Вставить свою ссылку').click());
  expect(document.activeElement).toBe(host.querySelector('input'));
  await typeUrl('https://example.com/custom-terms');
  await act(async () => button('Загрузить по ссылке').click());
  expect(adapter.discoverPolicy).not.toHaveBeenCalled();
  expect(adapter.loadPolicy).toHaveBeenCalledWith('https://example.com/custom-terms', expect.any(AbortSignal), false);
  expect(adapter.analyze).not.toHaveBeenCalled();
  expect(button('Проверить')).toBeDefined();
  expect(host.querySelector('textarea')).toBeNull();
});


it('auto-checks breaches once in StrictMode and keeps the manual retry without auto-retry loops', async () => {
  const adapter = controller();
  adapter.checkBreaches = vi.fn(adapter.checkBreaches);
  await act(async () => root.render(createElement(StrictMode, null, createElement(App, {controller: adapter}))));
  expect(adapter.checkBreaches).toHaveBeenCalledOnce();
  await act(async () => button('Найти соглашение').click());
  expect(adapter.checkBreaches).toHaveBeenCalledOnce();
  await act(async () => button('Проверить утечки сайта').click());
  expect(adapter.checkBreaches).toHaveBeenCalledTimes(2);
});

it('does not auto-check breaches on unsupported pages', async () => {
  const adapter = controller();
  adapter.prepare = async () => ({page: {status: 'unsupported', reason: 'restricted'}, evidence: []});
  adapter.checkBreaches = vi.fn(adapter.checkBreaches);
  await act(async () => root.render(createElement(App, {controller: adapter})));
  expect(adapter.checkBreaches).not.toHaveBeenCalled();
});

it('aborts the automatic breach check and discards a late answer after navigation', async () => {
  const adapter = controller();
  let invalidate = () => {};
  let finish!: (value: Awaited<ReturnType<PopupController['checkBreaches']>>) => void;
  let signal!: AbortSignal;
  adapter.subscribeInvalidation = (listener) => {invalidate = listener; return () => {};};
  adapter.checkBreaches = (_hostname, s) => {signal = s; return new Promise((resolve) => {finish = resolve;});};
  await act(async () => root.render(createElement(App, {controller: adapter})));
  await act(async () => invalidate());
  expect(signal.aborted).toBe(true);
  await act(async () => finish({hostname: 'example.com', matched_domain: 'example.com', status: 'not_found', count: 0, breaches: [], source: 'fixture', stale: false, checked_at: '2026-10-25T10:00:00Z', attribution_url: 'https://haveibeenpwned.com/'}));
  expect(host.textContent).not.toContain('Совпадений в HIBP нет');
  expect(host.textContent).toContain('Обновить контекст проверки');
});
