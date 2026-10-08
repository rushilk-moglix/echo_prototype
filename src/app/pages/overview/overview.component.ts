
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
import { ReportShareComponent } from '../../components/report-share/report-share.component';
import { AuthService } from '../../services/auth.service';

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
    ReportShareComponent,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Overview</h1>
        <div class="page-actions">
          @if (metrics()?.active_calls > 0) {
            <span class="pill live"><span class="dot live"></span>{{ metrics().active_calls }} on the line</span>
          }
          <select class="select ov-agent" [class.on]="!!agent()" [ngModel]="agent()" (ngModelChange)="setAgent($event)" aria-label="Agent" title="Pick one agent to see its own answers">
            <option value="">All agents</option>
            @for (a of agents(); track a.key) { <option [value]="a.key">{{ a.label }}</option> }
          </select>
          <div class="seg" role="group" aria-label="Period">
            @for (w of WINDOWS; track w.days) { <button [class.on]="days() === w.days" (click)="setDays(w.days)">{{ w.label }}</button> }
          </div>
          <app-report-share [summary]="report()" [days]="days()" [by]="by()" [byLabel]="byLabel()" [workspace]="workspace()" [period]="period() + (agent() ? ' · ' + agentName() : '')" [agent]="agent()" [agents]="agents()"></app-report-share>
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



      <!-- Input and why calls did not finish: two layers every agent has, built from field types and one fixed reason list. -->
      <div class="ly-two">
        @if (input(); as inp) {
          <div class="card">
            <div class="rp-head"><span class="card-title">Input</span><app-hint text="Every uploaded row is checked against the agent's own input fields: required, number, date, phone and choice. Rejected rows are never called. Warnings are called, and are worth fixing in the source file."></app-hint></div>
            <div class="ly-nums">
              <span>Rows uploaded<b>{{ inp.rows }}</b></span><span [class.bad]="inp.rejected">Rejected<b>{{ inp.rejected }}</b></span><span [class.warn]="inp.warned">With warnings<b>{{ inp.warned }}</b></span><span>Clean<b>{{ inp.clean }}</b></span>
            </div>
            @if (inp.problems.length) {
              <div class="ly-list">
                @for (p of inp.problems; track p.label + p.field) { <div class="ly-row"><span class="ly-kind" [class]="'ly-kind ' + p.kind">{{ p.kind === 'reject' ? 'Rejected' : 'Warning' }}</span><span class="ly-what" [title]="p.label">{{ p.label }}@if (p.field) { <small>{{ p.field }}</small> }</span><b>{{ p.rows }}</b></div> }
              </div>
            } @else { <div class="ly-ok">Every row passed the checks.</div> }
          </div>
        }
        @if (why()?.reasons?.length) {
          <div class="card">
            <div class="rp-head"><span class="card-title">Picked up, not completed</span><app-hint text="Why a call that was picked up did not finish. The same short list for every agent, recorded on the call."></app-hint><span style="flex: 1"></span><span class="row-sub">{{ why().base }} calls</span></div>
            <div class="ly-why">
              @for (r of why().reasons; track r.key) { <div class="an-row"><span class="an-v">{{ r.label }}</span><span class="an-bar"><i [style.width.%]="pc(r.count, why().base)"></i></span><b>{{ r.count }}</b></div> }
            </div>
            @if (rowsLine(); as rl) {
              <div class="ly-nums" style="border-top: 1px solid var(--ds-border); border-bottom: 0" title="For agents that cover several rows on one call.">
                <span>Rows uploaded<b>{{ rl.uploaded }}</b></span><span>On reached calls<b>{{ rl.on_reached }}</b></span><span>Covered<b>{{ rl.covered }}</b></span><span [class.warn]="rl.not_covered">Not covered<b>{{ rl.not_covered }}</b></span>
              </div>
            }
          </div>
        } @else if (rowsLine(); as rl) {
          <div class="card">
            <div class="rp-head"><span class="card-title">Rows</span><app-hint text="For agents that cover several rows on one call: how many uploaded rows were actually covered."></app-hint></div>
            <div class="ly-nums" style="border-bottom: 0"><span>Rows uploaded<b>{{ rl.uploaded }}</b></span><span>On reached calls<b>{{ rl.on_reached }}</b></span><span>Covered<b>{{ rl.covered }}</b></span><span [class.warn]="rl.not_covered">Not covered<b>{{ rl.not_covered }}</b></span></div>
          </div>
        }
      </div>

      <!-- Answers: only when one agent is chosen, built from that agent's own answer fields. -->
      @if (agent()) {
        <div class="card rp-compare">
          <div class="rp-head"><span class="card-title">Answers</span><app-hint text="What this agent recorded on its calls, taken from its own answer fields. Choices and yes or no answers are counted, numbers are added up, and free text stays in the results file."></app-hint><span style="flex: 1"></span><span class="row-sub">{{ agentName() }}</span></div>
          @if (answers().length) {
            <div class="an-grid">
              @for (a of answers(); track a.key) {
                <div class="an-item">
                  <div class="an-k"><span>{{ a.label }}</span><small>{{ a.answered }} {{ a.unit }}</small></div>
                  @if (a.type === 'number') { <div class="an-num"><b>{{ a.sum }}</b> in total <span>· {{ a.avg }} on average</span></div> }
                  @else { @for (v of a.values; track v.value) { <div class="an-row"><span class="an-v" [title]="v.value">{{ pretty(v.value) }}</span><span class="an-bar"><i [style.width.%]="pc(v.count, a.answered)"></i></span><b>{{ v.count }}</b></div> } }
                </div>
              }
            </div>
          } @else { <div class="an-none">No answers to summarise in this period. Choices, yes or no answers and numbers show here once calls complete.</div> }
        </div>
      }

      <!-- The same numbers split by campaign, agent, day or any column of the uploaded files. -->
      <div class="card rp-compare">
        <div class="rp-head">
          <span class="card-title">Compare</span><app-hint text="The same numbers split by campaign, agent or day. If your uploaded files have a column whose values repeat, you can split by that too. Pick an agent to see its own answers."></app-hint>
          <span style="flex: 1"></span>
          <div class="seg" role="group" aria-label="Compare by">
            @for (b of bys(); track b.key) { <button [class.on]="by() === b.key" (click)="setBy(b.key)">{{ b.label }}</button> }
          </div>
          @if (columns().length) {
            <select class="select rp-col" [class.on]="isColumn()" [ngModel]="isColumn() ? by() : ''" (ngModelChange)="setBy($event || 'campaign')" aria-label="Compare by a column of your file">
              <option value="">A column of your file</option>
              @for (c of columns(); track c.key) { <option [value]="c.key">{{ c.label }}</option> }
            </select>
          }
        </div>
        @if (!reportRows().length) {
          <div class="empty" style="padding: 22px"><div class="empty-sub">Nothing to compare in this period yet.</div></div>
        } @else {
          <div class="rp-table" role="table" [attr.aria-label]="'Compared by ' + byLabel()">
            <div class="rp-tr rp-th" role="row"><span role="columnheader">{{ byLabel() }}</span><span role="columnheader">Dialled</span><span role="columnheader">Reached <app-hint text="Share of contacts dialled."></app-hint></span><span role="columnheader">Completed <app-hint text="Share of contacts reached."></app-hint></span><span role="columnheader">Not reached</span><span role="columnheader">Failed</span><span role="columnheader">Follow up <app-hint text="Contacts calling cannot settle: blocked, wrong number, declined, or every try used."></app-hint></span></div>
            @for (r of reportRows(); track r.key) {
              <div class="rp-tr" role="row" [class.rp-pick]="by() === 'agent'" [attr.tabindex]="by() === 'agent' ? 0 : null" [attr.title]="by() === 'agent' ? 'See this agent and its answers' : null" (click)="pickRow(r)" (keydown.enter)="pickRow(r)">
                <span class="rp-name" role="cell" [title]="r.label">{{ rowLabel(r) }}</span>
                <span class="mono" role="cell">{{ r.dialled }}</span>
                <span role="cell" class="rp-bar"><i [style.width.%]="pc(r.reached, r.dialled)"></i><b class="mono">{{ r.reached }}</b><small>{{ pc(r.reached, r.dialled) }}%</small></span>
                <span role="cell" class="rp-bar done"><i [style.width.%]="pc(r.completed, r.reached)"></i><b class="mono">{{ r.completed }}</b><small>{{ pc(r.completed, r.reached) }}%</small></span>
                <span class="mono" role="cell">{{ r.not_reached }}</span>
                <span class="mono" role="cell">{{ r.failed }}</span>
                <span role="cell">@if (r.follow_up) { <a class="rp-follow" (click)="goFollowUps()" (keydown.enter)="goFollowUps()" tabindex="0" title="Open Follow ups">{{ r.follow_up }}</a> } @else { <span class="rp-zero mono">0</span> }</span>
              </div>
            }
            @if ((report()?.rows?.length || 0) > reportRows().length) { <button class="rp-more" (click)="showAll.set(true)">Show all {{ report().rows.length }}</button> }
          </div>
        }
      </div>

      <!-- Paper layout: what Share, PDF prints. Hidden on screen. -->
      <section class="print-report" aria-hidden="true">
        <header><h1>Calling report</h1><p>{{ workspace() }} · {{ period() }} · made {{ madeAt() }}</p></header>
        <div class="pr-tiles">
          <div><small>Dialled</small><b>{{ rt().dialled || 0 }}</b><span>{{ rt().contacts || 0 }} contacts</span></div>
          <div><small>Reached</small><b>{{ rt().reached || 0 }}</b><span>{{ pc(rt().reached, rt().dialled) }}% of dialled</span></div>
          <div><small>Completed</small><b>{{ rt().completed || 0 }}</b><span>{{ pc(rt().completed, rt().reached) }}% of reached</span></div>
          <div><small>Needs follow up</small><b>{{ rt().follow_up || 0 }}</b><span>a person takes these</span></div>
        </div>
        <h2>Call status</h2>
        <p class="pr-list">@for (o of topOutcomes(); track o.key) { <span>{{ o.label }} <b>{{ o.count }}</b></span> }</p>
        @if (agent() && answers().length) {
          <h2>Answers</h2>
          @for (a of answers(); track a.key) { <p class="pr-list"><b>{{ a.label }}:</b> @if (a.type === 'number') { <span>total <b>{{ a.sum }}</b>, average <b>{{ a.avg }}</b></span> } @else { @for (v of a.values; track v.value) { <span>{{ pretty(v.value) }} <b>{{ v.count }}</b></span> } }</p> }
        }
        @if (input(); as inp) { <h2>Input</h2><p class="pr-list"><span>Rows uploaded <b>{{ inp.rows }}</b></span><span>Rejected <b>{{ inp.rejected }}</b></span><span>With warnings <b>{{ inp.warned }}</b></span>@for (p of inp.problems; track p.label + p.field) { <span>{{ p.label }} <b>{{ p.rows }}</b></span> }</p> }
        @if (why()?.reasons?.length) { <h2>Picked up, not completed</h2><p class="pr-list">@for (r of why().reasons; track r.key) { <span>{{ r.label }} <b>{{ r.count }}</b></span> }</p> }
        <h2>By {{ byLabel().toLowerCase() }}</h2>
        <table>
          <thead><tr><th>{{ byLabel() }}</th><th>Dialled</th><th>Reached</th><th>Completed</th><th>Not reached</th><th>Failed</th><th>Follow up</th></tr></thead>
          <tbody>@for (r of report()?.rows || []; track r.key) { <tr><td>{{ rowLabel(r) }}</td><td>{{ r.dialled }}</td><td>{{ r.reached }} ({{ pc(r.reached, r.dialled) }}%)</td><td>{{ r.completed }} ({{ pc(r.completed, r.reached) }}%)</td><td>{{ r.not_reached }}</td><td>{{ r.failed }}</td><td>{{ r.follow_up }}</td></tr> }</tbody>
        </table>
        <h2>Day by day</h2>
        <table>
          <thead><tr><th>Day</th><th>Dialled</th><th>Reached</th><th>Completed</th><th>Not reached</th><th>Failed</th></tr></thead>
          <tbody>@for (r of report()?.trend || []; track r.day) { <tr><td>{{ dayLabel(r.day) }}</td><td>{{ r.dialled }}</td><td>{{ r.reached }}</td><td>{{ r.completed }}</td><td>{{ r.not_reached }}</td><td>{{ r.failed }}</td></tr> }</tbody>
        </table>
        <footer>Echo by Cognilix</footer>
      </section>

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
  private auth = inject(AuthService);
  private intervalId: any = null;

  // Compare: the report under the funnel. Share sends exactly this.
  readonly BYS = [{ key: 'campaign', label: 'Campaign' }, { key: 'agent', label: 'Agent' }, { key: 'day', label: 'Day' }];
  report = signal<any>(null);
  by = signal('campaign');
  // One agent, or all. Nothing about the agent is assumed: its answers and its file columns come from its own setup.
  agent = signal('');
  agents = computed<{ key: string; label: string }[]>(() => this.report()?.agents || []);
  agentName = computed(() => this.agents().find((a) => a.key === this.agent())?.label || this.agent());
  answers = computed<any[]>(() => this.report()?.answers || []);
  input = computed<any>(() => (this.report()?.input?.rows ? this.report().input : null));
  why = computed<any>(() => this.report()?.why || null);
  rowsLine = computed<any>(() => this.report()?.rows_line || null);
  bys = computed(() => this.BYS.filter((b) => !(this.agent() && b.key === 'agent')));
  setAgent(k: string): void { this.agent.set(k || ''); if (k && this.by() === 'agent') this.by.set('campaign'); if (!this.columns().some((c) => c.key === this.by()) && this.isColumn()) this.by.set('campaign'); this.showAll.set(false); this.load(); }
  pickRow(r: any): void { if (this.by() === 'agent') this.setAgent(r.key); }
  /** CODE_WORDS and snake_case answers read as plain words; anything already written for people is left alone. */
  pretty(v: string): string { const s = String(v); if (!/^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(s) && s !== s.toUpperCase()) return s; const t = s.replace(/_/g, ' ').toLowerCase(); return t[0].toUpperCase() + t.slice(1); }
  showAll = signal(false);
  columns = computed<{ key: string; label: string }[]>(() => this.report()?.columns || []);
  isColumn = computed(() => !this.BYS.some((b) => b.key === this.by()));
  byLabel = computed(() => this.BYS.find((b) => b.key === this.by())?.label || this.cap(this.columns().find((c) => c.key === this.by())?.label || this.by()));
  reportRows = computed<any[]>(() => { const rows = this.report()?.rows || []; return this.showAll() ? rows : rows.slice(0, 6); });
  rt = computed<any>(() => this.report()?.total || {});
  workspace = computed(() => this.auth.currentMembership()?.org_name || 'Echo');
  period = computed(() => (this.days() === 1 ? 'Today' : `Last ${this.days()} days`));
  madeAt = computed(() => new Date(this.report()?.generated_at || Date.now()).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }));
  private cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  pc(a: number, b: number): number { return b ? Math.round((a / b) * 100) : 0; }
  setBy(k: string): void { this.by.set(k); this.showAll.set(false); this.load(); }
  rowLabel(r: any): string { return this.by() === 'day' ? this.dayLabel(r.label) : r.label; }
  dayLabel(d: string): string { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
  goFollowUps(): void { this.router.navigate(['/follow-ups']); }
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
      const [m, c, r] = await Promise.all([
        this.api.metrics(this.days(), this.agent()),
        this.api.calls({ limit: '50', ...this.query(), agent: this.agent() }),
        this.api.reportSummary({ days: String(this.days()), by: this.by(), agent: this.agent() }).catch(() => null),
      ]);
      this.metrics.set(m);
      if (r) this.report.set(r);
      this.calls.set(c.calls || []);
      this.total.set(c.total ?? 0);
      this.storage.set(c.storage_connected);
      this.error.set('');
    } catch (e: any) {
      this.error.set(e.message);
    }
  }


}
