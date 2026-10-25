/**
 * State rules of the popup. Run with the repo script: npm run test:popup
 * (node --experimental-strip-types --test, no extra dependency).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCheckBreaches,
  canSubmitPolicy,
  currentHostname,
  initialState,
  overallStatus,
  policyTooLong,
  reducer,
  POLICY_TEXT_LIMIT,
  type AnalysisResponse,
  type BreachesResponse,
  type Evidence,
  type PopupState,
} from '../entrypoints/popup/state.ts';

const EVIDENCE: Evidence[] = [
  {
    id: 'r1',
    kind: 'resource_domain',
    value: 'metrics.tracker.example',
    limitation: 'Сторонний ресурс сам по себе ничего не доказывает.',
  },
];

const ANALYSIS: AnalysisResponse = {
  hostname: 'shop.example',
  status: 'ok',
  mode: 'rules',
  summary: 'Сводка.',
  findings: [],
  limitations: ['Ограничение.'],
};

const BREACHES: BreachesResponse = {
  hostname: 'shop.example',
  matched_domain: 'shop.example',
  status: 'not_found',
  count: 0,
  breaches: [],
  checked_at: '2026-10-25T10:00:00Z',
  source: 'hibp',
  stale: false,
  attribution_url: 'https://haveibeenpwned.com/',
};

function ready(hostname = 'shop.example'): PopupState {
  return reducer(initialState, {
    type: 'page/resolved',
    prepared: { page: { status: 'ready', hostname }, evidence: EVIDENCE },
  });
}

test('page resolution exposes the hostname and the evidence that may be sent', () => {
  const state = ready();
  assert.equal(currentHostname(state), 'shop.example');
  assert.equal(state.evidence.length, 1);
  assert.equal(overallStatus(state), 'idle');
});

test('an unsupported page has no hostname and cannot submit anything', () => {
  const state = reducer(initialState, { type: 'page/failed', reason: 'restricted' });
  assert.equal(currentHostname(state), null);
  assert.equal(overallStatus(state), 'unsupported');
  assert.equal(canSubmitPolicy(state), false);
  assert.equal(canCheckBreaches(state), false);
});

test('nothing can be submitted until the user typed a policy', () => {
  const state = ready();
  assert.equal(canSubmitPolicy(state), false);
  const whitespace = reducer(state, { type: 'policy/changed', text: '   \n ' });
  assert.equal(canSubmitPolicy(whitespace), false);
  const typed = reducer(state, { type: 'policy/changed', text: 'Мы не передаём данные.' });
  assert.equal(canSubmitPolicy(typed), true);
});

test('an over-limit policy is blocked in the popup instead of being sent', () => {
  const state = reducer(ready(), { type: 'policy/changed', text: 'x'.repeat(POLICY_TEXT_LIMIT + 1) });
  assert.equal(policyTooLong(state), true);
  assert.equal(canSubmitPolicy(state), false);
});

test('text pulled from the page is recorded as reviewable, not sent', () => {
  const state = reducer(ready(), { type: 'policy/filled-from-page', text: 'Политика сайта.' });
  assert.equal(state.policySource, 'page');
  assert.equal(state.policyText, 'Политика сайта.');
  assert.equal(state.analysis.phase, 'idle');
  assert.equal(state.breaches.phase, 'idle');
});

test('a second submit is blocked while the first one is still running', () => {
  const typed = reducer(ready(), { type: 'policy/changed', text: 'Политика.' });
  const loading = reducer(typed, { type: 'analysis/started' });
  assert.equal(canSubmitPolicy(loading), false);
  assert.equal(overallStatus(loading), 'working');
});

test('a failed analysis never hides the breaches result', () => {
  let state = ready();
  state = reducer(state, { type: 'analysis/started' });
  state = reducer(state, {
    type: 'analysis/failed',
    hostname: 'shop.example',
    failure: { kind: 'server', status: 503 },
  });
  state = reducer(state, { type: 'breaches/succeeded', hostname: 'shop.example', data: BREACHES });
  assert.equal(state.analysis.phase, 'failed');
  assert.equal(state.breaches.phase, 'ok');
  assert.equal(overallStatus(state), 'partial');
});

test('a failed breaches check never hides the analysis result', () => {
  let state = ready();
  state = reducer(state, { type: 'analysis/succeeded', hostname: 'shop.example', data: ANALYSIS });
  state = reducer(state, {
    type: 'breaches/failed',
    hostname: 'shop.example',
    failure: { kind: 'offline' },
  });
  assert.equal(state.analysis.phase, 'ok');
  assert.equal(state.breaches.phase, 'failed');
  assert.equal(overallStatus(state), 'partial');
});

test('both failures are reported as failed, never as a clean result', () => {
  let state = ready();
  state = reducer(state, {
    type: 'analysis/failed',
    hostname: 'shop.example',
    failure: { kind: 'timeout' },
  });
  state = reducer(state, {
    type: 'breaches/failed',
    hostname: 'shop.example',
    failure: { kind: 'timeout' },
  });
  assert.equal(overallStatus(state), 'failed');
});

test('an answer for another site is dropped instead of replacing the current one', () => {
  const state = ready('shop.example');
  const stale = reducer(state, {
    type: 'analysis/succeeded',
    hostname: 'other.example',
    data: { ...ANALYSIS, hostname: 'other.example' },
  });
  assert.equal(stale.analysis.phase, 'idle');
  assert.equal(stale, state);

  const staleBreaches = reducer(state, {
    type: 'breaches/succeeded',
    hostname: 'other.example',
    data: { ...BREACHES, hostname: 'other.example' },
  });
  assert.equal(staleBreaches.breaches.phase, 'idle');
});

test('a late failure for another site is dropped as well', () => {
  const state = ready('shop.example');
  const stale = reducer(state, {
    type: 'analysis/failed',
    hostname: 'other.example',
    failure: { kind: 'server' },
  });
  assert.equal(stale.analysis.phase, 'idle');
});

test('retry replaces the failure with a fresh attempt', () => {
  let state = reducer(ready(), { type: 'policy/changed', text: 'Политика.' });
  state = reducer(state, {
    type: 'analysis/failed',
    hostname: 'shop.example',
    failure: { kind: 'server' },
  });
  assert.equal(canSubmitPolicy(state), true);
  state = reducer(state, { type: 'analysis/started' });
  assert.equal(state.analysis.phase, 'loading');
});

test('notices appear and are cleared by the next edit', () => {
  let state = reducer(ready(), { type: 'notice/set', message: 'Текст не найден.' });
  assert.equal(state.notice, 'Текст не найден.');
  state = reducer(state, { type: 'policy/changed', text: 'Политика.' });
  assert.equal(state.notice, null);
});

test('breaches can be checked without a policy, and not twice at once', () => {
  const state = ready();
  assert.equal(canCheckBreaches(state), true);
  const loading = reducer(state, { type: 'breaches/started' });
  assert.equal(canCheckBreaches(loading), false);
});

test('both results present means ready', () => {
  let state = ready();
  state = reducer(state, { type: 'analysis/succeeded', hostname: 'shop.example', data: ANALYSIS });
  state = reducer(state, { type: 'breaches/succeeded', hostname: 'shop.example', data: BREACHES });
  assert.equal(overallStatus(state), 'ready');
});

test('HTTP 200 unavailable breaches is failed, not a completed check', () => {
  const state = reducer(ready(), {
    type: 'breaches/succeeded', hostname: 'shop.example',
    data: { ...BREACHES, status: 'unavailable', count: null },
  });
  assert.equal(state.breaches.phase, 'ok'); // Preserve source/date metadata for the card.
  assert.equal(overallStatus(state), 'failed');
});

test('unavailable breaches leaves the independent analysis visible as partial', () => {
  let state = reducer(ready(), { type: 'analysis/succeeded', hostname: 'shop.example', data: ANALYSIS });
  state = reducer(state, {
    type: 'breaches/succeeded', hostname: 'shop.example',
    data: { ...BREACHES, status: 'unavailable', count: null },
  });
  assert.equal(state.analysis.phase, 'ok');
  assert.equal(overallStatus(state), 'partial');
  assert.equal(canCheckBreaches(state), true);
});

test('unavailable analysis is partial with valid breaches and failed with no result', () => {
  let state = reducer(ready(), {
    type: 'analysis/succeeded', hostname: 'shop.example',
    data: { ...ANALYSIS, status: 'unavailable' },
  });
  assert.equal(overallStatus(state), 'failed');
  state = reducer(state, { type: 'breaches/succeeded', hostname: 'shop.example', data: BREACHES });
  assert.equal(overallStatus(state), 'partial');
});

test('both unavailable responses remain failed, not ready', () => {
  let state = reducer(ready(), {
    type: 'analysis/succeeded', hostname: 'shop.example',
    data: { ...ANALYSIS, status: 'unavailable' },
  });
  state = reducer(state, {
    type: 'breaches/succeeded', hostname: 'shop.example',
    data: { ...BREACHES, status: 'unavailable', count: null },
  });
  assert.equal(overallStatus(state), 'failed');
});

test('a foreign response hostname becomes malformed even when the request hostname matches', () => {
  const state = reducer(ready(), { type: 'analysis/started' });
  const analysis = reducer(state, {
    type: 'analysis/succeeded', hostname: 'shop.example',
    data: { ...ANALYSIS, hostname: 'other.example' },
  });
  assert.deepEqual(analysis.analysis, { phase: 'failed', failure: { kind: 'malformed' } });
  assert.equal(analysis.breaches.phase, 'idle');
  const breaches = reducer(ready(), {
    type: 'breaches/succeeded', hostname: 'shop.example',
    data: { ...BREACHES, hostname: 'other.example' },
  });
  assert.deepEqual(breaches.breaches, { phase: 'failed', failure: { kind: 'malformed' } });
  assert.equal(breaches.analysis.phase, 'idle');
});

test('a different matched_domain is legitimate and does not cause a hostname error', () => {
  const state = reducer(ready('www.shop.example'), {
    type: 'breaches/succeeded', hostname: 'www.shop.example',
    data: { ...BREACHES, hostname: 'www.shop.example', matched_domain: 'shop.example' },
  });
  assert.equal(state.breaches.phase, 'ok');
  assert.equal(overallStatus(state), 'ready');
});
