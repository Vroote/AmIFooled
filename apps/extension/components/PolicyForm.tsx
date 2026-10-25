/** Discovery reads public documents locally. Only the separate analysis action sends their text. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PopupController } from '../entrypoints/popup/controller';
import type { Evidence } from '../entrypoints/popup/state';
import { POLICY_KIND_LABEL, POLICY_PROBLEM_TEXT, policyUrl, type PolicyResult } from '../lib/policy-document';
import ActionButton from './ActionButton';

interface Props {
  controller: PopupController;
  hostname: string | null;
  policyText: string;
  evidence: Evidence[];
  canSubmit: boolean;
  busy: boolean;
  notice: string | null;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

export default function PolicyForm({ controller, hostname, policyText, evidence, canSubmit, busy, notice, onChange, onSubmit }: Props) {
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [changing, setChanging] = useState(false);
  const active = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useCallback((target?: string, grantAccess = false) => {
    active.current?.abort();
    const aborter = new AbortController();
    active.current = aborter;
    setLoading(true);
    setResult(null);
    onChange('');
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('cancelled'));
      aborter.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const timer = setTimeout(() => aborter.abort(), 18_000);
    // Invoke synchronously: Chrome permission requests need the button's user activation.
    const operation = target !== undefined
      ? controller.loadPolicy?.(target, aborter.signal, grantAccess)
      : controller.discoverPolicy?.(aborter.signal);
    void Promise.race([operation ?? Promise.resolve<PolicyResult>({ status: 'missing', problem: 'not_found', candidates: [] }), aborted])
      .then((next) => {
        if (active.current !== aborter || aborter.signal.aborted) return;
        setResult(next);
        if (next.status === 'ready') {
          onChange(next.document.text);
          setUrl(next.document.url);
          setChanging(false);
        }
      })
      .catch(() => {
        if (active.current === aborter) setResult({
          status: 'missing', problem: aborter.signal.aborted ? 'timeout' : 'network', candidates: [],
        });
      })
      .finally(() => {
        clearTimeout(timer);
        aborter.signal.removeEventListener('abort', rejectAbort);
        if (active.current === aborter) setLoading(false);
      });
  }, [controller, onChange]);

  useEffect(() => {
    if (hostname) run();
    return () => { const old = active.current; active.current = null; old?.abort(); };
  }, [hostname, run]);

  const missing = result?.status === 'missing' ? result : null;
  const document = result?.status === 'ready' ? result.document : null;
  const needsPermission = missing?.url && (missing.problem === 'permission' || missing.problem === 'denied');
  const submitUrl = () => {
    if (loading || busy || !hostname) return;
    const safe = policyUrl(url.trim());
    if (!safe) {
      setResult({ status: 'missing', problem: 'invalid_url', candidates: [] });
      onChange('');
      input.current?.focus();
      return;
    }
    run(safe.href);
  };

  return (
    <section className="card policy" aria-labelledby="policy-heading">
      <h2 id="policy-heading">Соглашение сайта</h2>
      <p className="card__status" role="status">
        {loading ? 'Ищу и загружаю публичный документ…' : document ? 'Документ загружен. Проверьте источник перед анализом.' : 'Нужен документ для проверки'}
      </p>
      {missing ? <p id="policy-problem" className="field__hint field__hint--problem" role="alert">{POLICY_PROBLEM_TEXT[missing.problem]}</p> : null}
      {needsPermission ? (
        <div className="policy__source">
          <p>{new URL(missing.url!).hostname}</p>
          <p className="field__hint">Chrome запросит доступ к этому сайту. Позже его можно отозвать в настройках расширения.</p>
          <ActionButton variant="secondary" disabled={busy} onClick={() => run(missing.url, true)}>
            Разрешить доступ и загрузить
          </ActionButton>
        </div>
      ) : null}
      {document ? (
        <div className="policy__source">
          <p className="payload__title">{POLICY_KIND_LABEL[document.kind]}</p>
          <p>{document.title}</p>
          <a href={document.url} target="_blank" rel="noreferrer">{document.url}</a>
          <p className="field__hint">Проверяется этот документ. Другие условия сайта могут быть в отдельных разделах.</p>
          {document.truncated ? <p className="field__hint field__hint--problem">Документ длинный: будет проверен только первый фрагмент до 20 000 символов.</p> : null}
          {document.redacted ? <p className="field__hint">Email, части URL и управляющие символы удалены из текста.</p> : null}
          <details className="policy__preview">
            <summary>Посмотреть текст · {policyText.length.toLocaleString('ru-RU')} символов</summary>
            <p className="policy__text" tabIndex={0}>{policyText}</p>
          </details>
          <ActionButton variant="secondary" disabled={busy} onClick={() => setChanging(!changing)}>
            {changing ? 'Оставить этот документ' : 'Выбрать другой документ'}
          </ActionButton>
        </div>
      ) : null}
      {(!document || changing) && !loading && hostname ? (
        <div className="policy__fallback">
          {result?.candidates.length ? (
            <details>
              <summary>Найденные ссылки ({result.candidates.length})</summary>
              <ul className="policy__candidates">
                {result.candidates.map((candidate) => (
                  <li key={candidate.url}>
                    <ActionButton variant="secondary" disabled={busy} onClick={() => run(candidate.url)}>{candidate.title}</ActionButton>
                    <p className="field__hint">{candidate.url}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <form noValidate onSubmit={(event) => { event.preventDefault(); submitUrl(); }}>
            <label className="field__label" htmlFor="policy-url">Ссылка на соглашение или политику</label>
            <input ref={input} id="policy-url" className="field__input" type="url" value={url}
              placeholder="https://example.com/terms" maxLength={2048} disabled={busy}
              aria-invalid={missing?.problem === 'invalid_url' || undefined}
              aria-describedby={missing ? 'policy-url-help policy-problem' : 'policy-url-help'}
              onChange={(event) => setUrl(event.target.value)} />
            <p id="policy-url-help" className="field__hint">Вставьте только ссылку на публичный документ. Копировать текст не нужно.</p>
            <ActionButton type="submit" disabled={busy || !url.trim()} onClick={() => {}}>Загрузить по ссылке</ActionButton>
          </form>
          <ActionButton variant="secondary" disabled={busy} onClick={() => run()}>Найти на сайте заново</ActionButton>
        </div>
      ) : null}
      {notice ? <p className="field__hint" role="status">{notice}</p> : null}
      <div className="payload">
        <p className="payload__title">После нажатия «Отправить и сверить» уйдут:</p>
        <ul className="payload__list">
          <li>имя сайта: {hostname ?? 'не определено'}</li>
          <li>подготовленный текст: {policyText.length.toLocaleString('ru-RU')} символов</li>
          <li>наблюдения со страницы: {evidence.length}</li>
        </ul>
        <p className="payload__note">Пока документ загружается только с сайта в расширение. В анализ он не отправляется. Адрес документа, значения cookie и поля форм в анализ не попадут.</p>
      </div>
      <ActionButton onClick={onSubmit} disabled={!document || !canSubmit || loading} busy={busy}>Отправить и сверить</ActionButton>
    </section>
  );
}
