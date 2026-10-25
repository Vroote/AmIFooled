import { defineBackground } from 'wxt/utils/define-background';

import { registerNavigationChecks } from '../../../lib/navigation';
import { createFixtureBreachesCheck } from '../../../lib/navigation-fixture';

// Same navigation module as production, with a deterministic provider instead of HTTP.
export default defineBackground(() => {
  registerNavigationChecks({ checkBreaches: createFixtureBreachesCheck() });
});
