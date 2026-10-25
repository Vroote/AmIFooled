import { defineBackground } from 'wxt/utils/define-background';

import { registerNavigationChecks } from '../../../lib/navigation';
import { createFixtureBreachesCheck } from '../../../lib/navigation-fixture';

// Same registration as production: only the popup differs in this harness.
export default defineBackground(() => {
  registerNavigationChecks({ checkBreaches: createFixtureBreachesCheck() });
});
