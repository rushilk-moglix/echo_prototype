import { Component, inject, signal, computed, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EnginePanelComponent } from '../../components/engine-panel/engine-panel.component';
import { StatusPickerComponent } from '../../components/status-picker/status-picker.component';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { PromptPreviewComponent } from './prompt-preview.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { HintComponent } from '../../components/hint/hint.component';
import { mergeFieldLines } from '../../utils/merge-fields';
import { toDoc, fromDoc } from '../../utils/prompt-doc';
import { fmtAgo } from '../../utils/format';
import { CALL_STATUSES, statusHover } from '../../utils/status';

const IN_COLS = '1.4fr 130px 130px 1.4fr 90px 36px';
const OUT_COLS = '1fr 1fr 110px 1.2fr 1.4fr 50px 36px';

const blankInput = () => ({ key: '', sample: '', type: 'string', transform: '', share_on_call: true });
const blankOutput = () => ({ key: '', label: '', description: '', type: 'string', options: [], required: true });
const blankSection = () => ({ id: '', title: '', body: '', kind: 'text', enabled: true });
const patch = (list: any[], i: number, changes: any) => list.map((r, idx) => (idx === i ? { ...r, ...changes } : r));
const move = (list: any[], from: number, to: number) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

interface Settings { label: string; description: string; voice: string; ozonetel_campaign: string; primary_id_key: string; }
/** How rows of a file become calls (PRD-ECHO-19 section 4). */
interface InputPlan { mode: 'row' | 'group'; group_by: string; call_columns: string[]; row_columns: string[]; order_by: string; order_dir: 'asc' | 'desc'; max_rows: number; overflow: 'split' | 'cap'; answers_key: string; }
interface Engine { preset: string; mode: 's2s' | 'pipeline'; s2s: string; stt: string; llm: string; tts: string; fallback?: string; fallback_after_ms?: number; turn?: any; stt_fallback?: string; tts_fallback?: string; realtime_alt?: string; turn_detector?: string; voice?: string; }
interface Rules { retry: { tries: number; gap_minutes: number; on: string[]; answer_field: string; answer_values: string[] }; sync_target: { type: string; url: string }; lookups: any[]; engine: Engine; }
const blankPlan = (): InputPlan => ({ mode: 'row', group_by: '', call_columns: [], row_columns: [], order_by: '', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: '' });
const blankRules = (): Rules => ({ retry: { tries: 3, gap_minutes: 60, on: ['no_answer', 'busy', 'unreachable', 'network_error', 'call_dropped', 'no_reply', 'voicemail', 'caller_hung_up'], answer_field: '', answer_values: [] }, sync_target: { type: 'none', url: '' }, lookups: [], engine: { preset: 'natural', mode: 's2s', s2s: '', stt: '', llm: '', tts: '' } });
const blankLookup = () => ({ name: '', when: 'before', url: '', send: [] as string[], returns: '', timeout_s: 3, fallback: 'Let me check and get back to you.' });

/**
 * Agent editor.
 *
 * Everything on the page (prompt, call data, answers, settings) is one draft with
 * one Save. The old editor had a save per tab and reloaded the agent after each,
 * which replaced unsaved prompt text with the stored copy. Now nothing reloads
 * until every changed part is saved, and leaving with changes asks first.
 *
 * The prompt can be edited as blocks (sections) or as one document (Full). Both
 * edit the same list of sections; see utils/prompt-doc.ts.
 */
@Component({
  selector: 'app-agent-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, EnginePanelComponent, StatusPickerComponent, IconComponent, PromptPreviewComponent, ConfirmComponent, GuideComponent, HintComponent],
  templateUrl: './agent-detail.component.html',
})
export class AgentDetailComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  key = '';
  IN_COLS = IN_COLS;
  OUT_COLS = OUT_COLS;
  /** Matches VOICE_AGENT_VOICE in the backend: what an empty selection resolves to. */
  DEFAULT_VOICE = 'Aoede';
  ago = fmtAgo;

  agent = signal<any>(null);
  meta = signal<any>(null);
  tab = signal<'prompt' | 'inputs' | 'outputs' | 'settings'>('prompt');
  mode = signal<'blocks' | 'full'>(this.savedMode());
  error = signal('');
  toast = signal('');
  busy = signal(false);

  sections = signal<any[]>([]);
  doc = signal('');
  generated = signal<any>({});
  generatedError = signal('');
  preview = signal<any>(null);
  copied = signal<number | null>(null);
  private copiedTimer: any = null;
  private toastTimer: any = null;

  inputs = signal<any[]>([]);
  outputs = signal<any[]>([]);
  settings = signal<Settings>({ label: '', description: '', voice: '', ozonetel_campaign: '', primary_id_key: '' });
  oznCampaigns = signal<any[]>([]);
  /** Enabled flows, grouped by provider for the dropdown. */
  flowGroups = computed(() => {
    const m = new Map<string, any[]>();
    for (const c of this.oznCampaigns()) { const k = c.provider_label || 'Telephony'; m.set(k, [...(m.get(k) || []), c]); }
    return [...m].map(([label, flows]) => ({ label, flows }));
  });
  flowOn = computed(() => !this.settings().ozonetel_campaign || this.oznCampaigns().some((c) => c.name === this.settings().ozonetel_campaign));
  syncPlatforms = signal<{ platform_key: string; label: string; connected?: boolean; needs_url?: boolean }[]>([]);
  plan = signal<InputPlan>(blankPlan());
  rules = signal<Rules>(blankRules());
  references = signal<any[]>([]);
  fileCheck = signal<any>(null);
  fileChecking = signal(false);
  refScope = signal<'campaign' | 'agent'>('campaign');
  /** Outcomes a user may choose to retry; Completed, Wrong number and Blocked are never retried. */
  /** Any final call status can be chosen; the defaults are the ones marked to retry. */
  readonly RETRYABLE = CALL_STATUSES.filter((s) => s.group !== 'in_progress' && s.group !== 'not_dialled').map((s) => ({ key: s.key, label: s.label, hover: statusHover(s.key) }));
  grouped = computed(() => this.plan().mode === 'group');
  inputKeys = computed(() => this.inputs().map((v) => v.key).filter(Boolean));
  onceCols = computed(() => this.inputKeys().filter((k) => this.roleOf(k) === 'call'));
  rowCols = computed(() => this.inputKeys().filter((k) => this.roleOf(k) === 'row'));
  phoneKey = computed(() => this.inputs().find((v) => v.type === 'phone')?.key || '');
  listOutputs = computed(() => this.outputs().filter((v) => v.type === 'list'));
  rowAnswers = computed(() => this.outputs().find((v) => v.key === this.plan().answers_key && v.type === 'list') || this.listOutputs()[0] || null);
  answerOptions = computed(() => this.outputs().find((v) => v.key === this.rules().retry.answer_field)?.options || []);
  /** Where each column goes on a grouped call: once for the whole call, or read out per row. */
  roleOf(k: string): 'call' | 'row' {
    const p = this.plan();
    if (k === p.group_by || k === this.phoneKey()) return 'call';
    return p.row_columns.includes(k) ? 'row' : 'call';
  }

  confirmDelete = signal(false);
  leaveAsk = signal(false);
  private leaveResolve: ((ok: boolean) => void) | null = null;

  /** The last saved state, normalized the same way as the draft for comparison. */
  private saved = signal<string>('');

  voiceOptions = computed(() => {
    const all = (this.meta()?.voices || []).filter((v: any) => v.provider === 'gemini');
    return [...all].sort((a: any, b: any) =>
      a.name === this.DEFAULT_VOICE ? -1 : b.name === this.DEFAULT_VOICE ? 1 : a.name.localeCompare(b.name),
    );
  });

  genderOf(name: string): string {
    return (this.meta()?.voices || []).find((v: any) => v.name === name)?.gender || '';
  }

  tokens = computed(() => {
    const s = this.sections().filter(x => x.kind === 'text' && x.enabled !== false);
    const matches = s.flatMap(x => (x.body || '').match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || []);
    return [...new Set(matches.map(t => t.replace(/[{}\s]/g, '')))];
  });

  undeclared = computed(() => {
    const declared = new Set(this.inputs().map(v => v.key));
    const reserved = new Set((this.meta()?.placeholders || []).map((x: any) => x.name));
    const derived = new Set(this.generated().derived || []);
    return this.tokens().filter(t => !declared.has(t) && !reserved.has(t) && !derived.has(t));
  });

  /** Which parts differ from what is saved. */
  changes = computed(() => {
    if (!this.saved()) return [] as string[];
    const was = JSON.parse(this.saved());
    const now = this.draft();
    const parts: string[] = [];
    if (JSON.stringify(now.sections) !== JSON.stringify(was.sections)) parts.push('prompt');
    if (JSON.stringify(now.inputs) !== JSON.stringify(was.inputs)) parts.push('call data');
    if (JSON.stringify(now.outputs) !== JSON.stringify(was.outputs)) parts.push('answers');
    if (JSON.stringify(now.settings) !== JSON.stringify(was.settings)) parts.push('settings');
    if (JSON.stringify(now.plan) !== JSON.stringify(was.plan)) parts.push('input file');
    if (JSON.stringify(now.rules) !== JSON.stringify(was.rules) && !parts.includes('settings')) parts.push('settings');
    return parts;
  });
  dirty = computed(() => this.changes().length > 0);

  checklist = computed(() => {
    const promptChars = this.sections().filter(s => s.enabled !== false && s.kind === 'text').reduce((n, s) => n + (s.body || '').trim().length, 0);
    type Tab = 'prompt' | 'inputs' | 'outputs' | 'settings';
    const items: { label: string; ok: boolean; tab: Tab; fix: string }[] = [
      { label: 'Prompt', ok: promptChars > 0, tab: 'prompt', fix: 'Write what the agent says and does' },
      { label: 'Call data', ok: this.inputs().some(v => v.key), tab: 'inputs', fix: 'Add at least one column the call uses' },
      { label: 'Answers', ok: this.outputs().some(v => v.key), tab: 'outputs', fix: 'Add at least one answer to collect' },
      { label: 'Calling flow', ok: !!this.settings().ozonetel_campaign && this.flowOn(), tab: 'settings', fix: 'Pick a calling flow that is turned on in Settings' },
      ...(this.grouped() ? [{ label: 'Answer for each row', ok: !!this.rowAnswers(), tab: 'outputs' as Tab, fix: 'Add a list answer so each row gets its own result' }] : []),
    ];
    return items;
  });
  checkDone = computed(() => this.checklist().filter(c => c.ok).length);
  /** Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern). */
  tabKeys(e: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault(); tabs[n].click(); tabs[n].focus();
  }

  syncLabel = computed(() => {
    const a = this.agent();
    if (!a || !this.syncPlatforms().length) return null;
    const platform = this.syncPlatforms().find((p) => p.platform_key === a.synced_platform)?.label || '';
    if (!a.synced_platform) return { text: 'Results stay in Echo', cls: 'muted' };
    if (a.sync_status === 'failed') return { text: `${platform}: sync failed`, cls: 'bad' };
    if (a.sync_status === 'pending') return { text: `${platform}: syncing`, cls: 'info' };
    if (a.synced_at && a.updated_at && a.updated_at > a.synced_at) return { text: `${platform}: changes waiting`, cls: 'warn' };
    return { text: `In sync with ${platform}`, cls: 'ok' };
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.key = params.get('key') || '';
      if (this.key) { this.load(); this.loadGenerated(); }
    });
    this.api.ozonetelCampaigns(true).then(r => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    const orgId = this.auth.currentOrgId();
    if (orgId) this.api.orgSyncPlatforms(orgId).then(p => this.syncPlatforms.set(p || [])).catch(() => this.syncPlatforms.set([]));
  }

  ngOnDestroy(): void { clearTimeout(this.toastTimer); clearTimeout(this.copiedTimer); }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (this.dirty()) { e.preventDefault(); e.returnValue = ''; }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (this.dirty()) this.save(); }
  }

  /** Router guard hook (see app.routes.ts). Asks in-app before dropping changes. */
  canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveAsk.set(true);
    return new Promise<boolean>(resolve => { this.leaveResolve = resolve; });
  }
  answerLeave(ok: boolean): void {
    this.leaveAsk.set(false);
    this.leaveResolve?.(ok);
    this.leaveResolve = null;
  }

  async load(): Promise<void> {
    try {
      const [d, m] = await Promise.all([this.api.agentDetail(this.key), this.api.agentMeta()]);
      const a = d.agent;
      this.agent.set(a);
      this.meta.set(m);
      this.inputs.set(structuredClone(a.input_variables || []));
      this.outputs.set(structuredClone(a.output_variables || []));
      this.sections.set(structuredClone(a.sections || []));
      this.settings.set({
        label: a.label || '', description: a.description || '', voice: a.voice || '',
        ozonetel_campaign: a.ozonetel_campaign || '', primary_id_key: a.primary_id_key || '',
      });
      this.plan.set({ ...blankPlan(), ...structuredClone(a.input_plan || {}) });
      this.rules.set({ ...blankRules(), retry: { ...blankRules().retry, ...(a.retry || {}) },
        sync_target: { ...blankRules().sync_target, ...(a.sync_target || {}) }, lookups: structuredClone(a.lookups || []), engine: { ...blankRules().engine, ...(a.engine || {}) } });
      this.references.set(a.references || []);
      this.doc.set(toDoc(this.sections()));
      this.saved.set(JSON.stringify(this.draft()));
      this.error.set('');
    } catch (e: any) { this.error.set(e.message); }
  }

  async loadGenerated(): Promise<any> {
    try {
      const fresh = await this.api.agentGenerated(this.key);
      this.generated.set(fresh);
      this.generatedError.set('');
      return fresh;
    } catch (e: any) {
      this.generated.set({});
      this.generatedError.set(e.message);
      return null;
    }
  }

  /** The draft in saved form: generated blocks left exactly as generated count as empty. */
  private draft() {
    const sections = this.sections().map(sec => {
      if (!this.isGenerated(sec)) return { ...sec };
      const body = (sec.body || '').trim();
      const asGenerated = (this.generated()[sec.kind] || '').trim();
      return body && body === asGenerated ? { ...sec, body: '' } : { ...sec };
    });
    return { sections, inputs: this.inputs(), outputs: this.outputs(), settings: this.settings(), plan: this.plan(), rules: this.rules() };
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    const parts = this.changes();
    if (!parts.length) return;
    const d = this.draft();
    this.busy.set(true); this.error.set('');
    try {
      // Variables first, so the prompt's generated blocks are built from the new ones.
      if (parts.includes('call data')) await this.api.saveAgentInputs(this.key, d.inputs);
      const was = JSON.parse(this.saved());
      if (parts.includes('input file') || JSON.stringify(d.rules) !== JSON.stringify(was.rules)) {
        await this.api.updateAgent(this.key, { input_plan: d.plan, retry: d.rules.retry, sync_target: d.rules.sync_target, lookups: d.rules.lookups, engine: d.rules.engine });
      }
      if (parts.includes('answers')) await this.api.saveAgentOutputs(this.key, d.outputs);
      if (parts.includes('prompt')) await this.api.saveAgentSections(this.key, d.sections);
      if (parts.includes('settings')) {
        const s = d.settings;
        await this.api.updateAgent(this.key, {
          label: s.label.trim() || this.agent().label, description: s.description, voice: s.voice,
          ozonetel_campaign: s.ozonetel_campaign,
          ozonetel_type: this.oznCampaigns().find(c => c.name === s.ozonetel_campaign)?.type || '',
          primary_id_key: s.primary_id_key, primary_id_label: s.primary_id_key,
        });
      }
      await Promise.all([this.load(), this.loadGenerated()]);
      this.say(`Saved ${parts.join(', ')}. Live on the next call.`);
    } catch (e: any) {
      this.error.set(`Not saved: ${e.message}. Your changes are still here.`);
    } finally {
      this.busy.set(false);
    }
  }

  discard(): void {
    const was = JSON.parse(this.saved());
    this.sections.set(was.sections);
    this.inputs.set(was.inputs);
    this.outputs.set(was.outputs);
    this.settings.set(was.settings);
    this.plan.set(was.plan);
    this.rules.set(was.rules);
    this.doc.set(toDoc(was.sections));
    this.say('Changes discarded.');
  }

  // Prompt modes
  setMode(m: 'blocks' | 'full'): void {
    if (m === this.mode()) return;
    if (m === 'full') this.doc.set(toDoc(this.sections()));
    this.mode.set(m);
    try { localStorage.setItem('echo.promptMode', m); } catch { /* private mode */ }
  }
  private savedMode(): 'blocks' | 'full' {
    try { return localStorage.getItem('echo.promptMode') === 'full' ? 'full' : 'blocks'; } catch { return 'blocks'; }
  }
  onDocInput(text: string): void {
    this.doc.set(text);
    this.sections.set(fromDoc(text, this.sections()));
  }

  async showPreview(): Promise<void> {
    this.error.set('');
    try { this.preview.set(await this.api.previewAgentPrompt(this.key, { sections: this.sections() })); }
    catch (e: any) { this.error.set(e.message); this.preview.set(null); }
  }

  async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteAgent(this.key);
      this.saved.set(JSON.stringify(this.draft())); // nothing left to protect
      this.router.navigate(['/agents']);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); this.confirmDelete.set(false); }
  }

  async clone(): Promise<void> {
    this.busy.set(true);
    try {
      const a = this.agent();
      const out = await this.api.createAgent({
        label: `${a.label} (copy)`, description: a.description || '', copy_from: this.key,
        ozonetel_campaign: a.ozonetel_campaign || '', ozonetel_type: a.ozonetel_type || '',
      });
      this.router.navigate(['/agents', out.agent.key]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }

  async syncNow(): Promise<void> {
    const p = this.syncPlatforms().find((x) => x.platform_key === this.agent()?.synced_platform);
    if (!p) return;
    try {
      await this.api.syncAgent(this.key, p.platform_key);
      this.agent.update(a => ({ ...a, synced_platform: p.platform_key, sync_status: 'pending' }));
      this.say(`Sending to ${p.label}…`);
      setTimeout(() => this.refreshAgentHeader(), 2500);
    } catch (e: any) {
      this.say(/409|already/i.test(e.message) ? `Already in sync with ${p.label}.` : `Sync failed: ${e.message}`);
    }
  }
  private async refreshAgentHeader(): Promise<void> {
    try { const d = await this.api.agentDetail(this.key); this.agent.update(a => ({ ...a, ...pickSync(d.agent) })); } catch { /* keep */ }
  }

  api_templateUrl(): string { return this.api.agentTemplateUrl(this.key); }
  testCall(): void { this.router.navigate(['/console'], { queryParams: { agent: this.key } }); }
  goBack(): void { this.router.navigate(['/agents']); }

  // Section tools
  patchSection(i: number, changes: any): void { this.sections.update(s => patch(s, i, changes)); }
  moveSection(i: number, dir: number): void { this.sections.update(s => move(s, i, i + dir)); }
  deleteSection(i: number): void { this.sections.update(s => s.filter((_, idx) => idx !== i)); }
  addSection(kind: string, title: string): void {
    this.sections.update(s => [...s, { ...blankSection(), kind, title: title || '' }]);
  }
  sectionText(sec: any): string {
    const body = (sec.body || '').trim();
    if (body) return body;
    return (sec.kind === 'input' || sec.kind === 'output') ? (this.generated()[sec.kind] || '') : '';
  }

  async copySection(i: number, sec: any): Promise<void> {
    const text = this.sectionText(sec);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
    this.copied.set(i);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 1400);
  }

  async refreshSection(i: number, sec: any, overridden: boolean): Promise<void> {
    const fresh = await this.loadGenerated();
    if (!overridden || !fresh?.[sec.kind]) return;
    this.patchSection(i, { body: mergeFieldLines(sec.body || '', fresh[sec.kind]) });
  }

  // Call data and answers
  patchInput(i: number, changes: any): void { this.inputs.update(v => patch(v, i, changes)); }
  deleteInput(i: number): void { this.inputs.update(v => v.filter((_, idx) => idx !== i)); }
  addInput(): void { this.inputs.update(v => [...v, blankInput()]); }
  patchOutput(i: number, changes: any): void { this.outputs.update(v => patch(v, i, changes)); }
  deleteOutput(i: number): void { this.outputs.update(v => v.filter((_, idx) => idx !== i)); }
  addOutput(): void { this.outputs.update(v => [...v, blankOutput()]); }
  readonly SUB_TYPES = ['string', 'number', 'date', 'boolean', 'enum'];
  readonly SUB_COLS = '180px 140px 1fr 40px';
  patchSub(i: number, j: number, changes: any): void {
    this.outputs.update(v => patch(v, i, { fields: patch(v[i].fields || [], j, changes) }));
  }
  addSub(i: number): void { this.outputs.update(v => patch(v, i, { fields: [...(v[i].fields || []), { key: '', type: 'string', options: [] }] })); }
  deleteSub(i: number, j: number): void { this.outputs.update(v => patch(v, i, { fields: (v[i].fields || []).filter((_: any, k: number) => k !== j) })); }
  setSubOptions(i: number, j: number, val: string): void { this.patchSub(i, j, { options: val.split(',').map(s => s.trim()).filter(Boolean) }); }
  setOptions(i: number, val: string): void {
    this.patchOutput(i, { options: val.split(',').map(s => s.trim()).filter(Boolean) });
  }
  patchSettings(changes: Partial<Settings>): void { this.settings.update(s => ({ ...s, ...changes })); }

  isGenerated(sec: any): boolean { return sec.kind === 'input' || sec.kind === 'output'; }
  sectionValue(sec: any): string {
    return sec.body || (this.isGenerated(sec) ? (this.generated()[sec.kind] || '') : '');
  }

  // ── Input file (how rows become calls) ────────────────────────────────────
  patchPlan(c: Partial<InputPlan>): void {
    this.plan.update((p) => {
      const next = { ...p, ...c };
      if (c.mode === 'group' && !next.group_by) next.group_by = this.phoneKey();
      if (c.mode === 'group' && !next.answers_key) next.answers_key = this.listOutputs()[0]?.key || '';
      return next;
    });
    this.fileCheck.set(null);
  }
  setRole(k: string, role: 'call' | 'row'): void {
    this.plan.update((p) => {
      const rows = p.row_columns.filter((x) => x !== k);
      const calls = p.call_columns.filter((x) => x !== k);
      return role === 'row' ? { ...p, row_columns: [...rows, k], call_columns: calls } : { ...p, row_columns: rows, call_columns: [...calls, k] };
    });
  }
  /** Adds the list answer the agent fills once per row, starting with the row number. */
  addRowAnswers(): void {
    const key = this.outputs().some((v) => v.key === 'rows') ? `rows_${this.outputs().length}` : 'rows';
    this.outputs.update((v) => [...v, { key, label: 'Answer for each row', type: 'list', required: true, description: 'One entry per row on the call, covered or not',
      fields: [{ key: 'row', type: 'number', options: [] }, { key: 'status', type: 'enum', options: ['done', 'not_covered'] }] }]);
    this.patchPlan({ answers_key: key });
    this.tab.set('outputs');
  }
  async checkFile(file?: File): Promise<void> {
    if (!file) return;
    this.fileChecking.set(true); this.error.set('');
    try { this.fileCheck.set(await this.api.checkAgentFile(this.key, file, this.plan())); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.fileChecking.set(false); }
  }

  // ── Calling rules, results destination, lookups ───────────────────────────
  patchRules(c: Partial<Rules>): void { this.rules.update((r) => ({ ...r, ...c })); }
  patchRetry(c: any): void { this.rules.update((r) => ({ ...r, retry: { ...r.retry, ...c } })); }
  patchTarget(c: any): void { this.rules.update((r) => ({ ...r, sync_target: { ...r.sync_target, ...c } })); }
  fieldList(v: any): string { return (v?.fields || []).map((f: any) => f.key).join(', ') || 'no fields yet'; }
  // ── Voice and brain presets ───────────────────────────────────────────────
  engine = computed(() => this.rules().engine);
  /** Three ready choices and Custom, so nobody has to know model names to start. */
  presets = computed(() => (this.meta()?.engines?.presets || []) as { key: string; label: string; sub: string; meta: string; engine: Partial<Engine>; metrics?: { latency: string; humanness: string; accuracy: string; cost: string } }[]);
  presetMetrics = computed(() => this.presets().find((p) => p.key === this.engine().preset)?.metrics || null);
  turnLabel = computed(() => (this.meta()?.engines?.turn_detectors || []).find((t: any) => t.id === this.engine().turn_detector)?.label || 'Model default');
  /** First clause of a metric, for the small chips on the preset tiles. */
  short(x: string): string { return String(x).split(/ \(|;| per call/)[0]; }
  /** '$0.032 per call min (Rs 2.77)' -> '₹2.77 / min' for the preset tiles. */
  perMin(cost?: string): string { const m = cost?.match(/Rs\s*([\d.]+)/); return m ? `₹${m[1]} / min` : ''; }
  /** The models in use, in one line: 'Saaras V4 · Claude Haiku 4.5 · Bulbul v3'. */
  engineLine = computed(() => {
    const e = this.engine();
    const name = (kind: string, id?: string) => this.modelLabel(kind, id).split(' · ')[0].replace(/\s*\(.*?\)/g, '');
    return e.mode === 's2s' ? name('s2s', e.s2s) : [name('stt', e.stt), name('llm', e.llm), name('tts', e.tts)].join(' · ');
  });
  pickPreset(key: string): void {
    const pr = this.presets().find((x) => x.key === key);
    // Custom keeps the models already in use, so nothing jumps; the pickers just open.
    this.patchEngine({ ...(key === 'custom' ? {} : pr?.engine || {}), preset: key });
    this.fixVoice();
  }
  customise(): void { this.patchEngine({ preset: 'custom' }); }
  setMode2(mode: 's2s' | 'pipeline'): void {
    const e = this.engine();
    const first = (k: string) => this.models(k)[0]?.id || '';
    this.patchEngine(mode === 's2s' ? { mode, s2s: e.s2s || first('s2s') } : { mode, stt: e.stt || first('stt'), llm: e.llm || first('llm'), tts: e.tts || first('tts') });
    this.fixVoice();
  }
  models(kind: string): { id: string; label: string; vendor: string; voices?: string[] }[] { return this.meta()?.engines?.[kind] || []; }
  modelLabel(kind: string, id: string | undefined): string { const m = this.models(kind).find((x) => x.id === id); return m ? `${m.label} · ${m.vendor}` : id || 'Not set'; }
  /** Voices of whichever model speaks: the voice model, or the text to speech model. */
  engineVoices = computed(() => {
    const e = this.engine();
    const m = e.mode === 's2s' ? this.models('s2s').find((x) => x.id === e.s2s) : this.models('tts').find((x) => x.id === e.tts);
    return m?.voices || [];
  });
  /** Keep the chosen voice only if the new model has it. */
  fixVoice(): void {
    const vs = this.engineVoices();
    if (vs.length && !vs.includes(this.settings().voice)) this.patchSettings({ voice: vs[0] });
  }
  /** From the Advanced panel: only switching and conversation; models stay with the preset. */
  patchBehaviour(e: { fallback: string; fallback_after_ms: number; turn: any }): void { this.patchEngine({ fallback: e.fallback, fallback_after_ms: e.fallback_after_ms, turn: e.turn }); }
  patchEngine(c: Partial<Engine>): void { this.rules.update((r) => ({ ...r, engine: { ...r.engine, ...c } })); }

  // ── More actions menu (placed on the page so it is never cut off) ────────
  menuOpen = signal(false);
  menuPos = signal({ top: 0, left: 0 });
  toggleMenu(e: Event): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPos.set({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)) });
    this.menuOpen.set(!this.menuOpen());
  }
  @HostListener('document:click') closeMenu(): void { this.menuOpen.set(false); }
  @HostListener('window:resize') @HostListener('document:wheel') onMove(): void { this.menuOpen.set(false); }

  syncLabelName(): string { return this.syncPlatforms().find((p) => p.platform_key === this.agent()?.synced_platform)?.label || 'the destination'; }
  targetInfo = computed(() => this.syncPlatforms().find((p) => p.platform_key === this.rules().sync_target.type) || null);
  toggleRetry(k: string, on: boolean): void {
    this.rules.update((r) => ({ ...r, retry: { ...r.retry, on: on ? [...new Set([...r.retry.on, k])] : r.retry.on.filter((x) => x !== k) } }));
  }
  toggleAnswerValue(v: string, on: boolean): void {
    const cur = this.rules().retry.answer_values;
    this.patchRetry({ answer_values: on ? [...new Set([...cur, v])] : cur.filter((x) => x !== v) });
  }
  splitList(v: string): string[] { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
  addLookup(): void { this.rules.update((r) => ({ ...r, lookups: [...r.lookups, blankLookup()] })); }
  patchLookup(i: number, c: any): void { this.rules.update((r) => ({ ...r, lookups: patch(r.lookups, i, c) })); }
  deleteLookup(i: number): void { this.rules.update((r) => ({ ...r, lookups: r.lookups.filter((_, k) => k !== i) })); }
  toggleLookupSend(i: number, k: string, on: boolean): void {
    const cur: string[] = this.rules().lookups[i].send || [];
    this.patchLookup(i, { send: on ? [...new Set([...cur, k])] : cur.filter((x) => x !== k) });
  }
  async addReference(file?: File): Promise<void> {
    if (!file) return;
    try { const r = await this.api.addAgentReference(this.key, file, this.refScope()); this.references.set(r.agent.references); this.say(`${file.name} added. The agent can search it on calls.`); }
    catch (e: any) { this.error.set(e.message); }
  }
  async removeReference(id: string): Promise<void> {
    try { const r = await this.api.removeAgentReference(this.key, id); this.references.set(r.agent.references); }
    catch (e: any) { this.error.set(e.message); }
  }

  private say(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 3200);
  }
}

function pickSync(a: any) {
  return { synced_platform: a.synced_platform, sync_status: a.sync_status, sync_last_error: a.sync_last_error, synced_at: a.synced_at, updated_at: a.updated_at };
}
