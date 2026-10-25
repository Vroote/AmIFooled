import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'AmIFooled',
    description: 'Обещания сайта, наблюдаемые факты и известные утечки.',
    permissions: ['activeTab', 'scripting'],
  },
});
