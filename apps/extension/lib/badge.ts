/**
 * Badge text for the known-breaches count.
 *
 * The badge has room for a few characters, so it can only ever be a pointer into the
 * popup. Zero is shown as zero and never as a clean result; unknown is shown as "?" and
 * never as zero. One neutral colour is used for every state, so colour is not carrying
 * meaning on its own.
 */

import type { components } from './api.generated';

type BreachesResponse = components['schemas']['BreachesResponse'];

export const BADGE_COLOR = '#315c96';
export const BADGE_TEXT_LIMIT = 4;

export interface BadgeView {
  text: string;
  title: string;
}

const UNKNOWN_TITLE =
  'Число известных утечек неизвестно. Неизвестно — это не «утечек не было». Подробности в окне AmIFooled.';

export const BADGE_UNKNOWN: BadgeView = { text: '?', title: UNKNOWN_TITLE };

export const BADGE_CLEARED: BadgeView = { text: '', title: 'AmIFooled — проверка сайта' };

function formatCount(count: number): string {
  if (count > 99) {
    return '99+';
  }
  return String(count);
}

/** A response is only as good as its status: 200 with "unavailable" is still unknown. */
export function badgeFor(hostname: string, data: BreachesResponse): BadgeView {
  if (data.status === 'unavailable' || data.count === null || data.count === undefined) {
    return BADGE_UNKNOWN;
  }
  if (!Number.isSafeInteger(data.count) || data.count < 0) {
    return BADGE_UNKNOWN;
  }
  const stale = data.stale ? ' Ответ из кэша, не свежая проверка.' : '';
  if (data.count === 0) {
    return {
      text: '0',
      title:
        `${hostname}: совпадений в каталоге HIBP нет. Это только отсутствие записи, ` +
        `а не безопасность сайта.${stale}`,
    };
  }
  return {
    text: formatCount(data.count),
    title:
      `${hostname}: известных утечек в каталоге HIBP — ${data.count}. ` +
      `Это записи об инцидентах сайта, а не проверка ваших данных.${stale}`,
  };
}

/** Badge text must stay short enough for Chrome to render it at all. */
export function isRenderableBadgeText(text: string): boolean {
  return text.length <= BADGE_TEXT_LIMIT;
}
