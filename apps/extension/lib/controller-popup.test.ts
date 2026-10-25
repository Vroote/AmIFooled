// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import App from '../entrypoints/popup/App';
import type { PopupController } from '../entrypoints/popup/controller';

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
const controller = (): PopupController => ({
  demo: false,
  async prepare() { return { page: { status: 'ready', hostname: 'example.com' }, evidence: [] }; },
  async analyze() { return response; },
  async checkBreaches() { throw new Error('unused'); },
});
const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
async function typePolicy(text: string) {
  await act(async () => {
    const input = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('shows sanitized manual text for confirmation before sending anything', async () => {
  const adapter = controller(); adapter.analyze = vi.fn(adapter.analyze);
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await typePolicy('Contact user@example.com for details.');
  await act(async () => button('Отправить и сверить').click());
  expect(adapter.analyze).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')!.value).toBe('Contact [email скрыт] for details.');
  expect(host.textContent).toContain('нажмите отправку ещё раз');
  await act(async () => button('Отправить и сверить').click());
  expect(adapter.analyze).toHaveBeenCalledOnce();
});

it('ends loading on timeout even when an adapter ignores AbortSignal', async () => {
  vi.useFakeTimers();
  const adapter = controller(); adapter.analyze = () => new Promise(() => {});
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await typePolicy('Public policy.');
  await act(async () => button('Отправить и сверить').click());
  expect(host.textContent).toContain('Сверяю…');
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(host.textContent).toContain('Проверка не успела завершиться');
  expect(host.textContent).not.toContain('Сверяю…');
});

it('invalidates and drops late answers even when a new document has the same hostname', async () => {
  const adapter = controller();
  let invalidate = () => {};
  adapter.subscribeInvalidation = (listener) => { invalidate = listener; return () => {}; };
  let finish!: (value: typeof response) => void;
  adapter.analyze = () => new Promise((resolve) => { finish = resolve; });
  await act(async () => root.render(createElement(App, { controller: adapter })));
  await typePolicy('Public policy.');
  await act(async () => button('Отправить и сверить').click());
  await act(async () => invalidate());
  expect(host.textContent).toContain('Обновить контекст проверки');
  await act(async () => button('Обновить контекст проверки').click());
  await act(async () => finish(response));
  expect(host.textContent).not.toContain('Current result');
  expect(host.querySelector('textarea')!.value).toBe('');
});
