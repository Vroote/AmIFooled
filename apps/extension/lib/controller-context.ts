import { browser } from 'wxt/browser';
import { normalizeHostname } from './collector';
import { RequestError } from '../entrypoints/popup/controller';

export interface DocumentContext { tabId: number; documentId: string; hostname: string }

/** Only local browser context: no path/query, and never sent to the backend. */
export async function activeDocument(): Promise<DocumentContext> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || tab.incognito || tab.pendingUrl) throw new RequestError({ kind: 'page_changed' });
  const url = new URL(tab.url ?? 'about:blank');
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === 'chromewebstore.google.com' ||
      url.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/i.test(url.pathname)) {
    throw new RequestError({ kind: 'unsupported_page' });
  }
  const [result] = await browser.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED',
    func: () => location.hostname,
  });
  const hostname = normalizeHostname(String(result?.result ?? ''));
  if (!result?.documentId || !hostname || hostname !== normalizeHostname(url.hostname)) {
    throw new RequestError({ kind: 'page_changed' });
  }
  return { tabId: tab.id, documentId: result.documentId, hostname };
}

export function sameDocument(a: DocumentContext, b: DocumentContext): boolean {
  return a.tabId === b.tabId && a.documentId === b.documentId && a.hostname === b.hostname;
}
