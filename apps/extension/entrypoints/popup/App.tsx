/**
 * Popup shell: owns state transitions, delegates every side effect to the controller.
 *
 * Analysis and breaches are requested separately so one failure cannot hide the other
 * result, and a request that outlives its site is dropped by the reducer.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react';

import AnalysisCard from '../../components/AnalysisCard';
import BreachesCard from '../../components/BreachesCard';
import NavigationOptIn from '../../components/NavigationOptIn';
import PolicyForm from '../../components/PolicyForm';
import { OVERALL_TEXT, UNSUPPORTED_TEXT } from '../../components/messages';
import { RequestError, isRetryable, type PopupController } from './controller';
import {
  canCheckBreaches,
  canSubmitPolicy,
  currentHostname,
  initialState,
  overallStatus,
  policyTooLong,
  reducer,
  type RequestFailure,
} from './state';

const REQUEST_TIMEOUT_MS = 16_000;

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

  useEffect(() => {
    let active = true;
    controller
      .prepare()
      .then((prepared) => {
        if (active) {
          dispatch({ type: 'page/resolved', prepared });
        }
      })
      .catch(() => {
        if (active) {
          dispatch({ type: 'page/failed', reason: 'no-tab' });
        }
      });
    return () => {
      active = false;
      for (const controllerToStop of pending.current) {
        controllerToStop.abort();
      }
      pending.current = [];
    };
  }, [controller]);

  const withTimeout = useCallback(async <T,>(run: (signal: AbortSignal) => Promise<T>) => {
    const aborter = new AbortController();
    pending.current.push(aborter);
    const timer = setTimeout(() => aborter.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await run(aborter.signal);
    } finally {
      clearTimeout(timer);
      pending.current = pending.current.filter((item) => item !== aborter);
    }
  }, []);

  const hostname = currentHostname(state);

  const runAnalysis = useCallback(() => {
    if (!hostname) {
      return;
    }
    const policyText = state.policyText;
    const evidence = state.evidence;
    dispatch({ type: 'analysis/started' });
    withTimeout((signal) => controller.analyze({ hostname, policyText, evidence }, signal))
      .then((data) => dispatch({ type: 'analysis/succeeded', hostname, data }))
      .catch((error: unknown) =>
        dispatch({ type: 'analysis/failed', hostname, failure: failureOf(error) }),
      );
  }, [controller, hostname, state.evidence, state.policyText, withTimeout]);

  const runBreaches = useCallback(() => {
    if (!hostname) {
      return;
    }
    dispatch({ type: 'breaches/started' });
    withTimeout((signal) => controller.checkBreaches(hostname, signal))
      .then((data) => dispatch({ type: 'breaches/succeeded', hostname, data }))
      .catch((error: unknown) =>
        dispatch({ type: 'breaches/failed', hostname, failure: failureOf(error) }),
      );
  }, [controller, hostname, withTimeout]);

  const fillFromPage = useCallback(() => {
    if (!controller.readPolicyFromPage) {
      return;
    }
    controller
      .readPolicyFromPage()
      .then((text) => {
        if (text && text.trim().length > 0) {
          dispatch({ type: 'policy/filled-from-page', text });
          return;
        }
        dispatch({
          type: 'notice/set',
          message: 'На странице не нашлось текста политики — вставьте его вручную.',
        });
      })
      .catch(() =>
        dispatch({
          type: 'notice/set',
          message: 'Не удалось прочитать страницу — вставьте текст вручную.',
        }),
      );
  }, [controller]);

  const overall = overallStatus(state);
  const unsupported =
    state.page.phase === 'ready' && state.page.context.status === 'unsupported'
      ? state.page.context.reason
      : null;

  return (
    <main className="popup">
      <header>
        <p className="brand">
          AmIFooled<span aria-hidden="true">?</span>
        </p>
        <h1>
          Что сайт обещает.
          <br />
          Что мы можем проверить.
        </h1>
        <p className="overall" role="status">
          {OVERALL_TEXT[overall]}
          {hostname ? ` · ${hostname}` : ''}
        </p>
        {controller.demo ? (
          <p className="demo">
            Демо-режим: показаны синтетические данные вымышленного сервиса. Настоящая проверка
            подключается отдельно.
          </p>
        ) : null}
      </header>

      {unsupported ? (
        <section className="card" aria-labelledby="unsupported-heading">
          <h2 id="unsupported-heading">Проверка недоступна</h2>
          <p>{UNSUPPORTED_TEXT[unsupported]}</p>
        </section>
      ) : (
        <>
          <PolicyForm
            hostname={hostname}
            policyText={state.policyText}
            evidence={state.evidence}
            tooLong={policyTooLong(state)}
            canSubmit={canSubmitPolicy(state)}
            busy={state.analysis.phase === 'loading'}
            canReadPage={typeof controller.readPolicyFromPage === 'function'}
            notice={state.notice}
            onChange={(text) => dispatch({ type: 'policy/changed', text })}
            onFillFromPage={fillFromPage}
            onSubmit={runAnalysis}
          />
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
          <BreachesCard
            state={state.breaches}
            hostname={hostname}
            canCheck={canCheckBreaches(state)}
            onCheck={runBreaches}
          />
          <NavigationOptIn hostname={hostname} />
        </>
      )}

      <p className="footnote">
        Проверяется надёжность сайта, а не пользователя. Ваши адреса и пароли никуда не
        отправляются.
      </p>
    </main>
  );
}
