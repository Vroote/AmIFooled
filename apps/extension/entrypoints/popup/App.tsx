/**
 * Popup shell: owns state transitions, delegates every side effect to the controller.
 *
 * Analysis and breaches are requested separately so one failure cannot hide the other
 * result, and a request that outlives its site is dropped by the reducer.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

import AnalysisCard from '../../components/AnalysisCard';
import BreachesCard from '../../components/BreachesCard';
import SiteStats from '../../components/SiteStats';
import Icon from '../../components/Icon';
import NavigationOptIn from '../../components/NavigationOptIn';
import PolicyForm from '../../components/PolicyForm';
import { UNSUPPORTED_TEXT } from '../../components/messages';
import { RequestError, isRetryable, type PopupController } from './controller';
import { sanitizePolicyText } from '../../lib/collector-policy';
import ActionButton from '../../components/ActionButton';
import {
  canCheckBreaches,
  canSubmitPolicy,
  currentHostname,
  initialState,
  reducer,
  type RequestFailure,
} from './state';

const REQUEST_TIMEOUT_MS = 20_000;

function failureOf(error: unknown): RequestFailure {
  if (error instanceof RequestError) {
    return error.failure;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'timeout' };
  }
  return { kind: 'unknown' };
}

export default function App({ controller }: { controller: PopupController }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const pending = useRef<AbortController[]>([]);
  const generation = useRef(0);

  const preparePage = useCallback(() => {
    const version = ++generation.current;
    pending.current.forEach((request) => request.abort());
    dispatch({ type: 'page/started' });
    controller.prepare().then((prepared) => {
      if (version === generation.current) {
        dispatch({ type: 'page/resolved', prepared });
      }
    }).catch((error: unknown) => {
      if (version === generation.current) dispatch({ type: 'page/failed', reason:
        error instanceof RequestError && error.failure.kind === 'unsupported_page' ? 'restricted' : 'changed' });
    });
  }, [controller]);

  useEffect(() => {
    const unsubscribe = controller.subscribeInvalidation?.(() => {
      generation.current++;
      pending.current.forEach((request) => request.abort());
      dispatch({ type: 'page/failed', reason: 'changed' });
    });
    preparePage();
    return () => {
      generation.current++;
      unsubscribe?.();
      for (const controllerToStop of pending.current) {
        controllerToStop.abort();
      }
      pending.current = [];
    };
  }, [controller, preparePage]);

  const withTimeout = useCallback(async <T,>(run: (signal: AbortSignal) => Promise<T>) => {
    const aborter = new AbortController();
    pending.current.push(aborter);
    const timer = setTimeout(() => aborter.abort(), REQUEST_TIMEOUT_MS);
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
      aborter.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      return await Promise.race([run(aborter.signal), cancelled]);
    } finally {
      clearTimeout(timer);
      aborter.signal.removeEventListener('abort', rejectAbort);
      pending.current = pending.current.filter((item) => item !== aborter);
    }
  }, []);

  const hostname = currentHostname(state);

  const runAnalysis = useCallback(() => {
    if (!hostname) {
      return;
    }
    const policyText = state.policyText;
    const cleaned = sanitizePolicyText(policyText);
    if (cleaned.text !== policyText) {
      dispatch({ type: 'policy/changed', text: cleaned.text });
      dispatch({ type: 'notice/set', message: 'Email, части URL и управляющие символы удалены. Проверьте очищенный текст и нажмите отправку ещё раз.' });
      return;
    }
    const evidence = state.evidence;
    const version = generation.current;
    dispatch({ type: 'analysis/started' });
    withTimeout((signal) => controller.analyze({ hostname, policyText, evidence }, signal))
      .then((data) => { if (version === generation.current) dispatch({ type: 'analysis/succeeded', hostname, data }); })
      .catch((error: unknown) =>
        { if (version === generation.current) dispatch({ type: 'analysis/failed', hostname, failure: failureOf(error) }); },
      );
  }, [controller, hostname, state.evidence, state.policyText, withTimeout]);

  const runBreaches = useCallback(() => {
    if (!hostname) {
      return;
    }
    dispatch({ type: 'breaches/started' });
    const version = generation.current;
    withTimeout((signal) => controller.checkBreaches(hostname, signal))
      .then((data) => { if (version === generation.current) dispatch({ type: 'breaches/succeeded', hostname, data }); })
      .catch((error: unknown) =>
        { if (version === generation.current) dispatch({ type: 'breaches/failed', hostname, failure: failureOf(error) }); },
      );
  }, [controller, hostname, withTimeout]);

  const changePolicy = useCallback((text: string) => dispatch({ type: 'policy/changed', text }), []);

  const unsupported =
    state.page.phase === 'ready' && state.page.context.status === 'unsupported'
      ? state.page.context.reason
      : null;

  return (
    <main className="popup">
      <header className="site-header">
        <div className="brand-row"><p className="brand">AmIFooled<span aria-hidden="true">?</span></p><span className="brand-caption">Проверка сайта</span></div>
        <div className="site-heading"><span className="site-icon"><Icon name="globe" /></span><div><p className="eyebrow">Текущий сайт</p><h1>{hostname ?? (unsupported ? 'Недоступная страница' : 'Определяю сайт…')}</h1></div></div>
        {controller.demo ? <p className="demo">Демо · вымышленные данные</p> : null}
      </header>

      {unsupported ? (
        <section className="card" aria-labelledby="unsupported-heading">
          <h2 id="unsupported-heading">Проверка недоступна</h2>
          <p>{UNSUPPORTED_TEXT[unsupported]}</p>
          {unsupported === 'changed' ? <ActionButton onClick={preparePage}>Обновить контекст проверки</ActionButton> : null}
        </section>
      ) : (
        <>
          <SiteStats evidence={state.evidence} breaches={state.breaches} canCheck={canCheckBreaches(state)} onCheck={runBreaches} />
          <AnalysisCard
            state={state.analysis}
            evidence={state.evidence}
            canRetry={
              state.analysis.phase === 'failed' &&
              isRetryable(state.analysis.failure) &&
              canSubmitPolicy(state)
            }
            onRetry={runAnalysis}
          />
          <PolicyForm
            controller={controller}
            hostname={hostname}
            policyText={state.policyText}
            evidence={state.evidence}
            canSubmit={canSubmitPolicy(state)}
            busy={state.analysis.phase === 'loading'}
            reviewed={state.analysis.phase === 'ok'}
            notice={state.notice}
            onChange={changePolicy}
            onSubmit={runAnalysis}
          />
          {state.breaches.phase === 'ok' ? <details className="disclosure breaches-detail"><summary>История утечек <span>Источники и даты</span></summary><BreachesCard
            state={state.breaches} hostname={hostname} canCheck={canCheckBreaches(state)} onCheck={runBreaches}
          /></details> : <BreachesCard
            state={state.breaches}
            hostname={hostname}
            canCheck={canCheckBreaches(state)}
            onCheck={runBreaches}
          />}
          <details className="disclosure settings"><summary>Настройки сайта</summary><NavigationOptIn hostname={hostname} /></details>
        </>
      )}

      <details className="privacy-details">
        <summary>Что видит расширение</summary>
        <p>Счётчик показывает только cookies, доступные JavaScript на этой странице, без HttpOnly. Их имена и значения, пароли и поля форм не отправляются.</p>
        <p>Утечки ищутся по имени сайта. Анализ получает имя сайта, текст выбранного документа и ограниченные наблюдения. Результат не гарантирует безопасность сайта.</p>
      </details>
    </main>
  );
}
