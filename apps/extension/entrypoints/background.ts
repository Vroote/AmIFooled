import { defineBackground } from 'wxt/utils/define-background';
import { requestApi } from '../lib/api-client';
import { parseApiBase } from '../lib/api-config';
import { registerBackgroundTransport } from '../lib/controller-background';
import { registerNavigationChecks } from '../lib/navigation';

export default defineBackground(() => {
  const apiBase = parseApiBase(import.meta.env.WXT_API_BASE_URL);
  registerBackgroundTransport(apiBase);
  // Both listeners register synchronously when the MV3 worker starts. Navigation
  // checks share the real API client, but send only an explicitly enabled hostname.
  registerNavigationChecks({
    checkBreaches: (hostname, signal) => requestApi('breaches', { hostname }, signal, apiBase),
  });
});
