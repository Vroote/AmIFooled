import { expect, it } from 'vitest';
import { BADGE_UNKNOWN, badgeFor, isRenderableBadgeText } from './badge';
import type { components } from './api.generated';

type BreachesResponse = components['schemas']['BreachesResponse'];

const base: BreachesResponse = {
  hostname: 'example.com',
  matched_domain: 'example.com',
  status: 'ok',
  count: 3,
  breaches: [],
  checked_at: '2026-10-25T10:00:00Z',
  source: 'hibp',
  stale: false,
  attribution_url: 'https://haveibeenpwned.com/',
};

it('shows the number of known incidents and says whose records they are', () => {
  const view = badgeFor('example.com', base);
  expect(view.text).toBe('3');
  expect(view.title).toContain('известных утечек в каталоге HIBP — 3');
  expect(view.title).toContain('не проверка ваших данных');
  expect(isRenderableBadgeText(view.text)).toBe(true);
});

it('shows zero as zero and never as a safe site', () => {
  const view = badgeFor('example.com', { ...base, status: 'not_found', count: 0 });
  expect(view.text).toBe('0');
  expect(view.title).toContain('только отсутствие записи');
  // The word "безопасность" may appear only inside the denial, never as a claim.
  expect(view.title).toContain('а не безопасность сайта');
  expect(view.title).not.toMatch(/сайт безопасен|утечек не было|всё чисто/i);
});

it('treats HTTP 200 with unavailable status as unknown, not as zero', () => {
  const view = badgeFor('example.com', { ...base, status: 'unavailable', count: null });
  expect(view).toEqual(BADGE_UNKNOWN);
  expect(view.text).toBe('?');
  expect(view.title).toContain('это не «утечек не было»');
});

it.each([null, undefined, -1, 1.5, Number.NaN])('rejects an unusable count %p', (count) => {
  expect(badgeFor('example.com', { ...base, count: count as number })).toEqual(BADGE_UNKNOWN);
});

it('keeps the badge short for large counts and still fits Chrome', () => {
  const view = badgeFor('example.com', { ...base, count: 1234 });
  expect(view.text).toBe('99+');
  expect(isRenderableBadgeText(view.text)).toBe(true);
  expect(view.title).toContain('1234');
});

it('marks a cached answer as not a fresh check', () => {
  expect(badgeFor('example.com', { ...base, stale: true }).title).toContain('Ответ из кэша');
  expect(badgeFor('example.com', { ...base, status: 'not_found', count: 0, stale: true }).title)
    .toContain('Ответ из кэша');
});
