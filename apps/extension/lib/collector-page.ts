export interface PageSnapshot {
  hostname: string;
  resourceHosts: string[];
  resourceScanLimited: boolean;
  resourcesAvailable: boolean;
  visibleCookieCount: number | null;
  selectedText: string;
  selectionState: 'ok' | 'empty' | 'blocked' | 'skipped';
  selectionTruncated: boolean;
}

/** Serialized by Chrome: keep every runtime dependency inside this function. */
export function readPageSnapshot(readSelection: boolean): PageSnapshot {
  const snapshot: PageSnapshot = {
    hostname: location.hostname.toLowerCase().replace(/\.$/, ''),
    resourceHosts: [],
    resourceScanLimited: false,
    resourcesAvailable: true,
    visibleCookieCount: null,
    selectedText: '',
    selectionState: readSelection ? 'empty' : 'skipped',
    selectionTruncated: false,
  };

  // Raw resource URLs and cookies never leave the page's isolated world.
  try {
    const entries = performance.getEntriesByType('resource');
    const hosts = new Set<string>();
    snapshot.resourceScanLimited = entries.length > 1_000;
    for (const entry of entries.slice(0, 1_000)) {
      try {
        const url = new URL(entry.name);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
        if (hostname !== snapshot.hostname) hosts.add(hostname);
        if (hosts.size >= 200) {
          snapshot.resourceScanLimited = true;
          break;
        }
      } catch { /* Invalid timing entry: no evidence. */ }
    }
    snapshot.resourceHosts = [...hosts];
  } catch {
    snapshot.resourcesAvailable = false;
  }

  try {
    snapshot.visibleCookieCount = document.cookie.split(';').filter((part) => part.trim()).length;
  } catch { /* Denied cookie access is unknown, not zero. */ }

  if (!readSelection) return snapshot;
  try {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return snapshot;
    const sensitive = 'form,input,textarea,select,[contenteditable]:not([contenteditable="false"])';
    const elementFor = (node: Node | null): Element | null =>
      node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
    if (document.activeElement?.closest(sensitive) ||
        elementFor(selection.anchorNode)?.closest(sensitive) ||
        elementFor(selection.focusNode)?.closest(sensitive)) {
      snapshot.selectionState = 'blocked';
      return snapshot;
    }
    // Reject selections spanning forms/editors as well as selections inside them.
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      const root = elementFor(range.commonAncestorContainer);
      if (root && [...root.querySelectorAll(sensitive)].some((node) => range.intersectsNode(node))) {
        snapshot.selectionState = 'blocked';
        return snapshot;
      }
    }
    let text = selection.toString();
    if (text.length > 20_000) {
      snapshot.selectionTruncated = true;
      // Do not cut an email/URL token before the caller can redact it.
      text = text.slice(0, 20_001).replace(/\S+$/, '').slice(0, 20_000);
    }
    snapshot.selectedText = text;
    snapshot.selectionState = text.trim() ? 'ok' : 'empty';
  } catch {
    snapshot.selectionState = 'blocked';
  }
  return snapshot;
}
