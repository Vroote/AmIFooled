import { RequestError, classify } from '../entrypoints/popup/controller';
import type { AnalysisRequest } from './collector';
import type { AnalysisResponse, BreachesResponse } from '../entrypoints/popup/state';
import { parseApiBase } from './api-config';
import { validAnalysis, validBreaches } from './api-validation';

export async function requestApi(kind: 'analyze', input: AnalysisRequest, signal: AbortSignal, base: string): Promise<AnalysisResponse>;
export async function requestApi(kind: 'breaches', input: { hostname: string }, signal: AbortSignal, base: string): Promise<BreachesResponse>;
export async function requestApi(kind: 'analyze' | 'breaches', input: { hostname: string } | AnalysisRequest, signal: AbortSignal, base: string) {
  if (signal.aborted) throw new RequestError({ kind: 'timeout' });
  const url = new URL(`${parseApiBase(base)}/v1/${kind}`);
  if (kind === 'breaches') url.searchParams.set('hostname', input.hostname);
  const aborter = new AbortController();
  const stop = () => aborter.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) aborter.abort();
  const timer = setTimeout(stop, 16_000);
  try {
    const response = await fetch(url, {
      method: kind === 'analyze' ? 'POST' : 'GET',
      ...(kind === 'analyze' ? { body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } } : {}),
      signal: aborter.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new RequestError(classify(response.status));
    if (!response.body) throw new RequestError({ kind: 'malformed' });
    const reader = response.body.getReader();
    let data = '';
    let bytes = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new RequestError({ kind: 'malformed' });
        data += decoder.decode(part.value, { stream: true });
      }
      data += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const value: unknown = JSON.parse(data);
    const valid = kind === 'analyze' && 'policy_text' in input
      ? validAnalysis(value, input.hostname, input.policy_text, input.evidence ?? [])
      : kind === 'breaches' && validBreaches(value, input.hostname);
    if (!valid) throw new RequestError({ kind: 'malformed' });
    return value as AnalysisResponse | BreachesResponse;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (aborter.signal.aborted) throw new RequestError({ kind: 'timeout' });
    if (error instanceof SyntaxError || error instanceof TypeError && error.message.includes('encoded')) {
      throw new RequestError({ kind: 'malformed' });
    }
    throw new RequestError({ kind: 'offline' });
  } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
}
