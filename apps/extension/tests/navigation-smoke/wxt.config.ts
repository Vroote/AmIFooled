import { defineConfig } from 'wxt';

// Separate manual test extension. Never part of the production entrypoints.
// The harness resolves the actual active tab and supplies deterministic fixture counts
// so the scenario in docs/NAVIGATION.md can run without a backend or external API.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  entrypointsDir: 'entrypoints',
  outDir: '../../.output/navigation-smoke',
  manifestVersion: 3,
  manifest: {
    name: 'AmIFooled navigation smoke',
    version: '0.0.0',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['*://*/*'],
  },
});
