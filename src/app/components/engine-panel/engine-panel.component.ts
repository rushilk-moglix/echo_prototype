import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { HintComponent } from '../hint/hint.component';

export interface TurnConfig {
  first: 'agent' | 'caller';
  endpoint_ms: number;
  interruption: 'off' | 'low' | 'medium' | 'high';
  backchannel: boolean;
  noise: boolean;
  voicemail: 'hangup' | 'message' | 'ignore';
  silence_end_s: number;
  max_minutes: number;
}
export interface EngineConfig {
  preset?: string;
  mode: 's2s' | 'pipeline';
  s2s: string; stt: string; llm: string; tts: string;
  /** Per stage fallbacks, the realtime alternative and the turn detector (from the presets). */
  stt_fallback?: string; tts_fallback?: string; realtime_alt?: string; turn_detector?: string;
  voice: string; language: string;
  temperature: number; max_tokens: number; speed: number;
  /** Model to switch to when the main one errors or is too slow; empty means none. */
  fallback: string;
  fallback_after_ms: number;
  turn: TurnConfig;
}
export const DEFAULT_TURN: TurnConfig = { first: 'agent', endpoint_ms: 600, interruption: 'medium', backchannel: false, noise: true, voicemail: 'hangup', silence_end_s: 20, max_minutes: 10 };
export const DEFAULT_ENGINE: EngineConfig = {
  mode: 's2s', s2s: 'gemini-live-2.5-flash', stt: 'saarika-v2.5', llm: 'gemini-2.5-flash', tts: 'bulbul-v2', voice: '', language: 'en-IN',
  temperature: 0.4, max_tokens: 300, speed: 1, fallback: '', fallback_after_ms: 2500, turn: DEFAULT_TURN,
};
type Model = { id: string; label: string; vendor: string; voices?: string[] };

/**
 * Voice and model settings in one place, for any number of vendors.
 *
 * Two ways to run a call: one voice to voice model, or the sandwich (listen with
 * a speech to text model, think with a language model, speak with a text to
 * speech model). Models are grouped by vendor in each list, so the lists stay
 * usable as vendors are added. A fallback model takes over when the main one
 * fails or is slow. Conversation settings cover who speaks first, when to reply,
 * interruptions, backchannel, noise, voicemail and call length.
 */
@Component({
  selector: 'app-engine-panel',
  standalone: true,
  imports: [FormsModule, IconComponent, HintComponent],
  template: `
    @if (showModels && presets().length) {
      <section class="ep-sec">
        <div class="ep-title">Preset <app-hint text="Each preset sets a primary and a fallback model for listening, thinking and speaking, plus turn detection. Costs are from vendor pricing pages (checked 1 Oct 2026); latency marked estimate is to be measured."></app-hint></div>
        <div class="ep-presets" role="radiogroup" aria-label="Preset">
          @for (pr of presets(); track pr.key) {
            <button type="button" role="radio" [attr.aria-checked]="v().preset === pr.key" [class.on]="v().preset === pr.key" (click)="usePreset(pr)">
              <b>{{ pr.label }}</b><small>{{ pr.sub }}</small>
              @if (pr.metrics) { <span class="ep-pm"><app-icon name="timer" [size]="11"></app-icon> {{ first(pr.metrics.latency) }} · {{ first(pr.metrics.cost) }}</span> }
            </button>
          }
        </div>
      </section>
    }
    @if (showModels) {
      <section class="ep-sec">
        <div class="ep-title">How the agent hears and speaks <app-hint text="Voice to voice: one model hears and answers directly; quickest and most natural. Sandwich: separate listen, think and speak models; more control over each step, languages and voices."></app-hint></div>
        <div class="ep-arch" role="radiogroup" aria-label="Architecture">
          <button type="button" role="radio" [attr.aria-checked]="v().mode === 's2s'" [class.on]="v().mode === 's2s'" (click)="set({ mode: 's2s' })">
            <span class="ep-flow"><i><app-icon name="wave" [size]="13"></app-icon></i></span>
            <b>Voice to voice</b><small>One model hears and speaks</small>
          </button>
          <button type="button" role="radio" [attr.aria-checked]="v().mode === 'pipeline'" [class.on]="v().mode === 'pipeline'" (click)="set({ mode: 'pipeline' })">
            <span class="ep-flow"><i><app-icon name="ear" [size]="13"></app-icon></i><em></em><i><app-icon name="brain" [size]="13"></app-icon></i><em></em><i><app-icon name="speak" [size]="13"></app-icon></i></span>
            <b>Sandwich</b><small>Listen, think, speak</small>
          </button>
        </div>

        @if (v().mode === 's2s') {
          <div class="ep-grid">
            <label class="field"><span class="field-label">Model</span>
              <select class="select" [ngModel]="v().s2s" (ngModelChange)="set({ s2s: $event, voice: '' })">
                @for (g of grouped('s2s'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }
              </select></label>
            <label class="field"><span class="field-label">Voice</span>
              <select class="select" [ngModel]="v().voice" (ngModelChange)="set({ voice: $event })">
                <option value="">Model default</option>
                @for (x of voicesOf('s2s', v().s2s); track x) { <option [value]="x">{{ x }}</option> }
              </select></label>
            <label class="field"><span class="field-label">Language <app-hint text="Main language of the call. The model still follows a caller who switches."></app-hint></span>
              <select class="select" [ngModel]="v().language" (ngModelChange)="set({ language: $event })">@for (l of LANGS; track l[0]) { <option [value]="l[0]">{{ l[1] }}</option> }</select></label>
            <label class="field"><span class="field-label">Creativity <app-hint text="Temperature. Lower keeps answers steady and literal; higher sounds looser."></app-hint> <span class="mono ep-val">{{ v().temperature }}</span></span>
              <input type="range" min="0" max="1" step="0.1" [ngModel]="v().temperature" (ngModelChange)="set({ temperature: +$event })" aria-label="Creativity" /></label>
          </div>
        } @else {
          <div class="ep-steps">
            <div class="ep-step">
              <span class="ep-step-k"><app-icon name="ear" [size]="14"></app-icon> Listen</span>
              <select class="select" [ngModel]="v().stt" (ngModelChange)="set({ stt: $event })" aria-label="Speech to text model">
                @for (g of grouped('stt'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }
              </select>
              <select class="select" [ngModel]="v().language" (ngModelChange)="set({ language: $event })" aria-label="Language">@for (l of LANGS; track l[0]) { <option [value]="l[0]">{{ l[1] }}</option> }</select>
              <span class="ep-fb-k">Fallback</span>
              <select class="select ep-fb" [ngModel]="v().stt_fallback || ''" (ngModelChange)="set({ stt_fallback: $event, preset: 'custom' })" aria-label="Listen fallback"><option value="">None</option>@for (g of grouped('stt'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }</select>
            </div>
            <div class="ep-step">
              <span class="ep-step-k"><app-icon name="brain" [size]="14"></app-icon> Think</span>
              <select class="select" [ngModel]="v().llm" (ngModelChange)="set({ llm: $event })" aria-label="Language model">
                @for (g of grouped('llm'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }
              </select>
              <span class="ep-pair">
                <label title="Temperature: lower is steadier"><span class="row-sub">Creativity {{ v().temperature }}</span><input type="range" min="0" max="1" step="0.1" [ngModel]="v().temperature" (ngModelChange)="set({ temperature: +$event })" aria-label="Creativity" /></label>
                <label title="Longest reply in tokens"><span class="row-sub">Max reply</span><input class="input input-sm" type="number" min="50" max="2000" step="50" [ngModel]="v().max_tokens" (ngModelChange)="set({ max_tokens: +$event || 300 })" aria-label="Max reply tokens" /></label>
              </span>
            </div>
            <div class="ep-step">
              <span class="ep-step-k"><app-icon name="speak" [size]="14"></app-icon> Speak</span>
              <select class="select" [ngModel]="v().tts" (ngModelChange)="set({ tts: $event, voice: '' })" aria-label="Text to speech model">
                @for (g of grouped('tts'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }
              </select>
              <span class="ep-pair">
                <select class="select" [ngModel]="v().voice" (ngModelChange)="set({ voice: $event })" aria-label="Voice">
                  <option value="">Model default</option>
                  @for (x of voicesOf('tts', v().tts); track x) { <option [value]="x">{{ x }}</option> }
                </select>
                <label title="Speaking speed"><span class="row-sub">Speed {{ v().speed }}×</span><input type="range" min="0.7" max="1.3" step="0.05" [ngModel]="v().speed" (ngModelChange)="set({ speed: +$event })" aria-label="Speed" /></label>
              </span>
              <span class="ep-fb-k">Fallback</span>
              <select class="select ep-fb" [ngModel]="v().tts_fallback || ''" (ngModelChange)="set({ tts_fallback: $event, preset: 'custom' })" aria-label="Speak fallback"><option value="">None</option>@for (g of grouped('tts'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</optgroup> }</select>
            </div>
          </div>
        }
      </section>
    }

    <section class="ep-sec">
        <div class="ep-title">Model switching <app-hint text="If the main model errors, times out or answers slower than the limit, the call carries on with the backup model. The caller hears no gap beyond the limit."></app-hint></div>
        <div class="ep-grid">
          <label class="field"><span class="field-label">Backup model</span>
            <select class="select" [ngModel]="v().fallback" (ngModelChange)="set({ fallback: $event })">
              <option value="">No backup</option>
              @for (g of grouped(v().mode === 's2s' ? 's2s' : 'llm'); track g.vendor) { <optgroup [label]="g.vendor">@for (m of g.models; track m.id) { @if (m.id !== (v().mode === 's2s' ? v().s2s : v().llm)) { <option [value]="m.id">{{ m.label }}</option> } }</optgroup> }
            </select></label>
          <label class="field"><span class="field-label">Switch when slower than (ms)</span>
            <input class="input" type="number" min="500" max="10000" step="250" [ngModel]="v().fallback_after_ms" (ngModelChange)="set({ fallback_after_ms: +$event || 2500 })" [disabled]="!v().fallback" /></label>
        </div>
      </section>

    <section class="ep-sec">
      <div class="ep-title">Conversation</div>
      <div class="ep-grid">
        <label class="field"><span class="field-label">Turn detection <app-hint [text]="turnNote()"></app-hint></span>
          <select class="select" [ngModel]="v().turn_detector || 'off'" (ngModelChange)="set({ turn_detector: $event })">@for (t of turnDetectors(); track t.id) { <option [value]="t.id">{{ t.label }}</option> }</select></label>
        <label class="field"><span class="field-label">Speaks first <app-hint text="Agent: the agent greets as soon as the call connects. Caller: the agent waits for the first hello."></app-hint></span>
          <div class="seg"><button type="button" [class.on]="t().first === 'agent'" (click)="setTurn({ first: 'agent' })">Agent</button><button type="button" [class.on]="t().first === 'caller'" (click)="setTurn({ first: 'caller' })">Caller</button></div></label>
        <label class="field"><span class="field-label">Interruptions <app-hint text="How easily the caller can cut in. High stops the agent at the first word; Off lets the agent finish."></app-hint></span>
          <div class="seg">@for (o of INTERRUPT; track o) { <button type="button" [class.on]="t().interruption === o" (click)="setTurn({ interruption: o })">{{ o[0].toUpperCase() + o.slice(1) }}</button> }</div></label>
        <label class="field"><span class="field-label">Reply after silence <app-hint text="How long the caller must pause before the agent answers. Lower feels faster; too low cuts people off."></app-hint> <span class="mono ep-val">{{ t().endpoint_ms }} ms</span></span>
          <input type="range" min="200" max="2000" step="50" [ngModel]="t().endpoint_ms" (ngModelChange)="setTurn({ endpoint_ms: +$event })" aria-label="Reply after silence" /></label>
        <label class="field"><span class="field-label">Voicemail <app-hint text="What to do when an answering machine picks up. The call status becomes Voicemail either way."></app-hint></span>
          <select class="select" [ngModel]="t().voicemail" (ngModelChange)="setTurn({ voicemail: $event })"><option value="hangup">Hang up</option><option value="message">Leave a short message</option><option value="ignore">Carry on</option></select></label>
        <label class="field"><span class="field-label">End after silence (s) <app-hint text="Hang up when nobody speaks for this long."></app-hint></span>
          <input class="input" type="number" min="5" max="120" [ngModel]="t().silence_end_s" (ngModelChange)="setTurn({ silence_end_s: +$event || 20 })" /></label>
        <label class="field"><span class="field-label">Longest call (min)</span>
          <input class="input" type="number" min="1" max="60" [ngModel]="t().max_minutes" (ngModelChange)="setTurn({ max_minutes: +$event || 10 })" /></label>
      </div>
      <div class="ep-toggles">
        <label class="ep-tog"><span class="switch"><input type="checkbox" [checked]="t().backchannel" (change)="setTurn({ backchannel: $any($event.target).checked })" /><i></i></span> Small acknowledgements <app-hint text="The agent says short things like 'mm-hmm' or 'okay' while the caller talks, so it sounds engaged."></app-hint></label>
        <label class="ep-tog"><span class="switch"><input type="checkbox" [checked]="t().noise" (change)="setTurn({ noise: $any($event.target).checked })" /><i></i></span> Background noise filter <app-hint text="Removes traffic, fans and crowd noise before the agent listens. Leave on for phone calls."></app-hint></label>
      </div>
    </section>
  `,
  styles: [`
    :host { display: grid; gap: 18px; }
    .ep-sec { display: grid; gap: 10px; }
    .ep-presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .ep-presets button { display: grid; justify-items: start; gap: 2px; padding: 10px 12px; border: 1px solid var(--ds-border); border-radius: var(--ds-r-lg); background: var(--ds-surface); cursor: pointer; text-align: left; font: inherit; color: var(--ds-text); }
    .ep-presets button:hover { border-color: var(--ds-border-input); }
    .ep-presets button.on { border-color: var(--ds-text); box-shadow: inset 0 0 0 1px var(--ds-text); }
    .ep-presets small { color: var(--ds-text-muted); font-size: var(--ds-fs-sm); }
    .ep-pm { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: var(--ds-fs-xs); color: var(--ds-text-muted); }
    .ep-fb-k { font-size: var(--ds-fs-xs); color: var(--ds-text-muted); text-align: right; }
    .ep-fb { min-height: var(--ds-control-sm); font-size: var(--ds-fs-sm); }
    .ep-title { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); display: flex; align-items: center; }
    .ep-arch { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ep-arch button { display: grid; justify-items: start; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); cursor: pointer; text-align: left; font: inherit; color: var(--ink); }
    .ep-arch button:hover { border-color: var(--ink-3); }
    .ep-arch button.on { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    .ep-arch small { color: var(--muted); font-size: 12px; }
    .ep-flow { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
    .ep-flow i { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; background: var(--raised); border: 1px solid var(--line); color: var(--ink-3); }
    .ep-flow em { width: 10px; height: 1px; background: var(--line-strong); }
    .ep-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 12px; }
    .ep-steps { display: grid; gap: 8px; }
    .ep-step { display: grid; grid-template-columns: 76px minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: center; grid-auto-rows: auto; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
    .ep-step-k { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ink-3); }
    .ep-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: center; }
    .ep-pair label { display: grid; gap: 2px; }
    .input-sm { padding: 5px 8px; }
    .ep-val { margin-left: auto; font-size: 11px; color: var(--muted); }
    .ep-toggles { display: flex; gap: 18px; flex-wrap: wrap; }
    .ep-tog { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
    input[type=range] { width: 100%; accent-color: var(--red); }
    @media (max-width: 640px) { .ep-step { grid-template-columns: 1fr; } .ep-arch { grid-template-columns: 1fr; } }
  `],
})
export class EnginePanelComponent {
  /** Model catalogue from agent meta: { s2s, stt, llm, tts } lists of { id, label, vendor, voices }. */
  /** Kept in a signal too, so the preset list updates when the catalogue arrives. */
  private cat = signal<Record<string, any>>({});
  private _catalog: Record<string, Model[]> = {};
  @Input() set catalog(c: Record<string, Model[]>) { this._catalog = c || {}; this.cat.set(c || {}); }
  get catalog(): Record<string, Model[]> { return this._catalog; }
  @Input() set value(x: Partial<EngineConfig> | null) { this.v.set(merge(x)); }
  /** False on the agent page, where models are picked through presets; then switching and conversation settings show. */
  @Input() showModels = true;
  @Output() valueChange = new EventEmitter<EngineConfig>();

  readonly LANGS = [['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['hinglish', 'Hinglish'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'], ['gu-IN', 'Gujarati'], ['kn-IN', 'Kannada'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar', 'Arabic'], ['es', 'Spanish']];
  readonly INTERRUPT = ['off', 'low', 'medium', 'high'] as const;
  v = signal<EngineConfig>(merge(null));
  t = computed(() => this.v().turn);

  grouped(kind: string): { vendor: string; models: Model[] }[] {
    const m = new Map<string, Model[]>();
    for (const x of this.catalog?.[kind] || []) m.set(x.vendor, [...(m.get(x.vendor) || []), x]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([vendor, models]) => ({ vendor, models }));
  }
  voicesOf(kind: string, id: string): string[] { return (this.catalog?.[kind] || []).find((x) => x.id === id)?.voices || []; }
  presets = computed(() => (this.cat()?.['presets'] || []).filter((p: any) => p.key !== 'custom'));
  turnDetectors = computed(() => this.cat()?.['turn_detectors'] || [{ id: 'off', label: 'Off: use the model', note: '' }]);
  turnNote(): string { return this.turnDetectors().find((t: any) => t.id === (this.v().turn_detector || 'off'))?.note || 'How the agent decides the caller has finished.'; }
  first(x: string): string { return String(x).split(/ \(|;| per call/)[0]; }
  usePreset(pr: any): void { this.set({ ...pr.engine, preset: pr.key, voice: pr.engine.voice || '' }); }
  set(c: Partial<EngineConfig>): void { this.v.update((x) => ({ ...x, ...c })); this.valueChange.emit(this.v()); }
  setTurn(c: Partial<TurnConfig>): void { this.set({ turn: { ...this.t(), ...c } }); }
}

function merge(x: Partial<EngineConfig> | null): EngineConfig {
  return { ...DEFAULT_ENGINE, ...Object.fromEntries(Object.entries(x || {}).filter(([, v]) => v !== '' && v != null)), turn: { ...DEFAULT_TURN, ...(x?.turn || {}) } } as EngineConfig;
}
