import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { EchoMarkComponent } from '../../components/echo-mark/echo-mark.component';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { HintComponent } from '../../components/hint/hint.component';
import { CreditsService, fmtCredits } from '../../services/credits.service';

/**
 * New campaign in one compact modal: pick the agent, get its template, drop the
 * sheet, start. The sheet is checked before anything is created, so the user sees
 * "20 rows to 7 calls" first, and nothing is left half made if they cancel.
 */
@Component({
  selector: 'app-new-campaign',
  standalone: true,
  imports: [EchoMarkComponent, FormsModule, IconComponent, GuideComponent, HintComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <div class="modal nc" role="dialog" aria-label="New campaign" (click)="$event.stopPropagation()">
        <div class="modal-head nc-head">
          <div class="modal-title">New campaign</div>
          <button class="btn-icon" (click)="close()" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button>
        </div>

        <!-- One screen: agent and template on one row, drop the sheet, see rows to calls, start. -->
        <div class="modal-body nc-body">
          @if (error()) { <div class="note bad">{{ error() }}</div> }

          <div class="nc-row">
            <label class="field nc-agent-pick">
              <span class="field-label">Agent <app-hint text="Agents without a calling flow are listed but cannot run yet; set the flow in the agent's Settings."></app-hint></span>
              <select class="select" [ngModel]="agent()" (ngModelChange)="pickKey($event)" aria-label="Agent">
                @if (!agents().length) { <option value="">Loading agents…</option> }
                @for (a of agents(); track a.key) { <option [value]="a.key" [disabled]="!a.ozonetel_campaign">{{ a.label }}{{ a.ozonetel_campaign ? '' : ' (no calling flow)' }}</option> }
              </select>
            </label>
            <a class="btn btn-ghost nc-tpl" [class.disabled]="!agent()" [href]="agent() ? api.agentTemplateUrl(agent()) : null" download title="Optional: a sheet with this agent's column names. Your own sheet works too.">
              <app-icon name="download" [size]="14"></app-icon> Template
            </a>
          </div>

          <label [class]="'nc-drop' + (dragging() ? ' drag' : '') + (file() ? ' has' : '')"
            (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
            <input type="file" accept=".xlsx,.xlsm,.csv" hidden (change)="onFile($any($event.target).files?.[0])" [disabled]="!canRun()" />
            <app-icon [name]="file() ? 'table' : 'upload'" [size]="20"></app-icon>
            @if (!file()) { <span class="nc-drop-txt"><b>Drop your list</b><span class="row-sub">.xlsx or .csv, any column names; Echo matches them</span></span> }
            @else { <span class="nc-drop-txt"><b>{{ file()!.name }}</b><span class="row-sub">click to change</span></span> }
          </label>

          @if (checking()) {
            <div class="row-sub">Reading your sheet…</div>
          } @else if (check(); as c) {
            <div class="nc-flow">
              <b>{{ c.rows }}</b> rows <app-icon name="chevronRight" [size]="14"></app-icon> <b class="ok">{{ c.calls }}</b> calls
              @if (c.calls < c.rows) { <app-guide topic="group_rows"></app-guide> }
              @if (c.bad) { <span class="tag warn" [title]="c.bad + ' rows have numbers that cannot be dialled; they are skipped'">{{ c.bad }} skipped</span> }
            </div>
            <!-- Columns matched by meaning are shown so a wrong guess is one click to fix. -->
            @if (c.mapping?.length) {
              <details class="nc-map" [open]="needsLook()">
                <summary><span>{{ matched() }} of {{ c.mapping.length }} columns matched{{ byMeaning() ? ', ' + byMeaning() + ' by meaning' : '' }}</span> <span class="row-sub">Check</span></summary>
                @for (m of c.mapping; track m.column) {
                  <div class="nc-map-row">
                    <span class="mono">{{ m.column }}@if (m.required) { <b class="nc-req" title="Needed to call">*</b> }</span>
                    <app-icon name="chevronLeft" [size]="12"></app-icon>
                    <select class="select select-sm" [ngModel]="map()[m.column] ?? ''" (ngModelChange)="setMap(m.column, $event)" [attr.aria-label]="'Column for ' + m.column">
                      <option value="">Not in this sheet</option>
                      @for (h of c.headers; track $index) { <option [value]="$index">{{ h || 'Column ' + ($index + 1) }}</option> }
                    </select>
                    @if (m.matched_by === 'ai' && map()[m.column] === m.index) { <span class="tag info" title="Matched by meaning, not by the exact name">guessed</span> }
                  </div>
                }
              </details>
            }
            @if (missingRequired().length) { <div class="note bad">Pick the column for <span class="mono">{{ missingRequired().join(', ') }}</span> to start.</div> }
            @if (c.answer_credits) {
              <div class="nc-cost" [class.short]="c.answer_credits > credits.balance()">
                <span>Up to <b class="mono">{{ fmt(c.answer_credits) }}</b> credits if every row is answered; calls nobody picks up are free.</span>
                <span class="row-sub">Balance {{ fmt(credits.balance()) }}{{ c.answer_credits > credits.balance() ? '. Calls pause when credits run out.' : '' }}</span>
              </div>
            }
          }
        </div>

        <div class="modal-foot">
          <button class="btn btn-ghost" (click)="start(false)" [disabled]="busy() || !canRun()" title="Create the campaign now and upload the sheet later">Save without calling</button>
          <span style="flex: 1"></span>
          <button class="btn btn-primary" (click)="start(true)" [disabled]="busy() || !check()?.calls || checking() || !!missingRequired().length"
            title="Real calls start right away and follow the agent's calling rules">
            @if (busy()) { <app-echo-mark mode="inline" [size]="16" [tile]="false" style="--em-ink: currentColor"></app-echo-mark> } @else { <app-icon name="phoneOut" [size]="14"></app-icon> } {{ busy() ? 'Starting…' : check()?.calls ? 'Start ' + check()?.calls + ' calls' : 'Start' }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .nc { max-width: 480px; width: calc(100vw - 32px); }
    .nc-head { display: flex; align-items: center; justify-content: space-between; }
    .nc-body { display: grid; gap: 12px; }
    .nc-row { display: flex; gap: 8px; align-items: flex-end; }
    .nc-agent-pick { flex: 1; min-width: 0; }
    .nc-tpl { white-space: nowrap; }
    .nc-tpl.disabled { pointer-events: none; opacity: .5; }
    .nc-drop { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1.5px dashed var(--line-strong); border-radius: 12px; cursor: pointer; color: var(--ink-3); }
    .nc-drop:hover, .nc-drop.drag { border-color: var(--red); background: var(--red-wash); }
    .nc-drop.has { border-style: solid; }
    .nc-drop b { color: var(--ink); font-weight: 600; }
    .nc-drop-txt { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; min-width: 0; }
    .nc-flow { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
    .nc-flow b { font-size: 16px; color: var(--ink); } .nc-flow b.ok { color: var(--green-ink); }
    .nc-map { border: 1px solid var(--ds-border); border-radius: 10px; padding: 8px 10px; font-size: 13px; }
    .nc-map summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
    .nc-map-row { display: grid; grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1.2fr) auto; gap: 6px; align-items: center; margin-top: 6px; }
    .nc-req { color: var(--red); margin-left: 2px; }
    .nc-cost { display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; background: var(--ds-surface-sunken); font-size: 13px; }
    .nc-cost.short { background: var(--ds-warning-bg); }
  `],
})
export class NewCampaignComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();
  api = inject(ApiService);
  private router = inject(Router);

  agents = signal<any[]>([]);
  agent = signal('');
  note = signal('');
  file = signal<File | null>(null);
  check = signal<any>(null);
  checking = signal(false);
  dragging = signal(false);
  busy = signal(false);
  error = signal('');

  current = computed(() => this.agents().find((a) => a.key === this.agent()));
  credits = inject(CreditsService);
  fmt = fmtCredits;
  /** Agent column -> sheet column index, starting from Echo's match. */
  map = signal<Record<string, number | null>>({});
  matched = computed(() => Object.values(this.map()).filter((v) => v !== null && v !== undefined).length);
  byMeaning = computed(() => (this.check()?.mapping || []).filter((m: any) => m.matched_by === 'ai' && this.map()[m.column] === m.index).length);
  missingRequired = computed(() => (this.check()?.mapping || []).filter((m: any) => m.required && (this.map()[m.column] === null || this.map()[m.column] === undefined)).map((m: any) => m.column));
  needsLook = computed(() => this.byMeaning() > 0 || this.missingRequired().length > 0);
  setMap(col: string, v: string): void { this.map.update((m) => ({ ...m, [col]: v === '' ? null : Number(v) })); }
  canRun = computed(() => !!this.current()?.ozonetel_campaign);

  ngOnInit(): void {
    this.api.agents().then((list: any[]) => {
      this.agents.set(list);
      const first = list.find((a) => a.ozonetel_campaign);
      if (first) this.agent.set(first.key);
    }).catch((e) => this.error.set(e.message));
  }

  pickKey(key: string): void { const a = this.agents().find((x) => x.key === key); if (a) this.pick(a); }
  pick(a: any): void {
    if (!a.ozonetel_campaign) return;
    if (a.key !== this.agent()) { this.agent.set(a.key); this.file.set(null); this.check.set(null); }
  }
  onDrop(e: DragEvent): void { e.preventDefault(); this.dragging.set(false); this.onFile(e.dataTransfer?.files?.[0]); }
  async onFile(f?: File): Promise<void> {
    if (!f) return;
    this.error.set('');
    if (!/\.xlsx?$|\.xlsm$|\.csv$/i.test(f.name)) { this.error.set('Use an .xlsx or .csv file.'); return; }
    this.file.set(f); this.check.set(null); this.checking.set(true);
    try { const c = await this.api.checkAgentFile(this.agent(), f); this.check.set(c); this.map.set(Object.fromEntries((c.mapping || []).map((m: any) => [m.column, m.index]))); if (!this.credits.wallet()) this.credits.refresh(); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.checking.set(false); }
  }

  async start(dial: boolean): Promise<void> {
    const a = this.current(); const f = this.file();
    if (!a || !f) return;
    this.busy.set(true); this.error.set('');
    try {
      const keys = (a.providers || []).map((p: any) => p.key);
      const created = await this.api.createCampaign({ agent: a.key, provider: keys.includes('gemini') ? 'gemini' : keys[0] || 'gemini', direction: 'outbound', description: this.note().trim() });
      if (dial) await this.api.uploadContacts(created.campaign_id, f, { dryRun: false, mapping: this.map() });
      this.closed.emit();
      this.router.navigate(['/campaigns', created.campaign_id]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  close(): void { if (!this.busy()) this.closed.emit(); }
}
