import { Component, inject, signal, computed, OnInit, HostListener, ViewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { PlayerComponent } from '../../components/player/player.component';
import { HintComponent } from '../../components/hint/hint.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { StatusReferenceComponent } from '../../components/status-reference/status-reference.component';
import { fmtTime, fmtSecs } from '../../utils/format';
import { outcomeView, dialSentence, telephonyLine, statusHover } from '../../utils/status';

/**
 * The call page: everything about one contact's call on one page.
 *
 * Opened two ways:
 *   /campaigns/:cid/contacts/:pid  a campaign contact: outcome, every dial, rows
 *                                  and answers, plus the call if someone picked up
 *   /calls/:id                     any call by id (console tests, the overview list)
 *
 * Previous and next step through the campaign's contacts without going back to
 * the list. Transcript, audio and the full record download from the top bar.
 */
@Component({
  selector: 'app-call-analysis',
  standalone: true,
  imports: [RouterLink, IconComponent, PlayerComponent, HintComponent, GuideComponent, StatusReferenceComponent],
  template: `
    <div class="page cp">
      <div class="cp-bar">
        <nav class="crumbs" aria-label="Breadcrumb">
          @if (cid()) {
            <a routerLink="/campaigns">Campaigns</a><span>/</span>
            <a [routerLink]="['/campaigns', cid()]">{{ contact()?.campaign?.name || 'Campaign' }}</a>
          } @else {
            <a routerLink="/overview">Calls</a>
          }
        </nav>
        <div class="cp-acts">
          @if (cid() && contact()) {
            <button class="icon-btn" [disabled]="!contact().prev" (click)="go(contact().prev)" title="Previous (k)" aria-label="Previous contact"><app-icon name="chevronLeft" [size]="15"></app-icon></button>
            <span class="row-sub mono">{{ contact().position }} / {{ contact().total }}</span>
            <button class="icon-btn" [disabled]="!contact().next" (click)="go(contact().next)" title="Next (j)" aria-label="Next contact"><app-icon name="chevronRight" [size]="15"></app-icon></button>
            <span class="cp-sep"></span>
          }
          @if (callId()) {
            <a class="icon-btn" [href]="api.callTranscriptUrl(callId())" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
          }
          <button class="icon-btn" (click)="exportRecord()" title="Download the full record (JSON)" aria-label="Download the full record"><app-icon name="download" [size]="15"></app-icon></button>
        </div>
      </div>

      @if (loading()) {
        <div class="empty"><div class="empty-title">Loading…</div></div>
      } @else if (error()) {
        <div class="note bad">{{ error() }}</div>
      } @else {
        <!-- Who, the call status, and the facts that matter, on one line. -->
        <header class="cp-head">
          <div class="cp-who">
            <h1>{{ title() }}</h1>
            <span class="mono row-sub">{{ phone() }}@if (contact()?.parts > 1) { · call {{ contact().part }} of {{ contact().parts }} }</span>
          </div>
          <div class="cp-st">
            <span [class]="'tag cp-tag ' + ov().cls">{{ ov().label }}</span>
            <app-hint [text]="why()"></app-hint>
            @if (nextTry()) { <span class="row-sub">next try {{ nextTry() }}</span> }
            <app-status-reference label="All rules" [highlight]="ov().key"></app-status-reference>
          </div>
          <dl class="cp-facts">
            @if (contact()) { <div><dt>Dials</dt><dd>{{ contact().attempts || 0 }}</dd></div> }
            <div><dt>Talk</dt><dd>{{ fmtSecs(talkSeconds()) }}</dd></div>
            @if (call()?.started_at) { <div><dt>Started</dt><dd>{{ clock(call().started_at) }}</dd></div> }
            <div><dt>Agent</dt><dd class="ellipsis" [title]="contact()?.campaign?.agent_label || agentLabel()">{{ contact()?.campaign?.agent_label || agentLabel() }}</dd></div>
          </dl>
        </header>

        <div class="cp-main">
          <!-- Listen and read: the player sits on top of the transcript; click a line to play from there. -->
          <section class="card cp-convo">
            @if (callId()) {
              <div class="cp-player"><app-player #player [callId]="callId()" [recordingUrl]="call()?.recording_url || ''" [seconds]="call()?.duration_seconds || 0" [turns]="turnMarks()"></app-player></div>
              @if (summary()) {
                <div class="cp-sum" [class.open]="sumOpen()">
                  <app-icon name="fileText" [size]="14"></app-icon>
                  <div class="cp-sum-body">
                    <p>{{ summary() }}</p>
                    @if (sumOpen() && analysis()?.action_items?.length) {
                      <ul>@for (x of analysis().action_items; track $index) { <li>{{ x }}</li> }</ul>
                    }
                  </div>
                  <button class="btn-link" (click)="sumOpen.set(!sumOpen())">{{ sumOpen() ? 'Less' : 'More' }}</button>
                </div>
              }
              <div class="cp-tx-head">
                <span class="card-title"><app-icon name="message" [size]="14"></app-icon> Transcript <span class="row-sub">· {{ messages().length }} turns · click a line to play it</span></span>
                <button class="btn btn-sm" (click)="copyTranscript()"><app-icon name="copy" [size]="12"></app-icon> {{ copied() ? 'Copied' : 'Copy' }}</button>
              </div>
              <div class="cp-tx">
                @if (!messages().length) {
                  <div class="empty-sub" style="padding: 16px">No words were spoken on this call.</div>
                } @else {
                  @for (m of messages(); track $index) {
                    @if (m.speaker === 'tool') {
                      <div class="tx-tool"><app-icon name="answers" [size]="12"></app-icon> {{ m.tool === 'submit_call_outputs' ? 'Answers sent' : m.tool }} <span class="mono">{{ offset(m.ts) }}</span></div>
                    } @else {
                      <button type="button" [class]="'tx ' + (m.speaker === 'agent' ? 'tx-agent' : 'tx-caller')" (click)="playFrom(m.ts)" title="Play from here">
                        <span class="tx-meta"><b>{{ m.speaker === 'agent' ? agentLabel() : 'Caller' }}</b><span class="mono">{{ offset(m.ts) }}</span></span>
                        <span class="tx-text">{{ m.text }}</span>
                      </button>
                    }
                  }
                }
              </div>
            } @else {
              <div class="empty" style="padding: 36px 16px">
                <div class="empty-icon"><app-icon name="phoneOff" [size]="18"></app-icon></div>
                <div class="empty-title">No recording or transcript</div>
                <div class="empty-sub">{{ ov().group === 'in_progress' ? 'This contact has not been reached yet.' : 'Nobody picked up, so nothing was recorded.' }}</div>
              </div>
            }
          </section>

          <!-- Everything else in tabs, so the page stays one screen tall. -->
          <aside class="card cp-side">
            <div class="seg-tabs" role="tablist" aria-label="Call details">
              @for (t of sideTabs(); track t.key) {
                <button role="tab" type="button" [class]="'seg-tab' + (side() === t.key ? ' on' : '')" [attr.aria-selected]="side() === t.key" [attr.tabindex]="side() === t.key ? 0 : -1"
                  (click)="side.set(t.key)" (keydown.arrowright)="moveTab(1)" (keydown.arrowleft)="moveTab(-1)"><span class="seg-tab-label">{{ t.label }}</span>@if (t.n != null) { <span class="seg-n">{{ t.n }}</span> }</button>
              }
            </div>
            <div class="cp-side-body">
              @switch (side()) {
                @case ('answers') {
                  @if (answerPairs().length) {
                    <dl class="cp-kv">@for (kv of answerPairs(); track kv.key) { <dt>{{ kv.key }}</dt><dd>{{ kv.value }}</dd> }</dl>
                  } @else { <div class="empty-sub cp-none">No answers on this call.</div> }
                }
                @case ('rows') {
                  <div class="scroll-x">
                    <table class="table cp-rows">
                      <thead><tr><th>#</th>@for (c of contact().row_columns; track c) { <th>{{ nice(c) }}</th> }@for (f of answerCols(); track f) { <th class="cp-ans">{{ nice(f) }}</th> }</tr></thead>
                      <tbody>
                        @for (r of contact().rows; track r.n) {
                          <tr [title]="'File row ' + r.row">
                            <td class="mono">{{ r.n }}</td>
                            @for (c of contact().row_columns; track c) { <td>{{ r.values[c] }}</td> }
                            @for (f of answerCols(); track f) { <td class="cp-ans">{{ show(r.answer?.[f]) }}</td> }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
                @case ('dials') {
                  <ol class="cp-dials">
                    @for (a of contact().attempt_log; track a.attempt) {
                      <li>
                        <span class="d-n mono">{{ a.attempt }}</span>
                        <span class="d-body">
                          <span class="d-top"><span [class]="'tag ' + outcomeView(a.outcome).cls">{{ outcomeView(a.outcome).label }}</span>
                            @if (a.facts?.provider_disagrees) { <span class="tag warn" title="The telephony service said not answered, but Echo heard the caller">check</span> }
                            <span class="mono row-sub">{{ clock(a.started_at) }}</span></span>
                          <span class="row-sub">{{ dialSentence(a) }}</span>
                        </span>
                        <app-hint [text]="raw(a)"></app-hint>
                      </li>
                    }
                  </ol>
                  <div class="row-sub cp-retry">Tries follow the agent's retry rule <app-guide topic="retry"></app-guide></div>
                }
                @case ('details') {
                  <dl class="cp-kv">@for (kv of contextPairs(); track kv.key) { <dt>{{ nice(kv.key) }}</dt><dd>{{ kv.value }}</dd> }</dl>
                }
              }
            </div>
          </aside>
        </div>
      }
    </div>
  `,
  styles: [`
    .cp { max-width: 1600px; margin: 0 auto; width: 100%; gap: 12px; }
    .cp-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .crumbs { display: flex; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); min-width: 0; }
    .crumbs a { color: var(--muted); } .crumbs a:hover { color: var(--ink); text-decoration: underline; }
    .cp-acts { display: flex; align-items: center; gap: 4px; }
    .cp-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
    .cp-head { display: flex; align-items: center; gap: 12px 24px; flex-wrap: wrap; }
    .cp-who { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .cp-who h1 { font-size: 20px; font-weight: 650; margin: 0; color: var(--ink); letter-spacing: -0.01em; }
    .cp-st { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .cp-tag { font-size: 13px; font-weight: 600; padding: 3px 10px; }
    .cp-facts { display: flex; gap: 20px; margin: 0 0 0 auto; flex-wrap: wrap; }
    .cp-facts div { display: grid; gap: 1px; min-width: 0; max-width: 220px; }
    .cp-facts dt { font-size: 11px; color: var(--faint); }
    .cp-facts dd { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); }
    .cp-main { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr); gap: 12px; align-items: start; }
    .cp-convo { display: flex; flex-direction: column; overflow: hidden; margin: 0; }
    .cp-player { padding: 12px 12px 8px; }
    .cp-sum { display: flex; gap: 8px; align-items: flex-start; margin: 0 12px 8px; padding: 8px 10px; background: var(--raised); border-radius: 8px; font-size: 13px; color: var(--ink-2); }
    .cp-sum app-icon { color: var(--muted); margin-top: 2px; }
    .cp-sum-body { flex: 1; min-width: 0; }
    .cp-sum p { margin: 0; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .cp-sum.open p { -webkit-line-clamp: unset; display: block; }
    .cp-sum ul { margin: 6px 0 0; padding-left: 18px; }
    .btn-link { border: 0; background: none; color: var(--muted); font-size: 12px; cursor: pointer; padding: 0; white-space: nowrap; }
    .btn-link:hover { color: var(--ink); text-decoration: underline; }
    .cp-tx-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; border-top: 1px solid var(--line-soft); border-bottom: 1px solid var(--line-soft); }
    .cp-tx { overflow: auto; max-height: calc(100vh - 330px); min-height: 240px; padding: 8px 6px; display: grid; gap: 2px; align-content: start; }
    .tx { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; text-align: left; border: 0; background: transparent; padding: 6px 8px; border-radius: 8px; cursor: pointer; font: inherit; color: var(--ink-2); }
    .tx:hover { background: var(--raised); }
    .tx-meta { display: grid; gap: 1px; font-size: 12px; color: var(--faint); }
    .tx-meta b { font-weight: 600; font-size: 12px; }
    .tx-agent .tx-meta b { color: var(--ds-speaker-agent); } .tx-caller .tx-meta b { color: var(--ds-speaker-caller); }
    .tx-text { font-size: 14px; line-height: 1.5; }
    .tx-tool { display: flex; gap: 6px; align-items: center; justify-content: center; font-size: 12px; color: var(--muted); padding: 4px; }
    .cp-side { margin: 0; overflow: hidden; position: sticky; top: 0; }
    .cp-side-body { max-height: calc(100vh - 230px); overflow: auto; }
    .cp-kv { display: grid; grid-template-columns: minmax(110px, 40%) minmax(0, 1fr); margin: 0; padding: 6px 14px 12px; font-size: 13px; }
    .cp-kv dt, .cp-kv dd { margin: 0; padding: 7px 0; border-bottom: 1px solid var(--line-soft); }
    .cp-kv dt { color: var(--muted); padding-right: 10px; }
    .cp-kv dd { color: var(--ink); overflow-wrap: anywhere; }
    .cp-none { padding: 16px; }
    .cp-rows td, .cp-rows th { font-size: 12px; padding: 6px 8px; white-space: nowrap; vertical-align: top; }
    .cp-ans { background: var(--raised); }
    .cp-dials { list-style: none; margin: 0; padding: 4px 12px; }
    .cp-dials li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: start; padding: 9px 0; border-bottom: 1px solid var(--line-soft); }
    .d-n { width: 20px; height: 20px; border-radius: 50%; background: var(--bg); display: grid; place-items: center; font-size: 11px; color: var(--muted); }
    .d-body { display: grid; gap: 3px; min-width: 0; }
    .d-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .cp-retry { padding: 8px 14px 12px; display: flex; align-items: center; }
    @media (max-width: 1000px) {
      .cp-main { grid-template-columns: minmax(0, 1fr); }
      .cp-side { position: static; }
      .cp-tx, .cp-side-body { max-height: none; }
      .cp-facts { margin-left: 0; }
    }
  `],
})
export class CallAnalysisComponent implements OnInit {
  api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  cid = signal('');
  pid = signal('');
  callId = signal('');
  contact = signal<any>(null);
  call = signal<any>(null);
  analysis = signal<any>(null);
  loading = signal(true);
  error = signal('');
  copied = signal(false);

  fmtTime = fmtTime;
  fmtSecs = fmtSecs;
  outcomeView = outcomeView;
  telephonyLine = telephonyLine;
  /** Telephony HH:MM:SS as m:ss, or empty for zero. */
  hms(t: string): string { const [h, m, x] = String(t || '').split(':').map(Number); const n = (h || 0) * 3600 + (m || 0) * 60 + (x || 0); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : ''; }
  lastProvider = computed(() => { const l = this.contact()?.attempt_log; return l?.length ? l[l.length - 1].provider : null; });

  @ViewChild('player') player?: PlayerComponent;
  sumOpen = signal(false);
  side = signal<'answers' | 'rows' | 'dials' | 'details'>('answers');
  dialSentence = dialSentence;
  phone = computed(() => this.contact()?.contact?.phone || this.call()?.phone || '');
  summary = computed(() => this.analysis()?.executive_summary || this.call()?.summary || '');
  /** Side tabs that have something to show; the first one opens. */
  sideTabs = computed(() => {
    const c = this.contact();
    const t: { key: 'answers' | 'rows' | 'dials' | 'details'; label: string; n: number | null }[] = [];
    if (c?.rows?.length) t.push({ key: 'rows', label: 'Rows', n: c.rows.length });
    if (this.answerPairs().length || !c?.rows?.length) t.push({ key: 'answers', label: 'Answers', n: null });
    if (c?.attempt_log?.length) t.push({ key: 'dials', label: 'Dials', n: c.attempt_log.length });
    if (this.contextPairs().length) t.push({ key: 'details', label: 'Call data', n: null });
    return t;
  });
  /** Status info icon: what happened, what the telephony service sent, and the rule. */
  why = computed(() => {
    const p = this.lastProvider();
    const ring = p ? this.hms(p.CustomerRingTime || p.TimeToAnswer) : '';
    const talk = p && p.Status === 'Answered' ? this.hms(p.CallDuration) : '';
    const tel = p ? `${telephonyLine(p)}${ring ? ' · rang ' + ring : ''}${talk ? ' · talk ' + talk : ''}` : '';
    return [this.sentence(), tel, this.ov().ozonetel ? `How: ${this.ov().ozonetel}` : ''].filter(Boolean).join('\n');
  });
  /** Speaker changes in seconds from the start, to colour the waveform. */
  turnMarks = computed(() => {
    const t0 = this.call()?.started_at ? Date.parse(this.call().started_at) : 0;
    return t0 ? this.messages().filter((m: any) => m.speaker !== 'tool').map((m: any) => ({ at: Math.max(0, (Date.parse(m.ts) - t0) / 1000), who: m.speaker === 'agent' ? 'agent' as const : 'caller' as const })) : [];
  });
  ov = computed(() => outcomeView(this.contact()?.outcome || (this.call() ? (this.call().num_turns ? 'completed' : 'no_reply') : '')));
  hover = statusHover;
  title = computed(() => this.contact()?.contact?.name || this.call()?.contact_name || this.contact()?.contact?.phone || this.call()?.phone || 'Call');
  talkSeconds = computed(() => this.contact()?.timing?.talk_seconds ?? this.call()?.duration_seconds ?? 0);
  sentence = computed(() => {
    const c = this.contact();
    const last = c?.attempt_log?.[c.attempt_log.length - 1];
    if (last) {
      const s = dialSentence(last);
      return c.attempts > 1 ? `${s}. ${c.attempts} dials in all.` : s;
    }
    if (this.ov().group === 'in_progress') return this.ov().help;
    return this.call() ? `Talked ${fmtSecs(this.call().duration_seconds)}` : this.ov().help;
  });
  nextTry = computed(() => (this.contact()?.next_attempt_at ? this.clock(this.contact().next_attempt_at) : ''));
  outputs = computed<Record<string, any>>(() => this.contact()?.outputs || this.call()?.outputs || this.extracted());
  answerPairs = computed(() => Object.entries(this.outputs() || {})
    .filter(([, v]) => !Array.isArray(v))
    .map(([key, v]) => ({ key: this.nice(key), value: this.show(v) })));
  answerCols = computed(() => {
    const rows = this.contact()?.rows || [];
    return (this.contact()?.answer_fields || []).filter((f: string) => f !== 'row' && rows.some((r: any) => !this.blank(r.answer?.[f])));
  });
  contextPairs = computed(() => {
    const ctx = this.contact()?.context || this.call()?.context || {};
    return Object.entries(ctx).filter(([k, v]) => !['rows', 'row_count'].includes(k) && !this.blank(v)).map(([key, v]) => ({ key, value: String(v) }));
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((p) => {
      this.cid.set(p.get('cid') || '');
      this.pid.set(p.get('pid') || '');
      this.load(p.get('id') || '');
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
    if (e.key === 'j' && this.contact()?.next) this.go(this.contact().next);
    if (e.key === 'k' && this.contact()?.prev) this.go(this.contact().prev);
  }

  async load(id: string): Promise<void> {
    this.loading.set(true); this.error.set(''); this.call.set(null); this.analysis.set(null); this.contact.set(null);
    try {
      if (this.cid()) {
        const d = await this.api.campaignContactDetail(this.cid(), this.pid());
        this.contact.set(d);
        id = d.call_id || '';
      }
      this.callId.set(id);
      if (id) {
        const c = await this.api.call(id);
        // A campaign call opens in its campaign context: rows, every dial, previous and next.
        if (!this.cid() && c.contact_ref) {
          this.router.navigate(['/campaigns', c.contact_ref.campaign_id, 'contacts', c.contact_ref.primary_id], { replaceUrl: true });
          return;
        }
        this.call.set(c);
        this.analysis.set(c.analysis || null);
      }
      this.side.set(this.sideTabs()[0]?.key || 'answers');
    } catch (e: any) {
      this.error.set(e.message || 'Could not load this call.');
    } finally { this.loading.set(false); }
  }

  /** Arrow keys move between the side tabs (WAI-ARIA tabs pattern). */
  moveTab(d: number): void {
    const t = this.sideTabs(); const i = t.findIndex((x) => x.key === this.side());
    this.side.set(t[(i + d + t.length) % t.length].key);
  }
  playFrom(ts: string): void {
    const t0 = this.call()?.started_at ? Date.parse(this.call().started_at) : 0;
    if (t0 && ts) this.player?.seek(Math.max(0, (Date.parse(ts) - t0) / 1000));
  }
  go(pid: string): void { this.router.navigate(['/campaigns', this.cid(), 'contacts', pid]); }


  agentLabel(): string {
    const l = this.contact()?.campaign?.agent_label;
    if (l) return l.split(' ')[0];
    const key = this.call()?.agent || '';
    return key ? key.replace(/_/g, ' ').replace(/\b\w/g, (x: string) => x.toUpperCase()) : 'Agent';
  }
  private extracted(): Record<string, any> {
    const t = [...(this.call()?.events || [])].reverse().find((e: any) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
    return t?.args || {};
  }
  messages() {
    return (this.call()?.events || [])
      .filter((e: any) => ['USER_TURN', 'AGENT_TURN', 'TOOL_CALL'].includes(e.kind))
      .map((e: any) => e.kind === 'TOOL_CALL' ? { speaker: 'tool', text: '', ts: e.ts, tool: e.tool } : { speaker: e.kind === 'AGENT_TURN' ? 'agent' : 'customer', text: e.text || '', ts: e.ts });
  }
  offset(ts: string): string {
    const t0 = this.call()?.started_at ? Date.parse(this.call().started_at) : 0;
    if (!t0 || !ts) return '--:--';
    const s = Math.max(0, Math.round((Date.parse(ts) - t0) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  copyTranscript(): void {
    const text = this.messages().filter((m: any) => m.speaker !== 'tool').map((m: any) => `[${this.offset(m.ts)}] ${m.speaker === 'agent' ? this.agentLabel() : 'Caller'}: ${m.text}`).join('\n');
    navigator.clipboard?.writeText(text);
    this.copied.set(true); setTimeout(() => this.copied.set(false), 1600);
  }
  exportRecord(): void {
    const blob = new Blob([JSON.stringify({ contact: this.contact(), call: this.call(), analysis: this.analysis() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `call-${this.callId() || this.pid() || 'record'}.json`; a.click();
    URL.revokeObjectURL(url);
  }
  endedBy(v: string): string { return v === 'caller' ? 'Caller' : v === 'agent' ? 'Agent' : v === 'network' ? 'Network' : '—'; }
  /** A dial's info icon: what the telephony service sent, field by field. */
  raw(a: any): string { return [`${a.provider_name || 'Telephony'} sent:`, ...Object.entries(a.provider || {}).filter(([k, x]) => x !== '' && !['UUI', 'monitorUCID'].includes(k)).map(([k, x]) => `${k}: ${x}`)].join('\n'); }
  nice(k: string): string { return String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
  blank(v: any): boolean { return v === null || v === undefined || v === ''; }
  show(v: any): string { return v === true ? 'Yes' : v === false ? 'No' : this.blank(v) ? '—' : String(v).replace(/_/g, ' '); }
  clock(ts: string): string { return ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : ''; }
}
