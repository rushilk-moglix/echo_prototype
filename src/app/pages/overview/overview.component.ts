
/** Older call result words to the outcome words used everywhere else (PRD-ECHO-19). */
const RESULT_TO_OUTCOME: Record<string, string> = { conversation: 'completed', no_response: 'no_reply', disconnected_early: 'caller_hung_up', voicemail: 'voicemail', technical_drop: 'call_dropped' };
import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { FmtDurationPipe } from '../../pipes/fmt-duration.pipe';
import { GuideComponent } from '../../components/guide/guide.component';
import { HintComponent } from '../../components/hint/hint.component';
import { StatusReferenceComponent } from '../../components/status-reference/status-reference.component';
import { GROUPS, outcomeView as ov, statusHover } from '../../utils/status';
import { fmtNum, fmtSecs } from '../../utils/format';

/**
 * The dashboard: one funnel ribbon (dialled, reached, completed), one
 * bar of what happened, and the call log grouped by day. Each number says what
 * it is a share of, so nobody acts on a percentage they cannot check.
 */
@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    FmtDurationPipe,
    GuideComponent,
    HintComponent,
    StatusReferenceComponent,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Overview</h1>
        <div class="page-actions">
          @if (metrics()?.active_calls > 0) {
            <span class="pill live"><span class="dot live"></span>{{ metrics().active_calls }} on the line</span>
          }
          <div class="seg" role="group" aria-label="Period">
            @for (w of WINDOWS; track w.days) { <button [class.on]="days() === w.days" (click)="setDays(w.days)">{{ w.label }}</button> }
          </div>
        </div>
      </div>

      @if (error()) { <div class="note bad">{{ error() }}</div> }
      @if (!storage()) { <div class="note bad">Call history is not being saved right now. Live calls still work.</div> }

      <!-- The whole operation as one flow: each step says how many made it and what share of the step before. Click a step to see those calls. -->
      <div class="card ov-funnel">
        @for (s of funnel(); track s.key; let last = $last) {
          <div class="ov-step" [title]="s.help">
            <span class="ov-step-label"><app-icon [name]="s.icon" [size]="14"></app-icon> {{ s.label }} <app-hint [text]="s.help"></app-hint></span>
            <b class="ov-step-num">{{ s.value }}</b>
            <span class="ov-step-rate">{{ s.rate }}</span>
          </div>
          @if (!last) { <span class="ov-arrow" aria-hidden="true"><app-icon name="chevronRight" [size]="18"></app-icon></span> }
        }
        <div class="ov-side">
          <div><app-icon name="clock" [size]="13"></app-icon> Talk time <app-hint text="Time callers were connected to an agent."></app-hint><b>{{ fmtSecs(f().talk_seconds) }}</b></div>
          <div><app-icon name="repeat" [size]="13"></app-icon> Dials per contact <app-hint text="Average dials for each contact dialled, retries included."></app-hint><b>{{ f().attempts_per_call ?? 0 }}</b></div>
          <div><app-icon name="timer" [size]="13"></app-icon> Still in progress <app-hint text="Calls Waiting, Calling, On call or with a retry booked."></app-hint><b>{{ g()['in_progress'] || 0 }}</b></div>
        </div>
      </div>

      <div class="card ov-mix">
        <div class="ov-mix-head"><span class="card-title">Call status</span><app-guide topic="outcomes"></app-guide><span style="flex: 1"></span><app-status-reference></app-status-reference></div>
        <div class="progress" role="img" [attr.aria-label]="mixLabel()">
          @for (x of groups(); track x.key) { @if (x.count) { <span [class]="'g-' + x.key" [style.width.%]="x.count / (groupTotal() || 1) * 100" [title]="x.label + ': ' + x.count"></span> } }
        </div>
        <div class="legend">
          @for (o of topOutcomes(); track o.key) {
            <span class="ov-chip" [title]="hover(o.key)"><i [class]="'g-' + o.group"></i>{{ o.label }} <b>{{ o.count }}</b></span>
          }
        </div>
      </div>

      <div class="card" style="margin-top: 12px">
        <div class="filter-bar">
          <label class="search"><app-icon name="search" [size]="14"></app-icon><input class="input" type="search" placeholder="Search name or number" [ngModel]="search()" (ngModelChange)="onSearch($event)" aria-label="Search calls" /></label>
          <select class="select" [ngModel]="campaign()" (ngModelChange)="setFilter('campaign', $event)" aria-label="Campaign">
            <option value="">All campaigns</option>
            @for (c of campaigns(); track c.campaign_id) { <option [value]="c.campaign_id">{{ c.name }}</option> }
          </select>
          <select class="select" [ngModel]="range()" (ngModelChange)="setFilter('range', $event)" aria-label="When">
            @for (r of RANGES; track r.key) { <option [value]="r.key">{{ r.label }}</option> }
          </select>
          @if (filtered()) { <button class="btn btn-sm" (click)="clearFilters()"><app-icon name="close" [size]="12"></app-icon> Clear</button> }
          <span style="flex: 1"></span>
          <a class="icon-btn" [href]="api.callsReportUrl(query())" download [class.off]="!calls().length" title="Download these calls as a spreadsheet" aria-label="Download these calls"><app-icon name="table" [size]="16"></app-icon></a>
        </div>

        @if (calls().length === 0) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="phone" [size]="18"></app-icon></div>
            <div class="empty-title">{{ filtered() ? 'No calls match' : 'No calls yet' }}</div>
            <div class="empty-sub">{{ filtered() ? 'Clear the filters to see everything.' : 'Start a campaign, or try an agent in the call console.' }}</div>
          </div>
        } @else {
          @for (d of days_(); track d.label) {
            <div class="ov-day"><span>{{ d.label }}</span><span class="row-sub">{{ d.calls.length }} call{{ d.calls.length === 1 ? '' : 's' }}</span></div>
            @for (c of d.calls; track c.call_id) {
              <div class="ov-row" tabindex="0" (click)="openCall(c.call_id)" (keydown.enter)="openCall(c.call_id)" title="Open the call page">
                <span class="mono ov-time">{{ clock(c.started_at) }}</span>
                <span class="ov-who"><b>{{ c.contact_name || c.phone || 'Unknown' }}</b><span class="row-sub">{{ c.phone }} · {{ agentLabel(c.agent) }}</span></span>
                <span><span [class]="'tag ' + statusClass(c)">{{ statusLabel(c) }}</span></span>
                <span class="row-sub ov-sum" [title]="c.summary || ''">{{ c.summary || '' }}</span>
                <span class="mono ov-len">{{ c.duration_seconds | fmtDuration }}</span>
                <span class="ov-acts" (click)="$event.stopPropagation()">
                  <a class="icon-btn" [href]="api.callTranscriptUrl(c.call_id)" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
                  <a class="icon-btn" [href]="api.recordingUrls(c.call_id).download" download title="Download audio" aria-label="Download audio"><app-icon name="headphones" [size]="15"></app-icon></a>
                </span>
              </div>
            }
          }
          @if (total() > calls().length) { <div class="row-sub" style="padding: 10px 16px">Showing the latest {{ calls().length }} of {{ total() }}. Narrow the filters to find older calls.</div> }
        }
      </div>
    </div>
    `,
})
export class OverviewComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  private router = inject(Router);
  private intervalId: any = null;
  private searchTimer: any = null;

  /** Duration bands, in seconds. `max: 0` means "no upper bound". */
  readonly DURATIONS = [
    { key: '', label: 'Any length', min: 0, max: 0 },
    { key: 'short', label: 'Under 30s', min: 0, max: 30 },
    { key: 'mid', label: '30s – 2 min', min: 30, max: 120 },
    { key: 'long', label: 'Over 2 min', min: 120, max: 0 },
  ];

  readonly RANGES = [
    { key: '', label: 'All time', hours: 0 },
    { key: '1h', label: 'Last hour', hours: 1 },
    { key: '24h', label: 'Last 24 hours', hours: 24 },
    { key: '7d', label: 'Last 7 days', hours: 24 * 7 },
    { key: '30d', label: 'Last 30 days', hours: 24 * 30 },
  ];

  metrics = signal<any>(null);
  calls = signal<any[]>([]);
  campaigns = signal<any[]>([]);
  /** agent key -> its human label, for the Agent column. */
  agentLabels = signal<Record<string, string>>({});
  total = signal(0);
  storage = signal(true);
  error = signal('');
  /** call_id -> summary expanded in place. Survives the five-second poll. */
  expandedSummaries = signal<Record<string, boolean>>({});
  days = signal(30);
  readonly WINDOWS = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }];
  fmtSecs = fmtSecs;
  hover = statusHover;
  f = computed(() => this.metrics()?.funnel || {});
  g = computed<Record<string, number>>(() => this.f().by_group || {});
  groups = computed(() => GROUPS.map((x) => ({ ...x, count: this.g()[x.key] || 0 })));
  groupTotal = computed(() => this.groups().reduce((n, x) => n + x.count, 0));
  mixLabel = computed(() => this.groups().filter((x) => x.count).map((x) => `${x.label} ${x.count}`).join(', '));
  topOutcomes = computed(() => Object.entries(this.f().by_outcome || {}).map(([key, count]) => ({ ...ov(key), count: count as number }))
    .filter((o) => o.count).sort((a, b) => b.count - a.count).slice(0, 8));
  /** Dialled, reached, completed: each with its share of the step before. */
  funnel = computed(() => {
    const f = this.f(); const o = f.by_outcome || {};
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}% of ${b}` : 'nothing yet');
    const dialled = f.attempted || 0, reached = f.connected || 0, done = o.completed || 0;
    return [
      { key: 'dialled', icon: 'phoneOut', label: 'Dialled', value: fmtNum(dialled), rate: `${fmtNum(f.attempts || 0)} dials`, focus: '', help: 'Contacts dialled at least once in this period.' },
      { key: 'reached', icon: 'phone', label: 'Reached', value: fmtNum(reached), rate: pct(reached, dialled), focus: 'reached', help: 'Telephony status Answered on at least one dial.' },
      { key: 'completed', icon: 'message', label: 'Completed', value: fmtNum(done), rate: pct(done, reached), focus: 'completed', help: 'Call status Completed: caller spoke and the agent finished.' },
    ];
  });
  /** Calls in the log, grouped under Today, Yesterday or the date. */
  days_ = computed(() => {
    const out: { label: string; calls: any[] }[] = [];
    const key = (d: Date) => d.toDateString();
    const today = key(new Date()); const y = new Date(); y.setDate(y.getDate() - 1); const yest = key(y);
    for (const c of this.calls()) {
      const d = new Date(c.started_at); const k = key(d);
      const label = k === today ? 'Today' : k === yest ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      const last = out[out.length - 1];
      if (last?.label === label) last.calls.push(c); else out.push({ label, calls: [c] });
    }
    return out;
  });
  setDays(n: number): void { this.days.set(n); this.load(); }
  clock(ts: string): string { return ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }

  search = signal('');
  campaign = signal('');
  duration = signal('');
  range = signal('');

  filtered = computed(
    () => !!(this.search() || this.campaign() || this.duration() || this.range()),
  );

  /**
   * The filter as query params — one value driving both the table and the
   * report download, so the file can never contain a different set of rows
   * than the screen it was downloaded from.
   */
  query = computed<Record<string, string>>(() => {
    const params: Record<string, string> = {};
    if (this.search().trim()) params['q'] = this.search().trim();
    if (this.campaign()) params['campaign_id'] = this.campaign();
    const band = this.DURATIONS.find((d) => d.key === this.duration());
    if (band?.min) params['min_duration'] = String(band.min);
    if (band?.max) params['max_duration'] = String(band.max);
    const window = this.RANGES.find((r) => r.key === this.range());
    if (window?.hours) params['hours'] = String(window.hours);
    return params;
  });

  ngOnInit(): void {
    this.loadReference();
    this.load();
    this.intervalId = setInterval(() => this.load(), 5000);
  }

  ngOnDestroy(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Every call opens on its own page (no side panel). */
  openCall(id: string): void { this.router.navigate(['/calls', id]); }

  summaryOpen(id: string): boolean {
    return !!this.expandedSummaries()[id];
  }

  /**
   * Expand one summary in place.
   *
   * stopPropagation, or reading a summary also opens the call page.
   */
  toggleSummary(id: string, event: Event): void {
    event.stopPropagation();
    const open = { ...this.expandedSummaries() };
    if (open[id]) delete open[id];
    else open[id] = true;
    this.expandedSummaries.set(open);
  }

  /** Debounced: typing a ten-digit number should be one request, not ten. */
  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.load(), 350);
  }

  setFilter(which: 'campaign' | 'duration' | 'range', value: string): void {
    ({ campaign: this.campaign, duration: this.duration, range: this.range })[which].set(value);
    this.load();
  }

  clearFilters(): void {
    this.search.set('');
    this.campaign.set('');
    this.duration.set('');
    this.range.set('');
    this.load();
  }

  /** The agent's label, falling back to its key so a removed agent still shows. */
  agentLabel(key: string): string {
    return this.agentLabels()[key] || key || '—';
  }

  /** Says where a contact name came from, when it wasn't the call's own record. */
  contactTitle(call: any): string {
    if (!call.contact_name) return 'No contact recorded for this call';
    if (call.contact_name_matched_by === 'phone') {
      return `${call.contact_name} — matched by phone number from an uploaded list. This call was never linked to a campaign, so this is who owns the number, not a recorded result.`;
    }
    return call.contact_name;
  }

  /**
   * A call's state in one word.
   *
   * "Completed" on a call where nobody said anything is technically true and
   * practically a lie — the leg answered and no audio flowed either way, which
   * is the failure an operator is scanning this column for.
   */
  statusLabel(call: any): string {
    if (call.status === 'in_progress') return 'On the call';
    if ((call.num_turns ?? 0) === 0) return 'No audio';
    return ov(RESULT_TO_OUTCOME[this.result(call) || ''] || 'completed').label;
  }

  statusClass(call: any): string {
    if (call.status === 'in_progress') return 'info';
    if ((call.num_turns ?? 0) === 0) return 'bad';
    return ov(RESULT_TO_OUTCOME[this.result(call) || ''] || 'completed').cls;
  }

  /**
   * What happened on the call. Newer backends send call_result; for older ones it
   * is read from the summary the backend already writes ("Agent spoke, caller
   * never did", "Ended without a reported outcome"), so the log stops calling
   * every call "completed".
   */
  private result(call: any): string {
    if (call.call_result) return call.call_result;
    const s = String(call.summary || '');
    if (/^Agent spoke, caller never did/.test(s)) return 'no_response';
    if (/^Ended without a reported outcome/.test(s)) return 'disconnected_early';
    return 'conversation';
  }

  /**
   * The campaign filter's options and the agent labels, fetched once.
   *
   * Both are reference data that the five-second poll has no reason to re-read,
   * and both are conveniences — losing either must not blank the page.
   */
  private async loadReference(): Promise<void> {
    try {
      const out = await this.api.campaigns();
      this.campaigns.set(out.campaigns || []);
    } catch {
      this.campaigns.set([]);
    }
    try {
      const agents = await this.api.agents();
      this.agentLabels.set(
        Object.fromEntries((agents || []).map((a: any) => [a.key, a.label || a.key])),
      );
    } catch {
      this.agentLabels.set({});
    }
  }

  private async load(): Promise<void> {
    try {
      const [m, c] = await Promise.all([
        this.api.metrics(this.days()),
        this.api.calls({ limit: '50', ...this.query() }),
      ]);
      this.metrics.set(m);
      this.calls.set(c.calls || []);
      this.total.set(c.total ?? 0);
      this.storage.set(c.storage_connected);
      this.error.set('');
    } catch (e: any) {
      this.error.set(e.message);
    }
  }


}
