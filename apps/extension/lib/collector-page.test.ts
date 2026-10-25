// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.example.com/policy?secret=1"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readPageSnapshot } from './collector-page';

function select(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = '<p id="policy">Public policy</p><p>Unselected private data</p>';
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
  vi.spyOn(document, 'cookie', 'get').mockReturnValue('session=PRIVATE; account=user@example.com');
});
afterEach(() => vi.restoreAllMocks());

it('returns only resource hostnames and cookie count from the isolated page', () => {
  vi.mocked(performance.getEntriesByType).mockReturnValue([
    { name: 'https://stats.example.net/track?email=private@example.org#SECRET' },
    { name: 'https://stats.example.net/other' }, { name: 'https://www.example.com/first' },
    { name: 'data:text/plain,PRIVATE' }, { name: 'invalid url' },
  ] as PerformanceEntry[]);
  const result = readPageSnapshot(false);
  expect(result.resourceHosts).toEqual(['stats.example.net']);
  expect(result.visibleCookieCount).toBe(2);
  expect(result.selectedText).toBe('');
  for (const secret of ['PRIVATE', 'session', 'account', 'private@example.org', 'secret=1', '/track']) {
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});

it('reads only explicitly selected text, never the full DOM', () => {
  select(document.querySelector('#policy')!);
  expect(readPageSnapshot(true).selectedText).toBe('Public policy');
  window.getSelection()?.removeAllRanges();
  expect(readPageSnapshot(true)).toMatchObject({ selectionState: 'empty', selectedText: '' });
});

it('can be serialized without module closures, as required by executeScript', () => {
  select(document.querySelector('#policy')!);
  // Test-only VM. Production extension never evaluates source strings.
  const result = runInNewContext(`(${readPageSnapshot.toString()})(true)`, {
    location, performance, document, window, URL,
  });
  expect(result).toMatchObject({ selectedText: 'Public policy', visibleCookieCount: 2 });
});

it.each(['<form><p>Private form text</p></form>', '<div contenteditable="true">Private editor</div>',
  '<textarea>Private value</textarea>'])('rejects selected form/editor content %s', (markup) => {
  document.body.innerHTML = markup;
  select(document.body.firstChild!);
  expect(readPageSnapshot(true)).toMatchObject({ selectionState: 'blocked', selectedText: '' });
});

it('rejects a range spanning a form even when its endpoints are outside', () => {
  document.body.innerHTML = '<p>Start</p><form><input value="PRIVATE"><p>Private form text</p></form><p>End</p>';
  select(document.body);
  expect(readPageSnapshot(true)).toMatchObject({ selectionState: 'blocked', selectedText: '' });
});

it('bounds long selections without returning a partially cut email token', () => {
  document.querySelector('#policy')!.textContent = 'Public '.repeat(2_856) + 'user@private.example rest';
  select(document.querySelector('#policy')!);
  const result = readPageSnapshot(true);
  expect(result.selectedText.length).toBeLessThanOrEqual(20_000);
  expect(result.selectionTruncated).toBe(true);
  expect(result.selectedText).not.toContain('user');
});

it('distinguishes blocked cookies and unavailable Resource Timing from empty observations', () => {
  vi.mocked(performance.getEntriesByType).mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => { throw new Error('denied'); });
  expect(readPageSnapshot(false)).toMatchObject({ resourcesAvailable: false, visibleCookieCount: null, resourceHosts: [] });
});

it('limits scans and unique resource hosts', () => {
  vi.mocked(performance.getEntriesByType).mockReturnValue(Array.from({ length: 1_100 }, (_, i) => ({ name: `https://host${i}.net/private` })) as PerformanceEntry[]);
  expect(readPageSnapshot(false)).toMatchObject({ resourceScanLimited: true });
  expect(readPageSnapshot(false).resourceHosts).toHaveLength(200);
});
