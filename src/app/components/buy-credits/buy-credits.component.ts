import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';
import { IconComponent } from '../icon/icon.component';

/** Buy a credit pack in two clicks: pick the pack, pick how to pay. */
@Component({
  selector: 'app-buy-credits',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <div class="modal bc" role="dialog" aria-label="Buy credits" (click)="$event.stopPropagation()">
        <div class="modal-head"><div class="modal-title">{{ done() ? 'Credits added' : 'Buy credits' }}</div>
          <button class="btn-icon" (click)="close()" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button></div>
        @if (done(); as d) {
          <div class="modal-body bc-done">
            <span class="bc-ok"><app-icon name="check" [size]="22"></app-icon></span>
            <b>{{ fmt(d) }} credits added</b>
            <span class="row-sub">Balance now {{ fmt(credits.balance()) }}. A receipt goes to the workspace admins.</span>
          </div>
          <div class="modal-foot"><span style="flex: 1"></span><button class="btn btn-primary" (click)="close()">Done</button></div>
        } @else {
          <div class="modal-body bc-body">
            @if (need) { <div class="note">This needs {{ fmt(need) }} credits; the workspace has {{ fmt(credits.balance()) }}.</div> }
            <div class="bc-packs" role="radiogroup" aria-label="Pack">
              @for (p of credits.wallet()?.packs || []; track p.key) {
                <button type="button" role="radio" [attr.aria-checked]="pack() === p.key" [class]="'bc-pack' + (pack() === p.key ? ' on' : '')" (click)="pack.set(p.key)">
                  <span class="bc-name">{{ p.label }} @if (p.best) { <span class="tag ok">Most picked</span> }</span>
                  <b class="mono">{{ fmt(p.credits + p.bonus) }}</b><span class="row-sub">credits{{ p.bonus ? ', ' + fmt(p.bonus) + ' free' : '' }}</span>
                  <span class="bc-price">₹{{ fmt(p.price) }}</span><span class="row-sub">{{ p.fits }}</span>
                </button>
              }
            </div>
            <div class="bc-pay">
              <span class="field-label">Pay by</span>
              <div class="seg" role="group" aria-label="Pay by">
                @for (m of methods; track m.key) { <button type="button" [class.on]="method() === m.key" (click)="method.set(m.key)">{{ m.label }}</button> }
              </div>
            </div>
            <span class="row-sub">Need more than 5,00,000 credits a month, or a yearly contract? <a class="link" href="https://vanikedge.ai/contact-us" target="_blank" rel="noopener">Talk to us</a> for a volume price.</span>
            @if (error()) { <div class="note bad">{{ error() }}</div> }
          </div>
          <div class="modal-foot">
            <span class="row-sub">Prices include GST; credits do not expire for 12 months.</span><span style="flex: 1"></span>
            <button class="btn btn-primary" (click)="buy()" [disabled]="busy() || !pack()">{{ busy() ? 'Paying…' : (method() === 'invoice' ? 'Send invoice' : 'Pay ₹' + fmt(chosen()?.price || 0)) }}</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .bc { max-width: 640px; width: calc(100vw - 32px); }
    .bc-body { display: grid; gap: 14px; }
    .bc-packs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .bc-pack { text-align: left; display: grid; gap: 2px; padding: 14px; border: 1px solid var(--ds-border); border-radius: 12px; background: var(--ds-surface); cursor: pointer; font: inherit; color: inherit; }
    .bc-pack.on { border-color: var(--ds-accent); box-shadow: inset 0 0 0 1px var(--ds-accent); background: var(--ds-accent-soft); }
    .bc-pack b { font-size: 22px; letter-spacing: -0.02em; margin-top: 6px; }
    .bc-name { display: flex; gap: 6px; align-items: center; font-weight: 600; }
    .bc-price { font-weight: 600; margin-top: 8px; }
    .bc-pay { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .bc-done { display: grid; justify-items: center; gap: 6px; text-align: center; padding: 26px 18px; }
    .bc-ok { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--ds-success-bg); color: var(--ds-success-fg); }
    @media (max-width: 560px) { .bc-packs { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class BuyCreditsComponent {
  @Input() need = 0;
  @Output() closed = new EventEmitter<void>();
  private api = inject(ApiService);
  private auth = inject(AuthService);
  credits = inject(CreditsService);
  fmt = fmtCredits;
  methods = [{ key: 'upi', label: 'UPI' }, { key: 'card', label: 'Card' }, { key: 'invoice', label: 'Invoice' }];
  pack = signal('growth');
  method = signal('upi');
  busy = signal(false);
  error = signal('');
  done = signal<number | null>(null);
  chosen() { return (this.credits.wallet()?.packs || []).find((p: any) => p.key === this.pack()); }
  async buy(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      const before = this.credits.balance();
      const w = await this.api.buyCredits(this.auth.currentOrgId(), this.pack(), this.method());
      this.credits.set(w); this.done.set(w.balance - before);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  close(): void { if (!this.busy()) this.closed.emit(); }
}
