import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';

/**
 * Follow ups: contacts that calling alone cannot settle. The number is blocked or wrong, the
 * contact declined, or every try was used. A person takes each one: who owns it, what they
 * said, a corrected number, then back to the agent or closed. Works for any agent and any file.
 */
@Component({
  selector: 'app-follow-ups',
  standalone: true,
  imports: [FormsModule, IconComponent, HintComponent, ConfirmComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Follow ups <app-hint text="Contacts the agent could not settle by calling. Each one needs a person: note what they said, fix the number, then call again or close it."></app-hint></h1>
        <div class="page-actions">
          <div class="seg" role="group" aria-label="Show">
            <button [class.on]="state() === 'open'" (click)="setState('open')">Open <span class="seg-n">{{ counts().open || 0 }}</span></button>
            <button [class.on]="state() === 'done'" (click)="setState('done')">Closed <span class="seg-n">{{ counts().done || 0 }}</span></button>
          </div>
        </div>
      </div>
      @if (error()) { <div class="note bad">{{ error() }}</div> }

      <div class="card">
        <div class="filter-bar">
          <label class="search"><app-icon name="search" [size]="14"></app-icon><input class="input" type="search" placeholder="Search name or number" [ngModel]="search()" (ngModelChange)="search.set($event)" aria-label="Search follow ups" /></label>
          <div class="fu-chips" role="group" aria-label="Why" style="display: flex; gap: 5px; flex-wrap: wrap">
            <button class="fu-chip" [class.on]="!reason()" (click)="reason.set('')">All</button>
            @for (r of reasonList(); track r.key) { <button class="fu-chip" [class.on]="reason() === r.key" (click)="reason.set(reason() === r.key ? '' : r.key)" [title]="r.help">{{ r.label }} <b>{{ r.count }}</b></button> }
          </div>
          <span style="flex: 1"></span>
          <select class="select" [ngModel]="owner()" (ngModelChange)="owner.set($event)" aria-label="Owner">
            <option value="">Any owner</option><option value="-">No owner yet</option>
            @for (o of owners(); track o.email) { <option [value]="o.email">{{ o.email }}</option> }
          </select>
        </div>

        @if (!shown().length) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="check" [size]="18"></app-icon></div>
            <div class="empty-title">{{ state() === 'open' ? (filtered() ? 'Nothing matches' : 'Nothing needs a person') : 'Nothing closed yet' }}</div>
            <div class="empty-sub">{{ state() === 'open' && !filtered() ? 'Contacts show up here when a number is blocked or wrong, a call is declined, or every try is used.' : '' }}</div>
          </div>
        } @else {
          <div class="fu-head"><span>Contact</span><span>Why <app-hint text="Blocked, Wrong number and Rejected are never retried. No more tries means every allowed try was used."></app-hint></span><span>Campaign</span><span>Owner</span><span>Last note</span><span></span></div>
          @for (r of shown(); track r.campaign_id + r.primary_id) {
            <div class="fu-row" [class.open]="isOpen(r)">
              <button class="fu-main" (click)="toggle(r)" [attr.aria-expanded]="isOpen(r)">
                <span class="fu-who"><b>{{ r.name || r.phone }}</b><span class="row-sub mono">{{ r.phone }}</span></span>
                <span><span class="tag" [class.bad]="r.reason !== 'no_more_tries'" [class.warn]="r.reason === 'no_more_tries'" [title]="telephony(r)">{{ r.reason_label }}</span><span class="row-sub fu-since">{{ r.dials }} dial{{ r.dials === 1 ? '' : 's' }} · {{ ago(r.since) }}</span></span>
                <span class="row-sub fu-camp" [title]="r.campaign_name">{{ r.campaign_name }}</span>
                <span class="fu-owner">{{ r.owner || 'No owner yet' }}</span>
                <span class="row-sub fu-note" [title]="lastNote(r)">{{ state() === 'done' ? r.closed_as : lastNote(r) || 'No notes yet' }}</span>
                <span class="fu-chev"><app-icon [name]="isOpen(r) ? 'chevronDown' : 'chevronRight'" [size]="15"></app-icon></span>
              </button>
              @if (isOpen(r)) {
                <div class="fu-detail">
                  <div class="fu-col">
                    <label class="field"><span class="field-label">Owner</span>
                      <select class="select" [ngModel]="r.owner" (ngModelChange)="patch(r, { owner: $event })" [disabled]="state() === 'done'">
                        <option value="">No owner yet</option>
                        @for (o of owners(); track o.email) { <option [value]="o.email">{{ o.email }}</option> }
                      </select>
                    </label>
                    <label class="field"><span class="field-label">Number <app-hint text="Correct the number here. The old number is kept in the notes."></app-hint></span>
                      <span class="fu-inline"><input class="input mono" [(ngModel)]="phone[key(r)]" [placeholder]="r.phone" inputmode="numeric" maxlength="13" [disabled]="state() === 'done'" /><button class="btn btn-sm" [disabled]="!validPhone(r)" (click)="savePhone(r)">Save</button></span>
                    </label>
                    <div class="fu-facts">
                      <span><span class="row-sub">Call status</span><b>{{ r.status }}</b></span>
                      <span><span class="row-sub">Telephony status</span><b class="mono">{{ telephony(r) || 'Not recorded' }}</b></span>
                      <span><span class="row-sub">Agent</span><b>{{ r.agent }}</b></span>
                    </div>
                  </div>
                  <div class="fu-col">
                    <span class="field-label">Notes</span>
                    <div class="fu-notes">
                      @for (n of r.notes; track n.at) { <div class="fu-n" [class.sys]="n.system"><span>{{ n.text }}</span><small>{{ n.by }} · {{ ago(n.at) }}</small></div> }
                      @if (!r.notes.length) { <div class="row-sub">Write what the contact said, so the next person does not ask again.</div> }
                    </div>
                    @if (state() === 'open') {
                      <span class="fu-inline"><input class="input" [(ngModel)]="note[key(r)]" placeholder="What did they say?" maxlength="500" (keydown.enter)="saveNote(r)" /><button class="btn btn-sm" [disabled]="!(note[key(r)] || '').trim()" (click)="saveNote(r)">Add note</button></span>
                    }
                  </div>
                  <div class="fu-acts">
                    <button class="btn btn-sm" (click)="openCampaign(r)"><app-icon name="external" [size]="13"></app-icon> Open the call</button>
                    <span style="flex: 1"></span>
                    @if (state() === 'open') {
                      <button class="btn btn-sm" (click)="closing.set(r)">Close, no call needed</button>
                      <button class="btn btn-sm btn-primary" (click)="callAgain(r)" [disabled]="busy() === key(r)" title="Send this contact back to the agent"><app-icon name="phoneOut" [size]="13"></app-icon> {{ busy() === key(r) ? 'Sending…' : 'Call again' }}</button>
                    } @else {
                      <button class="btn btn-sm" (click)="patch(r, { state: 'open' })">Reopen</button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
    @if (closing(); as r) {
      <app-confirm title="Close without calling again?" [body]="(r.name || r.phone) + ' will leave the open list. You can reopen it from Closed.'" confirmLabel="Close it" (confirm)="closeRow(r)" (cancel)="closing.set(null)"></app-confirm>
    }
  `,
})
export class FollowUpsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private timer: any = null;

  rows = signal<any[]>([]);
  counts = signal<any>({});
  reasons = signal<Record<string, { label: string; help: string }>>({});
  owners = signal<{ email: string }[]>([]);
  state = signal<'open' | 'done'>('open');
  search = signal(''); reason = signal(''); owner = signal('');
  expanded = signal<Record<string, boolean>>({});
  error = signal(''); busy = signal(''); closing = signal<any>(null);
  note: Record<string, string> = {}; phone: Record<string, string> = {};

  reasonList = computed(() => Object.entries(this.reasons()).map(([key, r]) => ({ key, ...r, count: this.counts().by_reason?.[key] || 0 })).filter((r) => this.state() === 'done' || r.count));
  filtered = computed(() => !!(this.search() || this.reason() || this.owner()));
  shown = computed(() => {
    const q = this.search().trim().toLowerCase(), why = this.reason(), who = this.owner();
    return this.rows().filter((r) => (!why || r.reason === why) && (!who || (who === '-' ? !r.owner : r.owner === who)) && (!q || [r.name, r.phone, r.campaign_name].some((v) => String(v || '').toLowerCase().includes(q))));
  });

  ngOnInit(): void { this.load(); this.timer = setInterval(() => this.load(), 8000); }
  ngOnDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async load(): Promise<void> {
    try { const out = await this.api.followUps(this.state()); this.rows.set(out.rows || []); this.counts.set(out.counts || {}); this.reasons.set(out.reasons || {}); this.owners.set(out.owners || []); this.error.set(''); }
    catch (e: any) { this.error.set(e.message); }
  }
  setState(s: 'open' | 'done'): void { this.state.set(s); this.expanded.set({}); this.load(); }
  key(r: any): string { return `${r.campaign_id}:${r.primary_id}`; }
  isOpen(r: any): boolean { return !!this.expanded()[this.key(r)]; }
  toggle(r: any): void { const k = this.key(r); this.expanded.set(this.expanded()[k] ? {} : { [k]: true }); }
  private me(): string { return this.auth.me()?.email || ''; }

  async patch(r: any, body: any): Promise<void> { try { await this.api.updateFollowUp(r.campaign_id, r.primary_id, { ...body, by: this.me() }); await this.load(); } catch (e: any) { this.error.set(e.message); } }
  async saveNote(r: any): Promise<void> { const text = (this.note[this.key(r)] || '').trim(); if (!text) return; this.note[this.key(r)] = ''; await this.patch(r, { note: text, ...(r.owner ? {} : { owner: this.me() }) }); }
  validPhone(r: any): boolean { const d = (this.phone[this.key(r)] || '').replace(/\D/g, ''); return d.length >= 10 && d.slice(-10) !== r.phone; }
  async savePhone(r: any): Promise<void> { const v = this.phone[this.key(r)]; this.phone[this.key(r)] = ''; await this.patch(r, { phone: v }); }
  async callAgain(r: any): Promise<void> {
    this.busy.set(this.key(r));
    try { await this.api.followUpCallAgain(r.campaign_id, r.primary_id, { by: this.me() }); await this.load(); } catch (e: any) { this.error.set(e.message); }
    this.busy.set('');
  }
  async closeRow(r: any): Promise<void> { this.closing.set(null); await this.patch(r, { state: 'done', closed_as: 'No call needed' }); }
  openCampaign(r: any): void { this.router.navigate(['/campaigns', r.campaign_id, 'contacts', r.primary_id]); }

  lastNote(r: any): string { return (r.notes || []).filter((n: any) => !n.system).slice(-1)[0]?.text || ''; }
  telephony(r: any): string { const t = r.telephony; return t ? [t.Status, t.CustomerStatus, t.DialStatus].filter(Boolean).join(' · ') : ''; }
  ago(iso: string): string { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
}
