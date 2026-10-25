import { defineConfig } from 'wxt';

// Add permissions only in the feature PR that uses them.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: {
    name: 'AmIFooled',
    description: 'Обещания сайта, наблюдаемые факты и известные утечки.',
  },
});
