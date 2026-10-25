import { defineBackground } from 'wxt/utils/define-background';

import { registerNavigationChecks } from '../lib/navigation';
import { createFixtureBreachesCheck } from '../lib/navigation-fixture';

export default defineBackground(() => {
  // Background transport belongs to #6: it replaces the fixture check with the real API
  // client without changing this call. Listeners are attached here, synchronously, so an
  // MV3 worker restart re-registers them; the per-site opt-in lives in
  // chrome.storage.local rather than in memory.
  registerNavigationChecks({ checkBreaches: createFixtureBreachesCheck() });
});
