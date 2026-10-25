/**
 * Per-site opt-in for the automatic check.
 *
 * Nothing here is on by default. A site is checked on navigation only after the user
 * asked for it from an explicit click and Chrome granted the host permission for that
 * one origin. Turning it off removes both the setting and the permission, so the next
 * navigation sends nothing at all.
 *
 * The stored list and the granted permissions can drift apart — the user can revoke a
 * permission in chrome://extensions without telling us — so the list is a request, and
 * `hasSitePermission` is the authority before anything leaves the browser.
 */

import { browser } from 'wxt/browser';
import { normalizeHostname } from './hostname';

export const STORAGE_KEY = 'navigation.enabled-hosts';
/** A bounded list: the opt-in is for a few sites the user cares about, not a crawler. */
export const MAX_ENABLED_SITES = 50;

export type EnableOutcome = 'enabled' | 'denied' | 'invalid' | 'limit' | 'unavailable';

export function originPatternFor(hostname: string): string | null {
  const value = normalizeHostname(hostname);
  return value ? `*://${value}/*` : null;
}

/** Storage is ours, but it is still parsed as unknown data rather than trusted. */
export async function readEnabledHosts(): Promise<string[]> {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEY);
    const raw: unknown = stored[STORAGE_KEY];
    if (!Array.isArray(raw)) {
      return [];
    }
    const hosts = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeHostname(item))
      .filter((item): item is string => item !== null);
    return [...new Set(hosts)].slice(0, MAX_ENABLED_SITES);
  } catch {
    return [];
  }
}

async function writeEnabledHosts(hosts: string[]): Promise<boolean> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: hosts });
    return true;
  } catch {
    return false;
  }
}

export async function isEnabled(hostname: string): Promise<boolean> {
  const value = normalizeHostname(hostname);
  if (!value) {
    return false;
  }
  return (await readEnabledHosts()).includes(value);
}

export async function hasSitePermission(hostname: string): Promise<boolean> {
  const origin = originPatternFor(hostname);
  if (!origin) {
    return false;
  }
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

/** Call from a user gesture: Chrome rejects permission requests made without one. */
export async function enableSite(hostname: string): Promise<EnableOutcome> {
  const value = normalizeHostname(hostname);
  const origin = value ? originPatternFor(value) : null;
  if (!value || !origin) {
    return 'invalid';
  }
  const hosts = await readEnabledHosts();
  if (!hosts.includes(value) && hosts.length >= MAX_ENABLED_SITES) {
    return 'limit';
  }
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [origin] });
  } catch {
    return 'unavailable';
  }
  if (!granted) {
    // A refusal is a valid answer: the manual check in the popup keeps working.
    return 'denied';
  }
  if (hosts.includes(value)) {
    return 'enabled';
  }
  return (await writeEnabledHosts([...hosts, value])) ? 'enabled' : 'unavailable';
}

/**
 * The setting is dropped before the permission: if the second step fails, the site is
 * already excluded from navigation checks instead of staying silently enabled.
 */
export async function disableSite(hostname: string): Promise<'disabled' | 'unavailable'> {
  const value = normalizeHostname(hostname);
  const origin = value ? originPatternFor(value) : null;
  if (!value || !origin) {
    return 'unavailable';
  }
  const hosts = await readEnabledHosts();
  if (!(await writeEnabledHosts(hosts.filter((item) => item !== value)))) {
    return 'unavailable';
  }
  try {
    await browser.permissions.remove({ origins: [origin] });
  } catch {
    // The site no longer gets checked; a stale grant is the user's to revoke in Chrome.
    return 'disabled';
  }
  return 'disabled';
}
