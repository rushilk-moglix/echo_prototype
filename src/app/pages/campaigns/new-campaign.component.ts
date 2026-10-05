import { Component, EventEmitter, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { HintComponent } from '../../components/hint/hint.component';

/**
 * New campaign in one compact modal: pick the agent, get its template, drop the
 * sheet, start. The sheet is checked before anything is created, so the user sees
 * "20 rows to 7 calls" first, and nothing is left half made if they cancel.
 */
@Component({
  selector: 'app-new-campaign',
  standalone: true,
  imports: [FormsModule, IconComponent, GuideComponent, HintComponent],
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
            <a class="btn nc-tpl" [class.disabled]="!agent()" [href]="agent() ? api.agentTemplateUrl(agent()) : null" download title="Sheet with the columns this agent needs">
              <app-icon name="download" [size]="14"></app-icon> Template
            </a>
          </div>

          <label [class]="'nc-drop' + (dragging() ? ' drag' : '') + (file() ? ' has' : '')"
            (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="onDrop($event)">
            <input type="file" accept=".xlsx,.xlsm" hidden (change)="onFile($any($event.target).files?.[0])" [disabled]="!canRun()" />
            <app-icon [name]="file() ? 'table' : 'upload'" [size]="20"></app-icon>
            @if (!file()) { <span class="nc-drop-txt"><b>Drop the filled sheet</b><span class="row-sub">or click to choose (.xlsx)</span></span> }
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
            @if (c.missing_columns?.length) { <div class="note bad">Missing columns: <span class="mono">{{ c.missing_columns.join(', ') }}</span>. Use the template.</div> }
          }
        </div>

        <div class="modal-foot">
          <button class="btn btn-ghost" (click)="start(false)" [disabled]="busy() || !canRun()" title="Create the campaign now and upload the sheet later">Save without calling</button>
          <span style="flex: 1"></span>
          <button class="btn btn-primary" (click)="start(true)" [disabled]="busy() || !check()?.calls || checking() || !!check()?.missing_columns?.length"
            title="Real calls start right away and follow the agent's calling rules">
            <app-icon name="phoneOut" [size]="14"></app-icon> {{ busy() ? 'Starting…' : check()?.calls ? 'Start ' + check()?.calls + ' calls' : 'Start' }}
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
    if (!/\.xlsx?$|\.xlsm$/i.test(f.name)) { this.error.set('Use an .xlsx sheet. The template is a good start.'); return; }
    this.file.set(f); this.check.set(null); this.checking.set(true);
    try { this.check.set(await this.api.checkAgentFile(this.agent(), f)); }
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
      if (dial) await this.api.uploadContacts(created.campaign_id, f, { dryRun: false });
      this.closed.emit();
      this.router.navigate(['/campaigns', created.campaign_id]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  close(): void { if (!this.busy()) this.closed.emit(); }
}
