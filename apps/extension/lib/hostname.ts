/**
 * One hostname normalizer for the whole extension.
 *
 * It lives apart from the collector so that modules needing only this check — the
 * navigation badge and its opt-in — do not pull the bundled public suffix list into the
 * popup and the background worker. Registrable-domain comparison still belongs to the
 * collector, which is where `tldts` is actually used.
 *
 * The accepted shape matches the `Hostname` contract in `apps/api/app/models.py`, so a
 * value accepted here is a value the API will also accept.
 */

export function normalizeHostname(hostname: string): string | null {
  // Reject URL syntax before parsing so credentials/path cannot become a hostname.
  if (!hostname || /[\s/@:#?\\]/u.test(hostname)) return null;
  try {
    const value = new URL(`https://${hostname}`).hostname.toLowerCase().replace(/\.$/, '');
    if (value.length > 253 || !value.split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
    return value;
  } catch { return null; }
}
