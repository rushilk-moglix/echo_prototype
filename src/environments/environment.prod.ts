/**
 * Swapped in for environment.ts by the `production` configuration's
 * fileReplacements (angular.json) — this is what `npm run build` (which
 * defaults to the production configuration) actually ships. Edit the
 * hostnames here when the deployed backend moves; nothing else needs
 * touching.
 */
export const environment = {
  production: true,
  demo: false,
  apiBase: 'https://api.example.com',
  webrtcBase: 'https://voice.example.com',
};
