import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class HealthService implements OnDestroy {
  private api = inject(ApiService);
  private intervalId: any = null;

  readonly health = signal<any>(null);
  readonly todayMetrics = signal<any>(null);

  constructor() {
    this.poll();
    this.intervalId = setInterval(() => this.poll(), 15000);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async poll(): Promise<void> {
    const t0 = performance.now();
    try {
      const h = await this.api.health();
      this.health.set({ ...h, ms: Math.round(performance.now() - t0) });
    } catch {
      this.health.set(false);
    }
    try {
      this.todayMetrics.set(await this.api.metrics(1));
    } catch {
      this.todayMetrics.set(null);
    }
  }
}
