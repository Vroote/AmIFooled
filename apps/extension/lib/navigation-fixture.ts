/**
 * Stand-in for the API client until issue #6 wires the real transport.
 *
 * It answers with synthetic data only for reserved demo hosts and for the local test
 * fixture. Every other site gets "unavailable", so a real service is never given an
 * invented breach count: the badge honestly shows "?" instead.
 */

import type { components } from './api.generated';

type BreachesResponse = components['schemas']['BreachesResponse'];

const FIXTURE_COUNTS: Record<string, number> = {
  'demo.example': 1,
  localhost: 2,
  '127.0.0.1': 0,
};

function unavailable(hostname: string): BreachesResponse {
  return {
    hostname,
    matched_domain: null,
    status: 'unavailable',
    count: null,
    breaches: [],
    checked_at: new Date().toISOString(),
    source: 'fixture',
    stale: false,
    attribution_url: 'https://haveibeenpwned.com/',
  };
}

export function createFixtureBreachesCheck(): (
  hostname: string,
  signal: AbortSignal,
) => Promise<BreachesResponse> {
  return async (hostname, signal) => {
    if (signal.aborted) {
      throw new DOMException('aborted', 'AbortError');
    }
    const count = FIXTURE_COUNTS[hostname];
    if (count === undefined) {
      return unavailable(hostname);
    }
    return {
      hostname,
      matched_domain: hostname,
      status: count > 0 ? 'ok' : 'not_found',
      count,
      breaches: [],
      checked_at: new Date().toISOString(),
      source: 'fixture',
      stale: false,
      attribution_url: 'https://haveibeenpwned.com/',
    };
  };
}
