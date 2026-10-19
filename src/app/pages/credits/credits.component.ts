import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { EchoLoaderComponent } from '../../components/echo-mark/echo-mark.component';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';
import { BuyCreditsComponent } from '../../components/buy-credits/buy-credits.component';
import { RequestWorkComponent } from '../../components/request-work/request-work.component';
import { BuyNumberComponent } from '../../components/buy-number/buy-number.component';
import { fmtAgo } from '../../utils/format';

const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Waiting for a quote', cls: 'info' }, quoted: { label: 'Quote ready', cls: 'warn' }, accepted: { label: 'Accepted', cls: 'busy' },
  in_progress: { label: 'Being built', cls: 'busy' }, delivered: { label: 'Delivered', cls: 'ok' }, cancelled: { label: 'Cancelled', cls: 'muted' }, declined: { label: 'Declined', cls: 'muted' },
};

/**
 * Credits: one balance for everything Echo charges. Answers the three questions a
 * workspace owner has: how much is left, what is using it, and what each thing costs.
 */
@Component({
  selector: 'app-credits',
  standalone: true,
  imports: [EchoLoaderComponent, FormsModule, RouterLink, IconComponent, HintComponent, BuyCreditsComponent, RequestWorkComponent, BuyNumberComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Credits</h1>
        <div class="page-actions">
          @if (auth.canAdmin()) {
            <button class="btn" (click)="requesting.set(true)"><app-icon name="wrench" [size]="14"></app-icon> Request work from our team</button>
            <button class="btn btn-primary" (click)="buying.set(true)"><app-icon name="plus" [size]="14"></app-icon> Buy credits</button>
          }
        </div>
      </div>
      @if (error()) { <div class="note bad">{{ error() }}</div> }

      @if (w(); as w) {
        <div class="cr-top">
          <div class="card cr-bal" [class.low]="w.low">
            <span class="label-k">Balance <app-hint text="One credit is about one rupee. Everything Echo charges for comes out of this balance."></app-hint></span>
            <b class="cr-big mono">{{ fmt(w.balance) }}</b>
            <span class="row-sub">About {{ fmt(w.balance / line()) }} answered lines at {{ line() }} credits a line</span>
            @if (w.low) { <div class="note bad" style="margin: 6px 0 0">Running low. Calls stop when the balance reaches zero. @if (auth.canAdmin()) { <button class="link" (click)="buying.set(true)">Buy credits</button> } @else { Ask a workspace admin to top up. }</div> }
            @if (w.held) { <span class="row-sub">{{ fmt(w.held) }} credits set aside for work in progress</span> }
            <label class="cr-auto">
              <span class="switch"><input type="checkbox" [checked]="w.auto_topup?.on" [disabled]="!auth.canAdmin()" (change)="setAuto($any($event.target).checked)" aria-label="Top up on its own" /><i></i></span>
              <span>Top up on its own with a {{ packLabel(w.auto_topup?.pack) }} pack when the balance falls under {{ fmt(w.auto_topup?.below) }}</span>
            </label>
          </div>
          <div class="card cr-use">
            <div class="card-head"><span class="card-title"><app-icon name="activity" [size]="14"></app-icon> Used in the last 30 days</span><b class="mono">{{ fmt(usedTotal()) }}</b></div>
            <div class="card-body cr-bars">
              @for (u of usage(); track u.group) {
                <div class="cr-bar"><span>{{ u.group }}</span><i><i [style.width.%]="u.pc"></i></i><b class="mono">{{ fmt(u.credits) }}</b></div>
              }
              @if (!usage().length) { <span class="row-sub">Nothing used yet.</span> }
            </div>
          </div>
        </div>

        <div class="cr-grid">
          <section class="card">
            <div class="card-head"><span class="card-title"><app-icon name="coins" [size]="14"></app-icon> What credits pay for</span><span class="row-sub">Draft prices</span></div>
            <div class="cr-prices">
              @for (p of w.prices; track p.key) {
                <div class="cr-price" [title]="p.note">
                  <span><b>{{ p.label }}</b><small>{{ p.note }}</small></span>
                  <span class="mono">{{ p.credits ? (p.unit === 'from' ? 'from ' : '') + fmt(p.credits) : 'Free' }}<small>{{ p.unit === 'from' ? '' : p.unit }}</small></span>
                </div>
              }
            </div>
          </section>

          <section class="card">
            <div class="card-head"><span class="card-title"><app-icon name="wrench" [size]="14"></app-icon> Requests to our team</span>
              @if (auth.canAdmin()) { <button class="btn btn-sm" (click)="requesting.set(true)">New request</button> }</div>
            @if (!w.requests.length) { <div class="card-body row-sub">No requests yet. Ask for an agent or an integration and we quote within a working day.</div> }
            @for (r of w.requests; track r.id) {
              <div class="cr-req">
                <div class="cr-req-top">
                  <span style="min-width: 0"><b>{{ r.title }}</b><small class="row-sub">{{ r.kind === 'custom_agent' ? 'Agent' : 'Integration' }} · {{ ago(r.created_at) }} · {{ r.by }}</small></span>
                  <span [class]="'tag ' + st(r.status).cls">{{ st(r.status).label }}</span>
                </div>
                @if (r.quote) { <div class="row-sub">Quote <b class="mono">{{ fmt(r.quote) }}</b> credits{{ r.eta ? ', about ' + r.eta : '' }} · deposit {{ fmt(r.deposit) }} already paid</div> }
                <details class="cr-log"><summary class="row-sub">{{ r.updates.length }} update{{ r.updates.length === 1 ? '' : 's' }}</summary>
                  @for (u of r.updates; track $index) { <div class="row-sub"><span class="mono">{{ ago(u.at) }}</span> · {{ u.by }}: {{ u.text }}</div> }
                </details>
                <div class="cr-req-acts">
                  @if (r.status === 'quoted' && auth.canAdmin()) { <button class="btn btn-sm btn-primary" (click)="accept(r)" [disabled]="busy() === r.id">Accept quote · {{ fmt(r.quote - r.deposit) }} more credits</button> }
                  @if ((r.status === 'submitted' || r.status === 'quoted') && auth.canAdmin()) { <button class="btn btn-sm btn-ghost" (click)="cancel(r)" [disabled]="busy() === r.id">Cancel and get the deposit back</button> }
                  @if (staff() && r.status === 'submitted') {
                    <span class="cr-staff">Vanik team:
                      <input class="input input-sm" type="number" min="0" step="1000" [ngModel]="quote()[r.id] || ''" (ngModelChange)="setQuote(r.id, $event)" placeholder="Quote in credits" aria-label="Quote in credits" />
                      <button class="btn btn-sm" (click)="sendQuote(r)" [disabled]="!quote()[r.id]">Send quote</button></span>
                  }
                  @if (staff() && r.status === 'in_progress') { <button class="btn btn-sm" (click)="deliver(r)">Vanik team: mark delivered</button> }
                </div>
              </div>
            }
          </section>

          <section class="card">
            <div class="card-head"><span class="card-title"><app-icon name="sim" [size]="14"></app-icon> Phone numbers</span>
              @if (auth.canAdmin()) { <button class="btn btn-sm" (click)="numbering.set(true)">Get a number</button> }</div>
            @for (n of w.numbers; track n.number) {
              <div class="cr-line"><span><b class="mono">{{ n.number }}</b><small class="row-sub">{{ n.region }} · {{ n.kind }}{{ n.flow ? ' · ' + n.flow : '' }}</small></span><span class="row-sub">Renews {{ day(n.renews) }} · {{ fmt(price('number')) }} credits</span></div>
            }
            <div class="card-body row-sub" style="padding-top: 8px">Numbers from your own telephony provider are in <a class="link" routerLink="/settings">Settings, Telephony</a> and cost no credits.</div>
          </section>

          <section class="card cr-hist">
            <div class="card-head"><span class="card-title"><app-icon name="list" [size]="14"></app-icon> History</span>
              <div class="seg" role="group" aria-label="Show">@for (f of filters; track f) { <button [class.on]="filter() === f" (click)="filter.set(f)">{{ f }}</button> }</div></div>
            <div class="scroll-x"><div style="min-width: 560px">
              @for (e of ledger(); track e.id) {
                <div class="cr-entry">
                  <span class="mono row-sub">{{ day(e.at) }}</span>
                  <span style="min-width: 0"><span class="ellipsis" [title]="e.label">{{ e.label }}</span><small class="row-sub">{{ e.group }} · {{ e.by }}{{ e.note ? ' · ' + e.note : '' }}</small></span>
                  <b [class]="'mono ' + (e.credits > 0 ? 'cr-plus' : '')">{{ e.credits > 0 ? '+' : '' }}{{ fmt(e.credits) }}</b>
                </div>
              }
              @if (!ledger().length) { <div class="card-body row-sub">Nothing here yet.</div> }
            </div></div>
          </section>
        </div>
      } @else if (!error()) { <app-echo-loader label="Loading credits"></app-echo-loader> }
    </div>

    @if (buying()) { <app-buy-credits (closed)="buying.set(false)"></app-buy-credits> }
    @if (requesting()) { <app-request-work (closed)="requesting.set(false); load()"></app-request-work> }
    @if (numbering()) { <app-buy-number (closed)="numbering.set(false); load()"></app-buy-number> }
    @if (toast()) { <div class="toast" role="status">{{ toast() }}</div> }
  `,
  styles: [`
    .cr-top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px; }
    .cr-bal { padding: 18px; display: grid; gap: 4px; align-content: start; }
    .cr-bal.low .cr-big { color: var(--red); }
    .label-k { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ds-text-muted); display: flex; gap: 6px; align-items: center; }
    .cr-big { font-size: 40px; letter-spacing: -0.03em; line-height: 1.1; }
    .cr-auto { display: flex; gap: 10px; align-items: center; margin-top: 10px; font-size: 13px; color: var(--ds-text-muted); }
    .cr-bars { display: grid; gap: 10px; }
    .cr-bar { display: grid; grid-template-columns: 110px minmax(0, 1fr) 80px; gap: 10px; align-items: center; font-size: 13px; }
    .cr-bar > i { height: 8px; border-radius: 4px; background: var(--ds-surface-sunken); overflow: hidden; display: block; }
    .cr-bar > i > i { display: block; height: 100%; background: var(--ds-accent); border-radius: 4px; }
    .cr-bar b { text-align: right; font-weight: 500; }
    .cr-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .cr-hist { grid-column: 1 / -1; }
    .cr-prices { display: grid; }
    .cr-price, .cr-line, .cr-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid var(--ds-border); font-size: 13px; }
    .cr-price small, .cr-line small, .cr-entry small, .cr-req small { display: block; color: var(--ds-text-muted); font-size: 12px; }
    .cr-price .mono { text-align: right; } .cr-price .mono small { font-family: var(--sans, inherit); }
    .cr-entry { grid-template-columns: 90px minmax(0, 1fr) 100px; }
    .cr-entry b { text-align: right; font-weight: 500; } .cr-plus { color: var(--ds-success-fg); }
    .cr-req { padding: 12px 16px; border-top: 1px solid var(--ds-border); display: grid; gap: 6px; }
    .cr-req-top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .cr-req-acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .cr-log summary { cursor: pointer; }
    .cr-staff { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--ds-text-muted); padding: 4px 8px; border: 1px dashed var(--ds-border); border-radius: 8px; }
    .cr-staff .input { width: 140px; }
    @media (max-width: 980px) { .cr-top, .cr-grid { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class CreditsComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);
  private credits = inject(CreditsService);
  fmt = fmtCredits;
  ago = fmtAgo;
  w = this.credits.wallet;
  error = signal('');
  toast = signal('');
  busy = signal('');
  buying = signal(false);
  requesting = signal(false);
  numbering = signal(false);
  quote = signal<Record<string, number>>({});
  filters = ['All', 'Spent', 'Added'];
  filter = signal('All');
  /** Platform admins stand in for the Vanik team on requests. */
  staff = computed(() => !!this.auth.me()?.platform_admin);
  line = () => this.credits.price('answered_line') || 9;
  price = (k: string) => this.credits.price(k);
  st = (s: string) => STATUS[s] || { label: s, cls: 'muted' };
  day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  packLabel = (k: string) => this.w()?.packs?.find((p: any) => p.key === k)?.label || 'Growth';
  usage = computed(() => {
    const u = Object.entries(this.w()?.usage_30d || {}) as [string, number][];
    const max = Math.max(1, ...u.map(([, v]) => v));
    return u.sort((a, b) => b[1] - a[1]).map(([group, credits]) => ({ group, credits, pc: (credits / max) * 100 }));
  });
  usedTotal = computed(() => this.usage().reduce((n, u) => n + u.credits, 0));
  ledger = computed(() => (this.w()?.ledger || []).filter((e: any) => this.filter() === 'All' || (this.filter() === 'Added' ? e.credits > 0 : e.credits < 0)));
  ngOnInit(): void { this.load(); }
  async load(): Promise<void> { const w = await this.credits.refresh(); if (!w) this.error.set('Credits could not be loaded. Try again in a minute.'); }
  setQuote(id: string, v: any): void { this.quote.update((q) => ({ ...q, [id]: Number(v) || 0 })); }
  private async run(id: string, fn: () => Promise<any>, msg: string): Promise<void> {
    this.busy.set(id); this.error.set('');
    try { this.credits.set(await fn()); this.say(msg); } catch (e: any) { this.error.set(e.message); } finally { this.busy.set(''); }
  }
  accept(r: any) { return this.run(r.id, () => this.api.acceptRequest(this.auth.currentOrgId(), r.id), `Quote accepted. The team starts on ${r.title}.`); }
  cancel(r: any) { return this.run(r.id, () => this.api.cancelRequest(this.auth.currentOrgId(), r.id), 'Request cancelled; the deposit is back in your balance.'); }
  sendQuote(r: any) { return this.run(r.id, () => this.api.updateRequest(this.auth.currentOrgId(), r.id, { quote: this.quote()[r.id], eta: '2 weeks' }), 'Quote sent.'); }
  deliver(r: any) { return this.run(r.id, () => this.api.updateRequest(this.auth.currentOrgId(), r.id, { status: 'delivered' }), 'Marked delivered.'); }
  async setAuto(on: boolean): Promise<void> {
    const a = this.w()?.auto_topup || {};
    try { this.credits.set(await this.api.setAutoTopup(this.auth.currentOrgId(), { on, pack: a.pack || 'growth', below: a.below || 10000 })); this.say(on ? 'Auto top up is on.' : 'Auto top up is off.'); }
    catch (e: any) { this.error.set(e.message); }
  }
  private say(m: string): void { this.toast.set(m); setTimeout(() => this.toast.set(''), 3000); }
}
