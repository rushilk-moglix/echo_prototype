/**
 * Public demo build (`npm run build:demo`): no backend. A service worker
 * (mock/browser/sw.mjs) answers every API call with the local mock, in the
 * browser, under the app's own path.
 */
// One file opened from disk has no address of its own: calls go to a made up origin the page answers itself.
const base = (globalThis as any).__SINGLE_FILE__ ? 'https://echo.local/__mock/' : new URL('./__mock/', document.baseURI).href;

export const environment = {
  production: true,
  demo: true,
  apiBase: base + 'api',
  webrtcBase: base + 'rtc',
};
