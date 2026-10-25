import { browser, type Browser } from 'wxt/browser';
import { RequestError } from '../entrypoints/popup/controller';
import type { Evidence } from '../entrypoints/popup/state';
import { collectPageEvidence } from './collector';
import { sanitizePolicyText } from './collector-policy';
import { activeDocument, sameDocument, type DocumentContext } from './controller-context';
import { requestApi } from './api-client';
import { record, validEvidence } from './api-validation';
import { discoverPolicy, findPolicyLinks, retrievePolicy } from './policy-discovery';

export const POPUP_PORT = 'amifooled:popup:v1';

export function connectPopup(port: Browser.runtime.Port, base: string) {
  const popup = browser.runtime.getURL('/popup.html');
  if (port.name !== POPUP_PORT || port.sender?.id !== browser.runtime.id ||
      port.sender.tab || port.sender.url?.split('?')[0] !== popup) { port.disconnect(); return; }
  let context: DocumentContext | undefined;
  let evidence: Evidence[] = [];
  let epoch = 0;
  let closed = false;
  const pending = new Map<string, AbortController>();
  const running = new Set<string>();
  const send = (message: unknown) => { if (!closed) { try { port.postMessage(message); } catch { /* Port closed. */ } } };
  const invalidate = () => {
    epoch++;
    context = undefined;
    evidence = [];
    for (const task of pending.values()) task.abort();
    send({ type: 'invalidated' });
  };
  const onUpdated = (tabId: number, info: { status?: string; url?: string }) => {
    if (context?.tabId === tabId && (info.status === 'loading' || info.url)) invalidate();
  };
  const onActivated = () => { if (context || pending.size) invalidate(); };
  const onRemoved = (tabId: number) => { if (context?.tabId === tabId) invalidate(); };
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onActivated.addListener(onActivated);
  browser.tabs.onRemoved.addListener(onRemoved);

  async function checkContext() {
    const expected = context;
    let actual: DocumentContext;
    try { actual = await activeDocument(); }
    catch { invalidate(); throw new RequestError({ kind: 'page_changed' }); }
    if (!expected || context !== expected || !sameDocument(expected, actual)) {
      invalidate();
      throw new RequestError({ kind: 'page_changed' });
    }
    return expected;
  }

  async function run(message: Record<string, unknown>, signal: AbortSignal) {
    const started = epoch;
    if (message.type === 'prepare') {
      const first = await activeDocument();
      const collected = await collectPageEvidence({ source: 'manual', text: '' });
      const last = await activeDocument();
      signal.throwIfAborted();
      if (started !== epoch || !sameDocument(first, last) || collected.status === 'error') {
        throw new RequestError({ kind: 'page_changed' });
      }
      context = last;
      evidence = collected.status === 'ready' ? collected.payload.evidence ?? [] : collected.observations.evidence ?? [];
      return { page: { status: 'ready', hostname: last.hostname }, evidence, notices: collected.notices };
    }
    const current = await checkContext();
    signal.throwIfAborted();
    if (message.type === 'discoverPolicy' || message.type === 'loadPolicy') {
      const links = await findPolicyLinks(current);
      await checkContext();
      signal.throwIfAborted();
      const result = message.type === 'discoverPolicy'
        ? await discoverPolicy(links.origin, links.candidates, signal)
        : await retrievePolicy(typeof message.url === 'string' ? message.url : '', links.origin, links.candidates, signal);
      signal.throwIfAborted();
      await checkContext();
      if (started !== epoch) throw new RequestError({ kind: 'page_changed' });
      return result;
    }
    if (message.type === 'readPolicy') {
      const collected = await collectPageEvidence();
      await checkContext();
      signal.throwIfAborted();
      if (collected.status !== 'ready') return null;
      return collected.payload.policy_text;
    }
    if (message.hostname !== current.hostname) throw new RequestError({ kind: 'page_changed' });
    let result;
    if (message.type === 'analyze') {
      if (typeof message.policyText !== 'string' || !message.policyText.trim() ||
          message.policyText.length > 20000 || sanitizePolicyText(message.policyText).text !== message.policyText ||
          !validEvidence(message.evidence) || JSON.stringify(message.evidence) !== JSON.stringify(evidence)) {
        throw new RequestError({ kind: 'invalid_request' });
      }
      result = await requestApi('analyze', { hostname: current.hostname, policy_text: message.policyText, evidence }, signal, base);
    } else if (message.type === 'breaches') {
      result = await requestApi('breaches', { hostname: current.hostname }, signal, base);
    } else { throw new RequestError({ kind: 'malformed' }); }
    signal.throwIfAborted();
    await checkContext();
    if (started !== epoch) throw new RequestError({ kind: 'page_changed' });
    return result;
  }

  port.onMessage.addListener((message: unknown) => {
    // Local liveness only: no collection, context reset, or HTTP on heartbeats.
    if (record(message) && message.type === 'ping') { send({ type: 'pong' }); return; }
    if (!record(message) || typeof message.id !== 'string' || !/^[\w-]{1,64}$/.test(message.id)) return;
    const id = message.id;
    if (message.type === 'cancel') { pending.get(id)?.abort(); return; }
    const kind = typeof message.type === 'string' ? message.type : '';
    if (!['prepare', 'readPolicy', 'discoverPolicy', 'loadPolicy', 'analyze', 'breaches'].includes(kind)) {
      send({ id, ok: false, failure: { kind: 'malformed' } }); return;
    }
    const exclusive = kind === 'analyze' || kind === 'breaches';
    if (exclusive && running.has(kind)) { send({ id, ok: false, failure: { kind: 'unknown' } }); return; }
    if (pending.has(id) || pending.size >= 4) { send({ id, ok: false, failure: { kind: 'unknown' } }); return; }
    const aborter = new AbortController();
    pending.set(id, aborter);
    if (exclusive) running.add(kind);
    const timer = setTimeout(() => aborter.abort(), 19_000);
    const aborted = new Promise<never>((_, reject) => aborter.signal.addEventListener('abort',
      () => reject(new RequestError({ kind: 'timeout' })), { once: true }));
    void Promise.race([run(message, aborter.signal), aborted])
      .then((result) => { if (!aborter.signal.aborted) send({ id, ok: true, result }); })
      .catch((error: unknown) => send({ id, ok: false, failure: error instanceof RequestError ? error.failure : { kind: 'unknown' } }))
      .finally(() => { clearTimeout(timer); pending.delete(id); if (exclusive) running.delete(kind); });
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    epoch++;
    context = undefined;
    evidence = [];
    for (const task of pending.values()) task.abort();
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onActivated.removeListener(onActivated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  });
}

export function registerBackgroundTransport(base: string) {
  browser.runtime.onConnect.addListener((port) => { if (port.name === POPUP_PORT) connectPopup(port, base); });
}
