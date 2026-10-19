import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';
import { IconComponent } from '../icon/icon.component';
import { BuyCreditsComponent } from '../buy-credits/buy-credits.component';

/** Rent a phone number with credits, ready to call from in a minute. */
@Component({
  selector: 'app-buy-number',
  standalone: true,
  imports: [IconComponent, BuyCreditsComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <div class="modal" style="max-width: 560px; width: calc(100vw - 32px)" role="dialog" aria-label="Get a phone number" (click)="$event.stopPropagation()">
        <div class="modal-head"><div class="modal-title">Get a phone number</div>
          <button class="btn-icon" (click)="close()" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button></div>
        <div class="modal-body" style="display: grid; gap: 12px">
          @if (done()) {
            <div class="note good">{{ done() }} is yours. Pick it as the line on any agent; it renews every month.</div>
          }
          <div class="seg" role="group" aria-label="Region">
            @for (r of regions(); track r) { <button type="button" [class.on]="region() === r" (click)="region.set(r)">{{ r }}</button> }
          </div>
          @if (!list().length) { <div class="row-sub">Loading numbers…</div> }
          <div class="bn-list">
            @for (n of shown(); track n.number) {
              <div class="bn-row">
                <span><b class="mono">{{ n.number }}</b><span class="row-sub">{{ n.region }} · {{ n.kind }}</span></span>
                <button class="btn btn-sm" (click)="buy(n.number)" [disabled]="!!busy()">{{ busy() === n.number ? 'Getting…' : fmt(n.credits) + ' credits a month' }}</button>
              </div>
            }
          </div>
          <span class="row-sub">Have numbers with Ozonetel, Exotel or another provider already? Add the provider in Settings, Telephony instead; no credits needed.</span>
          @if (error()) { <div class="note bad">{{ error() }} @if (short()) { <button class="link" (click)="buying.set(true)">Buy credits</button> }</div> }
        </div>
        <div class="modal-foot"><span style="flex: 1"></span><button class="btn" (click)="close()">Close</button></div>
      </div>
    </div>
    @if (buying()) { <app-buy-credits [need]="999" (closed)="buying.set(false)"></app-buy-credits> }
  `,
  styles: [`
    .bn-list { display: grid; gap: 6px; max-height: 320px; overflow: auto; }
    .bn-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--ds-border); border-radius: 10px; }
    .bn-row > span { display: grid; gap: 2px; }
  `],
})
export class BuyNumberComponent implements OnInit {
  @Output() closed = new EventEmitter<boolean>();
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private credits = inject(CreditsService);
  fmt = fmtCredits;
  list = signal<any[]>([]);
  region = signal('All');
  regions = computed(() => ['All', ...new Set(this.list().map((n) => n.region))]);
  shown = computed(() => this.list().filter((n) => this.region() === 'All' || n.region === this.region()));
  busy = signal('');
  error = signal('');
  short = signal(false);
  done = signal('');
  buying = signal(false);
  private bought = false;
  ngOnInit(): void { this.load(); }
  async load(): Promise<void> { try { this.list.set((await this.api.availableNumbers()).numbers || []); } catch (e: any) { this.error.set(e.message); } }
  async buy(number: string): Promise<void> {
    this.busy.set(number); this.error.set(''); this.short.set(false);
    try { this.credits.set(await this.api.buyNumber(this.auth.currentOrgId(), number)); this.done.set(number); this.bought = true; await this.load(); }
    catch (e: any) { this.error.set(e.message); this.short.set(/credits/i.test(e.message)); }
    finally { this.busy.set(''); }
  }
  close(): void { if (!this.busy()) this.closed.emit(this.bought); }
}
