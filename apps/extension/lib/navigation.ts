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
import { BADGE_CLEARED, BADGE_COLOR, BADGE_UNKNOWN, badgeFor, type BadgeView } from './badge';
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

interface Pending {
  hostname: string;
  token: number;
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
  const pending = new Map<number, Pending>();
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

  async function applyBadge(tabId: number, view: BadgeView): Promise<void> {
    try {
      await browser.action.setBadgeText({ tabId, text: view.text });
      await browser.action.setTitle({ tabId, title: view.title });
      if (view.text) {
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

  async function onNavigated(
    tabId: number,
    url: string | undefined,
    incognito = false,
  ): Promise<void> {
    const hostname = navigableHostname(url);
    // Any navigation we must not or cannot check clears a previous site's number.
    if (!hostname || incognito) {
      pending.delete(tabId);
      await applyBadge(tabId, BADGE_CLEARED);
      return;
    }
    if (!(await isEnabled(hostname)) || !(await hasSitePermission(hostname))) {
      pending.delete(tabId);
      await applyBadge(tabId, BADGE_CLEARED);
      return;
    }

    const current = pending.get(tabId);
    if (current?.hostname === hostname) {
      // Repeated events for the same navigation: one request is already in flight.
      return;
    }

    const cached = readCache(hostname);
    if (cached) {
      pending.delete(tabId);
      await applyBadge(tabId, cached);
      return;
    }

    const token = ++tokens;
    pending.set(tabId, { hostname, token });
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
        writeCache(hostname, view);
      }
    } catch {
      // Failures are not cached, so the next visit asks again instead of showing "?".
      view = BADGE_UNKNOWN;
    } finally {
      clearTimeout(timer);
    }

    if (pending.get(tabId)?.token !== token) {
      return;
    }
    pending.delete(tabId);
    if (!(await stillOnSite(tabId, hostname))) {
      return;
    }
    await applyBadge(tabId, view);
  }

  return {
    onNavigated,
    onTabClosed(tabId: number): void {
      pending.delete(tabId);
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
