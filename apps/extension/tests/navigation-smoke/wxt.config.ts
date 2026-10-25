import { defineConfig } from 'wxt';

// Separate manual test extension. Never part of the production entrypoints.
// It exists because the production popup still gets its hostname from the demo
// controller (#5), so the opt-in card there shows demo.example until #6 wires the real
// one. This harness resolves the actual active tab, which is what the navigation
// scenario in docs/NAVIGATION.md needs.
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
