/**
 * Default environment — used as-is by `ng serve` (development configuration).
 * Swapped for environment.prod.ts by the `production` configuration's
 * fileReplacements in angular.json, which `ng build` uses unless told
 * otherwise. Edit the hostnames here for local dev, environment.prod.ts for
 * what actually ships — never endpoints.ts directly, and never by commenting
 * lines in/out.
 */
export const environment = {
  production: false,
  demo: false,
  apiBase: 'http://localhost:8090',
  webrtcBase: 'http://localhost:8080',
};
