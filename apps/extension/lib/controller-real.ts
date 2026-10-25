import { browser, type Browser } from 'wxt/browser';
import { RequestError, type PopupController } from '../entrypoints/popup/controller';
import type { PreparedContext, RequestFailure } from '../entrypoints/popup/state';
import { record, validEvidence, validAnalysis, validBreaches } from './api-validation';

const PORT_NAME = 'amifooled:popup:v1';
const failureKinds = ['offline', 'timeout', 'not_implemented', 'invalid_request', 'too_large', 'server', 'malformed', 'unknown', 'page_changed', 'unsupported_page'];

export function createRealController(): PopupController {
  let port: Browser.runtime.Port | undefined;
  const listeners = new Set<() => void>();
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: RequestError): void }>();
  const invalidate = () => {
    for (const task of pending.values()) task.reject(new RequestError({ kind: 'page_changed' }));
    pending.clear();
    listeners.forEach((listener) => listener());
  };
  const connect = () => {
    if (port) return port;
    const next = browser.runtime.connect({ name: PORT_NAME });
    port = next;
    next.onMessage.addListener((message: unknown) => {
      if (!record(message)) return;
      if (message.type === 'invalidated') { invalidate(); return; }
      const task = typeof message.id === 'string' ? pending.get(message.id) : undefined;
      if (!task) return;
      pending.delete(String(message.id));
      if (message.ok === true) task.resolve(message.result);
      else {
        const failure: RequestFailure = record(message.failure) && typeof message.failure.kind === 'string' && failureKinds.includes(message.failure.kind)
          ? { kind: message.failure.kind as RequestFailure['kind'] } : { kind: 'malformed' };
        task.reject(new RequestError(failure));
      }
    });
    next.onDisconnect.addListener(() => { if (port === next) { port = undefined; invalidate(); } });
    return next;
  };
  async function call(type: string, fields = {}, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new RequestError({ kind: 'timeout' });
    const current = connect();
    const id = crypto.randomUUID();
    const stop = () => {
      try { current.postMessage({ id, type: 'cancel' }); } catch { /* Worker stopped. */ }
      pending.get(id)?.reject(new RequestError({ kind: 'timeout' }));
      pending.delete(id);
    };
    const timer = setTimeout(stop, 20_000);
    signal?.addEventListener('abort', stop, { once: true });
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { current.postMessage({ id, type, ...fields }); }
        catch { pending.delete(id); reject(new RequestError({ kind: 'offline' })); }
      });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  }
  return {
    demo: false,
    subscribeInvalidation(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { port?.disconnect(); port = undefined; invalidate(); },
    async prepare() {
      const result = await call('prepare');
      if (!record(result) || !record(result.page) || result.page.status !== 'ready' ||
          typeof result.page.hostname !== 'string' || !validEvidence(result.evidence) ||
          !(Array.isArray(result.notices) && result.notices.length <= 20 && result.notices.every((notice) => typeof notice === 'string' && notice.length <= 5000))) throw new RequestError({ kind: 'malformed' });
      return result as unknown as PreparedContext;
    },
    async readPolicyFromPage() {
      const result = await call('readPolicy');
      if (!(result === null || typeof result === 'string' && result.length <= 20000)) throw new RequestError({ kind: 'malformed' });
      return result;
    },
    async analyze(input, signal) {
      const result = await call('analyze', input, signal);
      if (!validAnalysis(result, input.hostname, input.policyText, input.evidence)) throw new RequestError({ kind: 'malformed' });
      return result;
    },
    async checkBreaches(hostname, signal) {
      const result = await call('breaches', { hostname }, signal);
      if (!validBreaches(result, hostname)) throw new RequestError({ kind: 'malformed' });
      return result;
    },
  };
}
