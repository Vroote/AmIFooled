/**
 * Opt-in badge for sites the user chose to check on open.
 *
 * Only the hostname of an opted-in site is ever sent, and only after Chrome granted the
 * host permission for that origin. Without that permission Chrome does not even give us
 * `tab.url`, so sites the user did not opt into stay invisible to this module: there is
 * no browsing history to leak here.
 *
 * Every answer is tied to the navigation that asked for it. A late reply whose tab has
 * moved on is dropped instead of being shown for the wrong site.
 */

import { browser } from 'wxt/browser';
import type { components } from './api.generated';
import {
  BADGE_CLEARED,
  BADGE_COLOR,
  BADGE_UNKNOWN,
  badgeFor,
  isCountedBadge,
  type BadgeView,
} from './badge';
import { normalizeHostname } from './hostname';
import { hasSitePermission, isEnabled } from './navigation-optin';

type BreachesResponse = components['schemas']['BreachesResponse'];

export interface NavigationDeps {
  /** Same shape as PopupController.checkBreaches: issue #6 supplies the real client. */
  checkBreaches(hostname: string, signal: AbortSignal): Promise<BreachesResponse>;
  now?: () => number;
}

export const CACHE_TTL_MS = 10 * 60_000;
/** Deliberately smaller than MAX_ENABLED_SITES, so the bound is reachable and tested. */
export const CACHE_LIMIT = 32;
export const REQUEST_TIMEOUT_MS = 8_000;

/** http(s) only, parsed by the URL parser so IDNA and case are normalized like the API. */
export function navigableHostname(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return normalizeHostname(url.hostname);
  } catch {
    return null;
  }
}

interface CacheEntry {
  view: BadgeView;
  expires: number;
}

/** One navigation per tab: the token it was given, and whether it finished. */
interface NavigationState {
  token: number;
  hostname: string | null;
  settled: boolean;
}

export interface NavigationChecks {
  /** Called for a finished top-level navigation in one tab. */
  onNavigated(tabId: number, url: string | undefined, incognito?: boolean): Promise<void>;
  onTabClosed(tabId: number): void;
  /** Drops cached counts so a re-enabled site is asked about again. */
  clearCache(): void;
}

export function createNavigationChecks(deps: NavigationDeps): NavigationChecks {
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();
  const latest = new Map<number, NavigationState>();
  let tokens = 0;

  function readCache(hostname: string): BadgeView | null {
    const entry = cache.get(hostname);
    if (!entry) {
      return null;
    }
    if (entry.expires <= now()) {
      cache.delete(hostname);
      return null;
    }
    return entry.view;
  }

  function writeCache(hostname: string, view: BadgeView): void {
    // Oldest key first: a bounded map, never a growing record of visited sites.
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }
    cache.set(hostname, { view, expires: now() + CACHE_TTL_MS });
  }

  /**
   * Writes one badge, re-checking the navigation before every browser call.
   *
   * Each call is a separate await, so without the checks a newer navigation could land
   * between them and leave one site's number next to another site's tooltip.
   */
  async function applyBadge(tabId: number, view: BadgeView, token: number): Promise<void> {
    try {
      if (!isCurrent(tabId, token)) {
        return;
      }
      await browser.action.setBadgeText({ tabId, text: view.text });
      if (!isCurrent(tabId, token)) {
        return;
      }
      await browser.action.setTitle({ tabId, title: view.title });
      if (view.text && isCurrent(tabId, token)) {
        await browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
      }
    } catch {
      // The tab closed or navigated away; there is nothing to show and nothing to fix.
    }
  }

  async function stillOnSite(tabId: number, hostname: string): Promise<boolean> {
    try {
      const tab = await browser.tabs.get(tabId);
      return navigableHostname(tab.url) === hostname;
    } catch {
      return false;
    }
  }

  /**
   * Claims this tab for one navigation, synchronously, before anything is awaited.
   *
   * The token is what every later branch checks, so a handler whose storage or
   * permission lookup resolved late cannot write a badge over a newer navigation —
   * including from the cached and the cleared branches, which perform no request.
   */
  function beginNavigation(tabId: number, hostname: string | null): number | null {
    const previous = latest.get(tabId);
    if (previous && !previous.settled && hostname !== null && previous.hostname === hostname) {
      // A repeated event for the navigation already being handled: one request is enough.
      return null;
    }
    const token = ++tokens;
    latest.set(tabId, { token, hostname, settled: false });
    return token;
  }

  function isCurrent(tabId: number, token: number): boolean {
    return latest.get(tabId)?.token === token;
  }

  function settle(tabId: number, token: number): void {
    const state = latest.get(tabId);
    if (state?.token === token) {
      state.settled = true;
    }
  }

  async function onNavigated(
    tabId: number,
    url: string | undefined,
    incognito = false,
  ): Promise<void> {
    const hostname = incognito ? null : navigableHostname(url);
    const token = beginNavigation(tabId, hostname);
    if (token === null) {
      return;
    }
    try {
      // Any navigation we must not or cannot check clears a previous site's number.
      if (!hostname) {
        if (isCurrent(tabId, token)) {
          await applyBadge(tabId, BADGE_CLEARED, token);
        }
        return;
      }
      if (!(await isEnabled(hostname)) || !(await hasSitePermission(hostname))) {
        if (isCurrent(tabId, token)) {
          await applyBadge(tabId, BADGE_CLEARED, token);
        }
        return;
      }

      const cached = readCache(hostname);
      if (cached) {
        if (isCurrent(tabId, token)) {
          await applyBadge(tabId, cached, token);
        }
        return;
      }

      const aborter = new AbortController();
      const timer = setTimeout(() => aborter.abort(), REQUEST_TIMEOUT_MS);
      let view = BADGE_UNKNOWN;
      try {
        const data = await deps.checkBreaches(hostname, aborter.signal);
        if (normalizeHostname(data.hostname) !== hostname) {
          // An answer about another site is not an answer about this one.
          view = BADGE_UNKNOWN;
        } else {
          view = badgeFor(hostname, data);
          // Only a real count is remembered. Caching "?" would keep showing it after
          // the source recovered, which the next-visit retry is supposed to prevent.
          if (isCountedBadge(view)) {
            writeCache(hostname, view);
          }
        }
      } catch {
        // Failures are not cached either, so the next visit asks again.
        view = BADGE_UNKNOWN;
      } finally {
        clearTimeout(timer);
      }

      if (!isCurrent(tabId, token)) {
        return;
      }
      const onSite = await stillOnSite(tabId, hostname);
      // tabs.get is another await: a newer navigation may have landed and painted while
      // this lookup was in flight, and a late lookup may even answer with the old
      // snapshot. The navigation is therefore re-checked after it, not only before.
      if (!onSite || !isCurrent(tabId, token)) {
        return;
      }
      await applyBadge(tabId, view, token);
    } finally {
      settle(tabId, token);
    }
  }

  return {
    onNavigated,
    onTabClosed(tabId: number): void {
      latest.delete(tabId);
    },
    clearCache(): void {
      cache.clear();
    },
  };
}

/**
 * Registered once from the background entrypoint. Listeners are attached synchronously
 * so an MV3 worker restart re-attaches them, and the opt-in itself lives in
 * chrome.storage.local rather than in memory.
 */
export function registerNavigationChecks(deps: NavigationDeps): NavigationChecks {
  const checks = createNavigationChecks(deps);
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
      return;
    }
    void checks.onNavigated(tabId, tab.url, tab.incognito);
  });
  browser.tabs.onRemoved.addListener((tabId) => checks.onTabClosed(tabId));
  return checks;
}
