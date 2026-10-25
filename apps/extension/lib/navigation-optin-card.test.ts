// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import NavigationOptIn, { type OptInAdapter } from '../components/NavigationOptIn';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: vi.fn(), set: vi.fn() } },
    permissions: { request: vi.fn(), remove: vi.fn(), contains: vi.fn() },
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function adapterWith(overrides: Partial<OptInAdapter> = {}): OptInAdapter {
  return {
    isEnabled: vi.fn().mockResolvedValue(false),
    hasSitePermission: vi.fn().mockResolvedValue(false),
    enableSite: vi.fn().mockResolvedValue('enabled'),
    disableSite: vi.fn().mockResolvedValue('disabled'),
    ...overrides,
  };
}

async function show(hostname: string | null, adapter: OptInAdapter) {
  await act(async () => {
    root.render(createElement(NavigationOptIn, { hostname, adapter }));
  });
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(label),
  );
  if (!button) {
    throw new Error(`Кнопка «${label}» не найдена: ${container.textContent}`);
  }
  await act(async () => {
    button.click();
  });
  return button;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('is off by default and says what would be sent before anything is enabled', async () => {
  const adapter = adapterWith();
  await show('example.com', adapter);

  expect(container.textContent).toContain('Выключено');
  expect(container.textContent).toContain('уйдёт только его имя: example.com');
  expect(container.textContent).toContain('не отправляются');
  expect(adapter.enableSite).not.toHaveBeenCalled();
});

it('states that zero and "?" on the badge are not safety', async () => {
  await show('example.com', adapterWith());
  expect(container.textContent).toContain('не означают, что сайт безопасен');
});

it('keeps the manual check working when Chrome refuses the permission', async () => {
  const adapter = adapterWith({ enableSite: vi.fn().mockResolvedValue('denied') });
  await show('example.com', adapter);
  await click('Включить для этого сайта');

  expect(adapter.enableSite).toHaveBeenCalledWith('example.com');
  expect(container.textContent).toContain('Chrome не дал разрешение');
  expect(container.textContent).toContain('Ручная проверка выше продолжает работать');
  expect(container.textContent).toContain('Выключено');
});

it('shows the site as enabled only after the permission is actually granted', async () => {
  const adapter = adapterWith({
    isEnabled: vi.fn().mockResolvedValue(false),
    hasSitePermission: vi.fn().mockResolvedValue(false),
  });
  await show('example.com', adapter);

  vi.mocked(adapter.isEnabled).mockResolvedValue(true);
  vi.mocked(adapter.hasSitePermission).mockResolvedValue(true);
  await click('Включить для этого сайта');

  expect(container.textContent).toContain('Включено для этого сайта');
  expect(container.textContent).toContain('Отключить и убрать разрешение');
});

it('reports a permission revoked outside the popup instead of claiming it works', async () => {
  const adapter = adapterWith({
    isEnabled: vi.fn().mockResolvedValue(true),
    hasSitePermission: vi.fn().mockResolvedValue(false),
  });
  await show('example.com', adapter);

  expect(container.textContent).toContain('Разрешение отозвано в настройках Chrome');
  expect(container.textContent).toContain('Запросить разрешение снова');
});

it('turns the site off and returns to the off state', async () => {
  const adapter = adapterWith({
    isEnabled: vi.fn().mockResolvedValue(true),
    hasSitePermission: vi.fn().mockResolvedValue(true),
  });
  await show('example.com', adapter);
  expect(container.textContent).toContain('Включено для этого сайта');

  vi.mocked(adapter.isEnabled).mockResolvedValue(false);
  vi.mocked(adapter.hasSitePermission).mockResolvedValue(false);
  await click('Отключить и убрать разрешение');

  expect(adapter.disableSite).toHaveBeenCalledWith('example.com');
  expect(container.textContent).toContain('Выключено');
  expect(container.textContent).toContain('Включить для этого сайта');
});

it('explains a partial disable rather than showing it as done', async () => {
  const adapter = adapterWith({
    isEnabled: vi.fn().mockResolvedValue(true),
    hasSitePermission: vi.fn().mockResolvedValue(true),
    disableSite: vi.fn().mockResolvedValue('unavailable'),
  });
  await show('example.com', adapter);
  await click('Отключить и убрать разрешение');

  expect(container.textContent).toContain('chrome://extensions');
});

it('offers nothing to enable on a page without a usable hostname', async () => {
  const adapter = adapterWith();
  await show(null, adapter);

  const button = [...container.querySelectorAll('button')].at(0);
  expect(button?.disabled).toBe(true);
  expect(container.textContent).toContain('Откройте обычную http(s)-страницу');
  expect(adapter.isEnabled).not.toHaveBeenCalled();
});
