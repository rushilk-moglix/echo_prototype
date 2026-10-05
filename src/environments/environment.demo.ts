/**
 * Public demo build (`npm run build:demo`): no backend. A service worker
 * (mock/browser/sw.mjs) answers every API call with the local mock, in the
 * browser, under the app's own path.
 */
const base = new URL('./__mock/', document.baseURI).href;

export const environment = {
  production: true,
  demo: true,
  apiBase: base + 'api',
  webrtcBase: base + 'rtc',
};
