import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/**
 * The workspace's credit wallet, shared by every page: the side bar shows the
 * balance, buttons show what an action costs, and anything that spends refreshes it.
 */
@Injectable({ providedIn: 'root' })
export class CreditsService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  readonly wallet = signal<any>(null);
  readonly balance = computed(() => this.wallet()?.balance ?? 0);
  readonly low = computed(() => !!this.wallet()?.low);
  /** Credits for one priced thing, from the server's price list. */
  price(key: string): number { return this.wallet()?.prices?.find((p: any) => p.key === key)?.credits ?? 0; }
  async refresh(): Promise<any> {
    const org = this.auth.currentOrgId(); if (!org) return null;
    try { const w = await this.api.credits(org); this.wallet.set(w); return w; } catch { return null; }
  }
  set(w: any): void { if (w && typeof w.balance === 'number') this.wallet.set(w); }
}

/** 12,345 in Indian grouping, the way the team reads money. */
export const fmtCredits = (n: number | null | undefined): string => Math.round(n || 0).toLocaleString('en-IN');
