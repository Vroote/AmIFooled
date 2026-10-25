import { defineConfig } from 'wxt';

// Separate manual test extension. Never included in the production entrypoints.
export default defineConfig({
  entrypointsDir: 'entrypoints',
  outDir: '../../.output/collector-smoke',
  manifestVersion: 3,
  manifest: { name: 'AmIFooled collector smoke', version: '0.0.0', permissions: ['activeTab', 'scripting'] },
});
