import { Component, EventEmitter, HostListener, Input, OnInit, Output, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';

interface Check { label: string; ok: boolean | null; detail: string; state: 'wait' | 'run' | 'done' }

/**
 * One setup flow for every integration (telephony provider or results
 * destination): fill in the fields, run the checks against the real service,
 * and save only when every check passes. Editing a saved integration runs the
 * same checks again; secrets already saved stay unless replaced.
 */
@Component({
  selector: 'app-connect',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal cn" role="dialog" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div class="modal-title">{{ title() }} @if (item.category_label) { <span class="cn-cat">{{ item.category_label }}</span> }</div>
          <button class="icon-btn" (click)="close.emit()" aria-label="Close"><app-icon name="close" [size]="15"></app-icon></button>
        </div>
        <div class="modal-body cn-body">
          <ol class="cn-steps" aria-label="Steps">
            <li [class.on]="step() === 1" [class.done]="step() > 1"><span>1</span> Details</li>
            <li [class.on]="step() === 2" [class.done]="passed()"><span>2</span> Checks</li>
            <li [class.on]="passed()"><span>3</span> Save</li>
          </ol>

          <div class="cn-fields">
            @for (f of item.fields; track f.key) {
              <label class="field">
                <span class="field-label">{{ f.label }}@if (f.optional) { <span class="row-sub"> · optional</span> }</span>
                @if (f.type === 'oauth') {
                  <button type="button" class="btn cn-oauth" [class.done]="!!cfg()[f.key]" (click)="set(f.key, 'granted')">
                    <app-icon [name]="cfg()[f.key] ? 'check' : 'key'" [size]="14"></app-icon> {{ cfg()[f.key] ? 'Signed in to ' + item.label : 'Sign in with ' + item.label }}
                  </button>
                } @else if (f.type === 'select') {
                  <select class="select" [ngModel]="cfg()[f.key]" (ngModelChange)="set(f.key, $event)">@for (o of f.options; track o) { <option [value]="o">{{ o }}</option> }</select>
                } @else {
                  <input class="input" [class.mono]="f.type !== 'text'" [type]="f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'" autocomplete="off"
                    [ngModel]="cfg()[f.key]" (ngModelChange)="set(f.key, $event)"
                    [placeholder]="f.type === 'secret' && kept(f.key) ? 'Saved ' + kept(f.key) + ' · leave empty to keep' : f.placeholder" />
                }
              </label>
            }
          </div>

          @if (checks().length) {
            <div class="cn-checks" role="list" aria-live="polite">
              @for (c of checks(); track c.label) {
                <div class="cn-check" role="listitem" [class.bad]="c.ok === false">
                  @if (c.state === 'run') { <app-icon name="loader" [size]="15" class="cn-spin"></app-icon> }
                  @else if (c.state === 'wait' || c.ok === null) { <app-icon name="pending" [size]="15" class="cn-wait"></app-icon> }
                  @else if (c.ok) { <app-icon name="ok" [size]="15" class="cn-ok"></app-icon> }
                  @else { <app-icon name="fail" [size]="15" class="cn-bad"></app-icon> }
                  <span class="cn-label">{{ c.label }}</span>
                  <span class="cn-detail">{{ c.state === 'done' ? c.detail : '' }}</span>
                </div>
              }
            </div>
          }
          @if (error()) { <div class="note bad" style="margin: 0">{{ error() }}</div> }
        </div>
        <div class="modal-foot">
          <span class="row-sub" style="margin-right: auto">{{ passed() ? 'All checks passed.' : failed() ? 'Fix the failed check and run again.' : 'Nothing is saved until every check passes.' }}</span>
          <button class="btn" (click)="close.emit()">Cancel</button>
          @if (passed()) {
            <button class="btn btn-primary" [disabled]="busy()" (click)="save()">{{ busy() ? 'Saving…' : 'Save and turn on' }}</button>
          } @else {
            <button class="btn btn-primary" [disabled]="busy() || !ready()" (click)="run()"><app-icon name="checks" [size]="13"></app-icon> {{ busy() ? 'Checking…' : failed() ? 'Run checks again' : 'Run checks' }}</button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cn { max-width: 560px; }
    .cn-cat { margin-left: 6px; font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); font-weight: 500; }
    .cn-oauth { justify-self: start; } .cn-oauth.done { color: var(--green-ink); border-color: var(--green-ink); }
    .cn-body { padding: 14px 18px 16px; display: grid; gap: 14px; }
    .cn-steps { display: flex; gap: 18px; list-style: none; margin: 0; padding: 0; font-size: 13px; color: var(--faint); }
    .cn-steps li { display: flex; align-items: center; gap: 6px; }
    .cn-steps span { width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 11px; font-weight: 600; border: 1px solid var(--line-strong); }
    .cn-steps li.on { color: var(--ink); } .cn-steps li.on span { border-color: var(--ink); }
    .cn-steps li.done span { background: var(--ds-success-fg); border-color: transparent; color: #fff; }
    .cn-fields { display: grid; gap: 10px; }
    .cn-checks { border: 1px solid var(--line); border-radius: 8px; padding: 4px 12px; }
    .cn-check { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-soft); font-size: 13px; }
    .cn-check:last-child { border-bottom: 0; }
    .cn-detail { font-size: 12px; color: var(--muted); text-align: right; }
    .cn-check.bad .cn-detail { color: var(--ds-danger-fg); text-align: left; grid-column: 2 / 4; }
    .cn-ok { color: var(--ds-success-fg); } .cn-bad { color: var(--ds-danger-fg); } .cn-wait { color: var(--faint); }
    .cn-spin { color: var(--muted); display: inline-flex; animation: cn-rot 0.9s linear infinite; }
    @keyframes cn-rot { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .cn-spin { animation: none; } }
  `],
})
export class ConnectComponent implements OnInit {
  /** Integration from the catalogue, with its saved state if any. */
  @Input() item: any;
  @Input() orgId = '';
  @Output() saved = new EventEmitter<any>();
  @Output() close = new EventEmitter<void>();
  private api = inject(ApiService);

  cfg = signal<Record<string, string>>({});
  checks = signal<Check[]>([]);
  busy = signal(false);
  error = signal('');
  private token = '';
  passed = computed(() => !!this.checks().length && this.checks().every((c) => c.state === 'done' && c.ok));
  failed = computed(() => this.checks().some((c) => c.ok === false));
  step = computed(() => (this.checks().length ? 2 : 1));
  title = computed(() => `${this.item?.status && this.item.status !== 'not_set' ? 'Edit' : 'Set up'} ${this.item?.label || ''}`);
  ready = computed(() => (this.item?.fields || []).every((f: any) => f.optional || (this.cfg()[f.key] || '').trim() || (f.type === 'secret' && this.kept(f.key))));

  ngOnInit(): void {
    const c: Record<string, string> = {};
    for (const f of this.item.fields) c[f.key] = f.type === 'secret' ? '' : this.item.config?.[f.key] || (f.type === 'select' ? f.options[0] : '');
    this.cfg.set(c);
  }
  kept(k: string): string { const v = this.item?.config?.[k]; return v ? String(v).slice(-8) : ''; }
  /** Any change makes the earlier checks stale. */
  set(k: string, v: string): void { this.cfg.update((c) => ({ ...c, [k]: v })); this.checks.set([]); this.token = ''; }

  async run(): Promise<void> {
    this.busy.set(true); this.error.set('');
    this.checks.set(this.item.checks.map((label: string) => ({ label, ok: null, detail: '', state: 'wait' })));
    try {
      const r = await this.api.checkIntegration(this.orgId, this.item.key, this.cfg());
      // Show each check finishing in turn, so a failure is easy to spot.
      for (let i = 0; i < r.checks.length; i++) {
        this.checks.update((l) => l.map((c, j) => (j === i ? { ...c, state: 'run' } : c)));
        await new Promise((ok) => setTimeout(ok, 380));
        this.checks.update((l) => l.map((c, j) => (j === i ? { ...r.checks[i], state: 'done' } : c)));
        if (r.checks[i].ok === false) break;
      }
      this.token = r.token || '';
    } catch (e: any) { this.error.set(e.message); this.checks.set([]); }
    finally { this.busy.set(false); }
  }
  async save(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try { this.saved.emit(await this.api.saveIntegration(this.orgId, this.item.key, this.token)); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  @HostListener('document:keydown.escape') onEsc(): void { this.close.emit(); }
}
