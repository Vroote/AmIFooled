import { defineBackground } from 'wxt/utils/define-background';
import { parseApiBase } from '../lib/api-config';
import { registerBackgroundTransport } from '../lib/controller-background';

export default defineBackground(() => {
  registerBackgroundTransport(parseApiBase(import.meta.env.WXT_API_BASE_URL));
});
