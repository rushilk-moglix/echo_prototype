import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // From a file on disk only # addresses work; on a web server the normal addresses stay.
    provideRouter(routes, ...((globalThis as any).__SINGLE_FILE__ ? [withHashLocation()] : [])),
    provideHttpClient()
  ]
};
