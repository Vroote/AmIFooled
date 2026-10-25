/** Discovery reads public documents locally. Only the separate analysis action sends their text. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PopupController } from '../entrypoints/popup/controller';
import type { Evidence } from '../entrypoints/popup/state';
import { POLICY_KIND_LABEL, POLICY_PROBLEM_TEXT, policyUrl, type PolicyResult } from '../lib/policy-document';
import Icon from './Icon';
import ActionButton from './ActionButton';

interface Props {
  controller: PopupController;
  hostname: string | null;
  policyText: string;
  evidence: Evidence[];
  canSubmit: boolean;
  busy: boolean;
  reviewed: boolean;
  notice: string | null;
  onChange: (text: string) => void;
  onSubmit: () => void;
}

export default function PolicyForm({ controller, hostname, policyText, evidence, canSubmit, busy, reviewed, notice, onChange, onSubmit }: Props) {
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
    if (target !== undefined) setUrl(target);
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
    setResult(null);
    setLoading(false);
    setUrl('');
    setChanging(false);
    return () => { const old = active.current; active.current = null; old?.abort(); };
  }, [hostname, controller]);

  useEffect(() => { if (changing) input.current?.focus(); }, [changing]);

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
    <section className={`card policy ${reviewed ? 'policy--reviewed' : ''}`} aria-labelledby="policy-heading">
      <div className="section-heading"><h2 id="policy-heading">Соглашение сайта</h2><span className="step-label">{document ? 'Найдено' : '01 / Найти'}</span></div>
      {!result && !loading && !changing ? <><p className="muted">Узнайте, на что вы соглашаетесь.</p><ActionButton icon="search" onClick={() => run()} disabled={!hostname || busy}>Найти соглашение</ActionButton></> : null}
      {loading ? <p className="search-progress" role="status"><span className="spinner" aria-hidden="true" />Ищу и загружаю документ…</p> : null}
      {missing ? <p id="policy-problem" className="field__hint field__hint--problem" role="alert">{POLICY_PROBLEM_TEXT[missing.problem]}</p> : null}
      {needsPermission ? (
        <div className="policy__permission">
          <p className="field__hint">Нужен доступ к {new URL(missing.url!).hostname}. Его можно отозвать в Chrome.</p>
          <ActionButton variant="secondary" disabled={busy} onClick={() => run(missing.url, true)}>Разрешить доступ и загрузить</ActionButton>
        </div>
      ) : null}
      {document ? (
        <>
          <a className="document-link" href={document.url} target="_blank" rel="noreferrer">
            <span className="document-icon"><Icon name="document" /></span>
            <span><span className="document-link__title">{document.title}</span><span className="document-link__url">{document.url}</span></span><Icon name="arrow" />
          </a>
          {document.truncated ? <p className="field__hint field__hint--problem">Только первые 20 000 символов — документ длиннее.</p> : null}
          <details className="policy__preview">
            <summary>О документе и отправке</summary>
            <p className="field__hint">{POLICY_KIND_LABEL[document.kind]}. Проверяется только этот документ; другие условия могут быть в отдельных разделах.</p>
            <p className="field__hint">На анализ уйдут {hostname}, текст ({policyText.length.toLocaleString('ru-RU')} символов) и наблюдения ({evidence.length}). Адрес документа, значения cookie и поля форм не отправляются.</p>
            {document.redacted ? <p className="field__hint">Email, части URL и управляющие символы удалены.</p> : null}
            <details className="policy__preview"><summary>Прочитать текст</summary><p className="policy__text" tabIndex={0}>{policyText}</p></details>
          </details>
          {!changing ? <><ActionButton icon={reviewed ? 'search' : 'arrow'} variant={reviewed ? 'secondary' : 'primary'} onClick={onSubmit} disabled={!canSubmit || loading} busy={busy}>{reviewed ? 'Проверить ещё раз' : 'Проверить'}</ActionButton><p className="consent-note">Текст и наблюдения будут отправлены на анализ.</p></> : null}
        </>
      ) : null}
      {!loading && hostname && !missing ? <button className="text-button policy__manual" type="button" disabled={busy} onClick={() => setChanging(!changing)}>{changing ? (document ? 'Оставить этот документ' : 'Вернуться к поиску') : 'Вставить свою ссылку'}</button> : null}
      {(missing || changing) && !loading && hostname ? (
        <div className="policy__fallback">
          {result?.candidates.length ? (
            <details><summary>Другие найденные ссылки · {result.candidates.length}</summary><ul className="policy__candidates">
              {result.candidates.map((candidate) => <li key={candidate.url}><ActionButton variant="secondary" disabled={busy} onClick={() => run(candidate.url)}>{candidate.title}</ActionButton><p className="field__hint">{candidate.url}</p></li>)}
            </ul></details>
          ) : null}
          <form noValidate onSubmit={(event) => { event.preventDefault(); submitUrl(); }}>
            <label className="field__label" htmlFor="policy-url">Ссылка на соглашение или политику</label>
            <input ref={input} id="policy-url" className="field__input" type="url" value={url}
              placeholder="https://example.com/terms" maxLength={2048} disabled={busy}
              aria-invalid={missing?.problem === 'invalid_url' || undefined}
              aria-describedby={missing ? 'policy-url-help policy-problem' : 'policy-url-help'}
              onChange={(event) => setUrl(event.target.value)} />
            <p id="policy-url-help" className="field__hint">Только ссылка. Копировать текст не нужно.</p>
            <ActionButton type="submit" disabled={busy || !url.trim()} onClick={() => {}}>Загрузить по ссылке</ActionButton>
          </form>
          <ActionButton variant="secondary" icon="search" disabled={busy} onClick={() => run()}>Найти на сайте заново</ActionButton>
        </div>
      ) : null}
      {notice ? document ? <p className="field__hint" role="status">{notice}</p> : <details className="policy__preview collection-notes"><summary>О наблюдениях</summary><p className="field__hint">{notice}</p></details> : null}
    </section>
  );
}
