/** Promise versus observation. Every finding shows its quote, its fact and its limit. */

import type { CardState, AnalysisResponse, Evidence, Finding } from '../entrypoints/popup/state';
import ActionButton from './ActionButton';
import CardShell from './CardShell';
import { ANALYSIS_MODE_TEXT, ANALYSIS_STATUS_TEXT, FAILURE_TEXT, SEVERITY_TEXT } from './messages';

interface Props {
  state: CardState<AnalysisResponse>;
  evidence: Evidence[];
  canRetry: boolean;
  onRetry: () => void;
}

/** The raw value is not self-describing, so each kind gets its own wording. */
function describeEvidence(item: Evidence): string {
  if (item.kind === 'visible_cookie_count') {
    return `cookie, доступных JavaScript: ${item.value}`;
  }
  if (item.kind === 'resource_domain') {
    return `сторонний домен: ${item.value}`;
  }
  return item.value;
}

function FindingItem({ finding, evidence }: { finding: Finding; evidence: Evidence[] }) {
  const cited = evidence.filter((item) => finding.evidence_ids.includes(item.id));
  return (
    <li className={`finding finding--${finding.severity}`}>
      <p className="finding__severity">{SEVERITY_TEXT[finding.severity]}</p>
      <h3 className="finding__title">{finding.title}</h3>
      <p>{finding.explanation}</p>
      {finding.policy_quote ? (
        <blockquote className="finding__quote">{finding.policy_quote}</blockquote>
      ) : (
        <p className="finding__quote finding__quote--absent">
          Цитировать нечего: в переданном тексте об этом не сказано.
        </p>
      )}
      {cited.length > 0 ? (
        <ul className="finding__evidence">
          {cited.map((item) => (
            <li key={item.id}>
              <span className="finding__fact">{describeEvidence(item)}</span>
              <span className="finding__limit">{item.limitation}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function AnalysisCard({ state, evidence, canRetry, onRetry }: Props) {
  if (state.phase === 'idle') {
    return (
      <CardShell id="analysis" title="Сверка обещаний и наблюдений" status="Ещё не запускалась">
        <p className="muted">
          Вставьте текст соглашения выше и нажмите «Отправить и сверить».
        </p>
      </CardShell>
    );
  }

  if (state.phase === 'loading') {
    return (
      <CardShell id="analysis" title="Сверка обещаний и наблюдений" status="Сверяю…">
        <p className="muted">Сравниваю текст соглашения с наблюдениями страницы.</p>
      </CardShell>
    );
  }

  if (state.phase === 'failed') {
    return (
      <CardShell
        id="analysis"
        title="Сверка обещаний и наблюдений"
        status="Сверка не выполнена"
        footer={
          canRetry ? (
            <ActionButton variant="secondary" onClick={onRetry}>
              Повторить сверку
            </ActionButton>
          ) : null
        }
      >
        <p>{FAILURE_TEXT[state.failure.kind]}</p>
        <p className="muted">Утечки сайта проверяются отдельно и этой ошибкой не затронуты.</p>
      </CardShell>
    );
  }

  const { data } = state;
  const status = `${ANALYSIS_STATUS_TEXT[data.status]} · ${ANALYSIS_MODE_TEXT[data.mode]}`;

  return (
    <CardShell id="analysis" title="Сверка обещаний и наблюдений" status={status}>
      <p>{data.summary}</p>
      {data.status === 'unavailable' ? (
        <p className="muted">
          Результат сверки недоступен. Это не означает, что расхождений нет.
        </p>
      ) : data.findings.length > 0 ? (
        <ul className="finding__list">
          {data.findings.map((finding, index) => (
            <FindingItem key={`${finding.title}-${index}`} finding={finding} evidence={evidence} />
          ))}
        </ul>
      ) : (
        <p className="muted">
          По текущим правилам расхождений нет. Это не заключение о безопасности сайта.
        </p>
      )}
      {data.limitations.length > 0 ? (
        <>
          <h3 className="limits__title">Что эта проверка не доказывает</h3>
          <ul className="limits">
            {data.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </>
      ) : null}
    </CardShell>
  );
}
