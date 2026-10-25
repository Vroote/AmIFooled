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
<details><summary><span className="finding__severity">{SEVERITY_TEXT[finding.severity]}</span><span className="finding__title">{finding.title}</span></summary><div className="finding__detail">
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
      </div></details>
    </li>
  );
}

export default function AnalysisCard({ state, evidence, canRetry, onRetry }: Props) {
  if (state.phase === 'idle') return null;

  if (state.phase === 'loading') {
    return (
      <CardShell id="analysis" title="Краткая сводка" status="Сверяю…">
        <p className="muted">Сравниваю условия с наблюдениями страницы.</p>
      </CardShell>
    );
  }

  if (state.phase === 'failed') {
    return (
      <CardShell
        id="analysis"
        title="Краткая сводка"
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
      </CardShell>
    );
  }

  const { data } = state;
  const status = `${ANALYSIS_STATUS_TEXT[data.status]}${data.mode === 'fixture' ? ' · демо' : ''}`;
  const summary = data.summary.length > 220 ? `${data.summary.slice(0, 220).replace(/\s+\S*$/, '')}…` : data.summary;

  return (
    <CardShell id="analysis" title="Краткая сводка" status={status}>
      {summary === data.summary ? <p className="analysis-summary">{summary}</p> : <details className="summary-detail"><summary>{summary}</summary><p>{data.summary}</p></details>}
      {data.status === 'unavailable' ? (
        <p className="muted">
          Результат сверки недоступен. Это не означает, что расхождений нет.
        </p>
      ) : data.findings.length > 0 ? (
        <ul className="finding__list">
          {data.findings.slice(0, 3).map((finding, index) => (
            <FindingItem key={`${finding.title}-${index}`} finding={finding} evidence={evidence} />
          ))}
        </ul>
      ) : (
        <p className="muted">
          {data.status === 'insufficient_data' ? 'Для сравнения с поведением сайта недостаточно наблюдений.' : 'По текущим правилам расхождений нет. Это не заключение о безопасности сайта.'}
        </p>
      )}
      {data.findings.length > 3 && data.status !== 'unavailable' ? <details className="extra-findings"><summary>Ещё замечания · {data.findings.length - 3}</summary><ul className="finding__list">{data.findings.slice(3).map((finding, index) => <FindingItem key={index} finding={finding} evidence={evidence} />)}</ul></details> : null}
      <details className="analysis-limits"><summary>Как читать результат</summary><p className="field__hint">Метод: {ANALYSIS_MODE_TEXT[data.mode]}. Замечания не доказывают нарушение.</p><ul className="limits">{data.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></details>
    </CardShell>
  );
}
