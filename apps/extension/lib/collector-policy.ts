export const POLICY_LIMIT = 20_000;

/** Public plain text only. This is data minimization, not a general PII detector. */
export function sanitizePolicyText(input: string): { text: string; truncated: boolean; redacted: boolean } {
  const normalized = input.normalize('NFC').replace(/\r\n?/g, '\n')
    // Strip invisible controls (except tab/newline), including bidi overrides.
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => char === '\n' || char === '\t' ? char : '');
  const sanitized = normalized
    .replace(/(?<![a-z\d+.-])(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>"']+/gi, (value) => {
      try {
        return new URL(value.startsWith('www.') ? `https://${value}` : value).hostname || '[URL скрыт]';
      } catch {
        return '[URL скрыт]';
      }
    })
    // Deliberately over-redact @ tokens, including quoted/Unicode email forms.
    // The boundary prevents quadratic backtracking on long text without @.
    .replace(/(?<!\S)\S*@\S*/gu, '[email скрыт]').trim();
  return {
    text: sanitized.slice(0, POLICY_LIMIT).replace(/[\uD800-\uDBFF]$/, '').trim(),
    truncated: sanitized.length > POLICY_LIMIT,
    redacted: normalized !== input || sanitized !== normalized.trim(),
  };
}
