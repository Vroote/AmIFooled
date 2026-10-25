import { defineConfig } from 'wxt';
import { apiHostPermission, parseApiBase } from './lib/api-config';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: () => ({
    name: 'AmIFooled',
    description: 'Обещания сайта, наблюдаемые факты и известные утечки.',
    // storage keeps the per-site opt-in across MV3 worker restarts.
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: [apiHostPermission(parseApiBase(import.meta.env.WXT_API_BASE_URL))],
    // Declaring origins only makes them requestable at runtime; it grants nothing.
    // The user grants one site from an explicit click and revokes it from the same card.
    optional_host_permissions: ['*://*/*'],
  }),
});
