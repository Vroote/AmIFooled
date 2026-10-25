export const DEFAULT_API_BASE = 'http://127.0.0.1:8000';

export function parseApiBase(value: string = DEFAULT_API_BASE): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash || url.hostname.includes('*')) {
    throw new Error('API base must be HTTPS, or HTTP on loopback, without credentials/query/fragment');
  }
  return url.href.replace(/\/$/, '');
}

export function apiHostPermission(base: string): string {
  const url = new URL(parseApiBase(base));
  return `${url.protocol}//${url.hostname}/*`;
}
