import { defineConfig } from 'wxt';
import { apiHostPermission, parseApiBase } from './lib/api-config';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: () => ({
    name: 'AmIFooled',
    description: 'Обещания сайта, наблюдаемые факты и известные утечки.',
    permissions: ['activeTab', 'scripting'],
    host_permissions: [apiHostPermission(parseApiBase(import.meta.env.WXT_API_BASE_URL))],
  }),
});
