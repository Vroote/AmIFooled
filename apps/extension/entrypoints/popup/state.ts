/**
 * Pure popup state. No transport, no browser APIs: the controller does that work and
 * this reducer only records what came back. Analysis and breaches are separate cards,
 * so a failure in one can never hide the other.
 */

import type { components } from '../../lib/api.generated';

export type AnalysisResponse = components['schemas']['AnalysisResponse'];
export type BreachesResponse = components['schemas']['BreachesResponse'];
export type Evidence = components['schemas']['Evidence'];
export type Finding = components['schemas']['Finding'];

export const POLICY_TEXT_LIMIT = 20000;

export type RequestFailureKind =
  | 'offline'
  | 'timeout'
  | 'not_implemented'
  | 'invalid_request'
  | 'too_large'
  | 'server'
  | 'malformed'
  | 'unknown';

export interface RequestFailure {
  kind: RequestFailureKind;
  status?: number;
}

export type UnsupportedReason = 'restricted' | 'no-tab' | 'scheme';

export type PageContext =
  | { status: 'ready'; hostname: string }
  | { status: 'unsupported'; reason: UnsupportedReason };

export interface PreparedContext {
  page: PageContext;
  evidence: Evidence[];
}

export type CardState<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; data: T }
  | { phase: 'failed'; failure: RequestFailure };

export interface PopupState {
  page: { phase: 'loading' } | { phase: 'ready'; context: PageContext };
  evidence: Evidence[];
  policyText: string;
  policySource: 'manual' | 'page' | null;
  notice: string | null;
  analysis: CardState<AnalysisResponse>;
  breaches: CardState<BreachesResponse>;
}

export type PopupAction =
  | { type: 'page/resolved'; prepared: PreparedContext }
  | { type: 'page/failed'; reason: UnsupportedReason }
  | { type: 'policy/changed'; text: string }
  | { type: 'policy/filled-from-page'; text: string }
  | { type: 'notice/set'; message: string }
  | { type: 'notice/cleared' }
  | { type: 'analysis/started' }
  | { type: 'analysis/succeeded'; hostname: string; data: AnalysisResponse }
  | { type: 'analysis/failed'; hostname: string; failure: RequestFailure }
  | { type: 'breaches/started' }
  | { type: 'breaches/succeeded'; hostname: string; data: BreachesResponse }
  | { type: 'breaches/failed'; hostname: string; failure: RequestFailure };

export const initialState: PopupState = {
  page: { phase: 'loading' },
  evidence: [],
  policyText: '',
  policySource: null,
  notice: null,
  analysis: { phase: 'idle' },
  breaches: { phase: 'idle' },
};

export function currentHostname(state: PopupState): string | null {
  if (state.page.phase !== 'ready' || state.page.context.status !== 'ready') {
    return null;
  }
  return state.page.context.hostname;
}

/** A late answer for a different site is dropped instead of replacing the current one. */
function belongsToCurrentPage(state: PopupState, hostname: string): boolean {
  return currentHostname(state) === hostname;
}

export function reducer(state: PopupState, action: PopupAction): PopupState {
  switch (action.type) {
    case 'page/resolved':
      return {
        ...state,
        page: { phase: 'ready', context: action.prepared.page },
        evidence: action.prepared.evidence,
      };
    case 'page/failed':
      return {
        ...state,
        page: { phase: 'ready', context: { status: 'unsupported', reason: action.reason } },
        evidence: [],
      };
    case 'policy/changed':
      return { ...state, policyText: action.text, policySource: 'manual', notice: null };
    case 'policy/filled-from-page':
      return { ...state, policyText: action.text, policySource: 'page', notice: null };
    case 'notice/set':
      return { ...state, notice: action.message };
    case 'notice/cleared':
      return { ...state, notice: null };
    case 'analysis/started':
      return { ...state, analysis: { phase: 'loading' } };
    case 'analysis/succeeded':
      if (!belongsToCurrentPage(state, action.hostname)) {
        return state;
      }
      return { ...state, analysis: { phase: 'ok', data: action.data } };
    case 'analysis/failed':
      if (!belongsToCurrentPage(state, action.hostname)) {
        return state;
      }
      return { ...state, analysis: { phase: 'failed', failure: action.failure } };
    case 'breaches/started':
      return { ...state, breaches: { phase: 'loading' } };
    case 'breaches/succeeded':
      if (!belongsToCurrentPage(state, action.hostname)) {
        return state;
      }
      return { ...state, breaches: { phase: 'ok', data: action.data } };
    case 'breaches/failed':
      if (!belongsToCurrentPage(state, action.hostname)) {
        return state;
      }
      return { ...state, breaches: { phase: 'failed', failure: action.failure } };
    default: {
      const unhandled: never = action;
      return unhandled;
    }
  }
}

export function policyTooLong(state: PopupState): boolean {
  return state.policyText.length > POLICY_TEXT_LIMIT;
}

export function canSubmitPolicy(state: PopupState): boolean {
  return (
    currentHostname(state) !== null &&
    state.policyText.trim().length > 0 &&
    !policyTooLong(state) &&
    state.analysis.phase !== 'loading'
  );
}

export function canCheckBreaches(state: PopupState): boolean {
  return currentHostname(state) !== null && state.breaches.phase !== 'loading';
}

export type OverallStatus =
  | 'page-loading'
  | 'unsupported'
  | 'idle'
  | 'working'
  | 'ready'
  | 'partial'
  | 'failed';

/**
 * One honest line about the whole popup. "partial" exists so a half-answer is never
 * presented as a finished check, and "failed" is never presented as a clean result.
 */
export function overallStatus(state: PopupState): OverallStatus {
  if (state.page.phase === 'loading') {
    return 'page-loading';
  }
  if (state.page.context.status === 'unsupported') {
    return 'unsupported';
  }
  const phases = [state.analysis.phase, state.breaches.phase];
  if (phases.includes('loading')) {
    return 'working';
  }
  const done = phases.filter((phase) => phase === 'ok').length;
  const failed = phases.filter((phase) => phase === 'failed').length;
  if (done === 0 && failed === 0) {
    return 'idle';
  }
  if (failed > 0 && done > 0) {
    return 'partial';
  }
  if (failed > 0) {
    return 'failed';
  }
  return 'ready';
}
