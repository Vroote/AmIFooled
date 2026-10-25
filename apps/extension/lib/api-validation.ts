import type { AnalysisResponse, BreachesResponse, Evidence } from '../entrypoints/popup/state';

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 5000): value is string => typeof value === 'string' && value.length <= max;
const oneOf = (value: unknown, allowed: string[]) => typeof value === 'string' && allowed.includes(value);
const strings = (value: unknown, max = 100): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((item) => text(item));
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
const sourceUrl = (value: unknown) => {
  if (!text(value, 2000)) return false;
  try { const url = new URL(value); return url.origin === 'https://haveibeenpwned.com' && !url.username && !url.password; }
  catch { return false; }
};

export function validEvidence(value: unknown): value is Evidence[] {
  return Array.isArray(value) && value.length <= 100 &&
    new Set(value.map((item) => record(item) ? item.id : null)).size === value.length &&
    value.every((item) => record(item) && keys(item, ['id', 'kind', 'value', 'limitation']) &&
      text(item.id, 64) && item.id.length > 0 &&
      oneOf(item.kind, ['resource_domain', 'visible_cookie_count', 'policy_excerpt']) &&
      text(item.value, 500) && text(item.limitation, 500));
}

export function validAnalysis(value: unknown, hostname: string, policy: string, evidence: Evidence[]): value is AnalysisResponse {
  if (!record(value) || !keys(value, ['hostname', 'status', 'mode', 'summary', 'findings', 'limitations']) ||
      value.hostname !== hostname || !oneOf(value.status, ['ok', 'insufficient_data', 'unavailable']) ||
      !oneOf(value.mode, ['rules', 'llm', 'fixture']) || !text(value.summary) ||
      !strings(value.limitations) || !Array.isArray(value.findings) || value.findings.length > 100) return false;
  const ids = new Set(evidence.map((item) => item.id));
  return value.findings.every((item) => record(item) &&
    keys(item, ['title', 'explanation', 'severity', 'policy_quote', 'evidence_ids']) &&
    text(item.title) && text(item.explanation) && oneOf(item.severity, ['info', 'warning']) &&
    text(item.policy_quote, 20000) && policy.includes(item.policy_quote) &&
    strings(item.evidence_ids) && item.evidence_ids.every((id) => ids.has(id)));
}

export function validBreaches(value: unknown, hostname: string): value is BreachesResponse {
  if (!record(value) || !keys(value, ['hostname', 'matched_domain', 'status', 'count', 'breaches', 'checked_at', 'source', 'stale', 'attribution_url']) ||
      value.hostname !== hostname || !(value.matched_domain === null || text(value.matched_domain, 253)) ||
      !text(value.checked_at, 100) || !Number.isFinite(Date.parse(value.checked_at)) ||
      !oneOf(value.source, ['hibp', 'fixture']) || typeof value.stale !== 'boolean' ||
      !sourceUrl(value.attribution_url) || !Array.isArray(value.breaches) || value.breaches.length > 2000) return false;
  const count = value.breaches.length;
  if (!((value.status === 'ok' && count > 0 && value.count === count) ||
        (value.status === 'not_found' && count === 0 && value.count === 0) ||
        (value.status === 'unavailable' && count === 0 && value.count === null))) return false;
  return value.breaches.every((item) => record(item) &&
    keys(item, ['name', 'title', 'breach_date', 'data_classes', 'is_verified', 'source_url']) &&
    text(item.name) && text(item.title) && text(item.breach_date, 10) &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.breach_date) && Number.isFinite(Date.parse(item.breach_date)) &&
    strings(item.data_classes, 200) && typeof item.is_verified === 'boolean' && sourceUrl(item.source_url));
}
