/**
 * The only way a policy leaves the popup.
 *
 * Nothing is sent while typing or on open: the user sees exactly what will be sent and
 * presses the button. Text pulled from the page lands in this editable field first, so
 * it is reviewed before it is sent.
 */

import { POLICY_TEXT_LIMIT } from '../entrypoints/popup/state';
import type { Evidence } from '../entrypoints/popup/state';
import ActionButton from './ActionButton';

interface Props {
  hostname: string | null;
  policyText: string;
  evidence: Evidence[];
  tooLong: boolean;
  canSubmit: boolean;
  busy: boolean;
  canReadPage: boolean;
  notice: string | null;
  onChange: (text: string) => void;
  onFillFromPage: () => void;
  onSubmit: () => void;
}

export default function PolicyForm({
  hostname,
  policyText,
  evidence,
  tooLong,
  canSubmit,
  busy,
  canReadPage,
  notice,
  onChange,
  onFillFromPage,
  onSubmit,
}: Props) {
  const length = policyText.length;
  return (
    <section className="card" aria-labelledby="policy-heading">
      <h2 id="policy-heading">Текст соглашения</h2>
      <label className="field__label" htmlFor="policy-text">
        Откройте политику конфиденциальности сайта и вставьте её текст
      </label>
      <textarea
        id="policy-text"
        className="field__input"
        rows={5}
        value={policyText}
        spellCheck={false}
        aria-describedby="policy-counter policy-payload"
        aria-invalid={tooLong || undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Вставьте раздел политики — например, о передаче данных третьим лицам"
      />
      <p id="policy-counter" className={tooLong ? 'field__hint field__hint--problem' : 'field__hint'}>
        {length.toLocaleString('ru-RU')} из {POLICY_TEXT_LIMIT.toLocaleString('ru-RU')} символов
        {tooLong ? '. Отправьте нужный раздел, а не весь документ.' : ''}
      </p>

      {canReadPage ? (
        <ActionButton variant="secondary" onClick={onFillFromPage}>
          Взять текст с открытой страницы
        </ActionButton>
      ) : null}
      {notice ? (
        <p className="field__hint" role="status">
          {notice}
        </p>
      ) : null}

      <div id="policy-payload" className="payload">
        <p className="payload__title">Что уйдёт на сервер после нажатия:</p>
        <ul className="payload__list">
          <li>имя сайта: {hostname ?? 'не определено'}</li>
          <li>текст соглашения, который вы видите выше: {length.toLocaleString('ru-RU')} символов</li>
          <li>наблюдения со страницы: {evidence.length}</li>
        </ul>
        <p className="payload__note">
          Адрес страницы, cookie, поля форм и содержимое страницы не отправляются. До нажатия
          не отправляется ничего.
        </p>
      </div>

      <ActionButton onClick={onSubmit} disabled={!canSubmit} busy={busy}>
        Отправить и сверить
      </ActionButton>
    </section>
  );
}
