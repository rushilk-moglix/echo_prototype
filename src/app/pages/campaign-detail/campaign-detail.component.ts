import { campaignStatus, outcomeView, statusHover, GROUPS } from '../../utils/status';
import { StatRowComponent } from '../../components/stat-row/stat-row.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { Component, inject, signal, OnInit, OnDestroy, ViewChild, ElementRef, computed } from '@angular/core';
import { CampaignNamePipe } from '../../pipes/campaign-name.pipe';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ContactsBrowserComponent } from './contacts-browser.component';
import { ColumnMappingComponent } from './column-mapping.component';
import { FormsModule } from '@angular/forms';
import { GuideComponent } from '../../components/guide/guide.component';
import { HintComponent } from '../../components/hint/hint.component';
import { StatusReferenceComponent } from '../../components/status-reference/status-reference.component';
import { fmtSecs } from '../../utils/format';

@Component({
  selector: 'app-campaign-detail',
  standalone: true,
  imports: [CampaignNamePipe, RouterLink, FormsModule, GuideComponent, HintComponent, StatusReferenceComponent, IconComponent, ContactsBrowserComponent, ColumnMappingComponent, ConfirmComponent, StatRowComponent],
  templateUrl: './campaign-detail.component.html',
})
export class CampaignDetailComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  @ViewChild('inputRef') inputRef!: ElementRef<HTMLInputElement>;

  id = '';
  /** Result and stats of this campaign, with the rows behind each number (the same row as the Overview). */
  stats = signal<any>(null);
  statScope = signal<Record<string, string>>({});
  campaign = signal<any>(null);
  /** The board has two tabs: Calls (one line per call) and Rows (one line per row of the file). */
  tab = signal<'contacts' | 'rows'>('contacts');
  /** Every uploaded row with its own state. A call that went well can still leave a row open, so rows are listed on their own. */
  rowData = signal<any>(null);
  rowState = signal('');
  rowStates = computed(() => { const d = this.rowData(); return d ? Object.keys(d.states).filter((k) => d.counts[k]).map((k) => ({ key: k, label: d.states[k], count: d.counts[k] })) : []; });
  shownRows = computed(() => { const term = this.q().trim().toLowerCase(); return (this.rowData()?.rows || []).filter((r: any) => (!this.rowState() || r.state === this.rowState()) && (!term || [r.say, r.contact, r.phone, ...Object.values(r.values || {})].some((v) => String(v || '').toLowerCase().includes(term)))); });
  rowsAnswered = computed(() => this.rowData()?.counts?.answered || 0);
  rowTone(state: string): string { return state === 'answered' ? 'ok' : state === 'rejected' ? 'bad' : state === 'not_covered' || state === 'partly' ? 'warn' : state === 'waiting' ? 'busy' : 'muted'; }
  rowAnswer(r: any): string { const a = r.answer || {}; const f = (this.rowData()?.answer_fields || []).filter((k: string) => a[k] !== '' && a[k] != null).slice(0, 3); return f.map((k: string) => String(a[k]).replace(/_/g, ' ')).join(' · '); }
  mmss(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  /** Answer fields that hold at least one answer, one column each on the Rows board. */
  answerFields = computed(() => { const d = this.rowData(); const rows = d?.rows || []; return (d?.answer_fields || []).filter((f: string) => f !== 'row' && rows.some((r: any) => !this.blank(r.answer?.[f]))); });
  nice(k: string): string { return String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
  blank(v: any): boolean { return v === null || v === undefined || v === ''; }
  show(v: any): string { return v === true ? 'Yes' : v === false ? 'No' : this.blank(v) ? '—' : String(v).replace(/_/g, ' '); }
  /** Each call's saved answers, by contact id, for the Calls board and its export. */
  answersById = computed(() => { const m: Record<string, any> = {}; for (const r of this.responses()) m[r.primary_id] = r; return m; });
  pct(n: number): string { const t = this.contacts().length; return t ? `${Math.round((n / t) * 100)}%` : ''; }
  /** A status tile filters the Calls board; picking it again shows every call. */
  pickStatus(key: string): void { this.tab.set('contacts'); this.outcomeFilter.set(this.outcomeFilter() === key ? '' : key); }
  filterLabel = computed(() => (this.outcomeFilter() ? outcomeView(this.outcomeFilter()).label : ''));
  shownCount = computed(() => (this.tab() === 'rows' ? this.shownRows().length : this.shownContacts().length));

  /** Download exactly what the board shows, with every answer, as a CSV that opens in Excel. */
  exportBoard(): void {
    const cell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    let head: string[]; let body: any[][];
    if (this.tab() === 'rows') {
      const f = this.rowData()?.answer_fields?.filter((k: string) => k !== 'row') || [];
      head = ['Row', 'What it is about', 'Row state', 'Why this state', ...f.map((k: string) => this.nice(k)), 'Contact', 'Phone', 'Call status'];
      body = this.shownRows().map((r: any) => [r.row, r.say, r.state_label, r.reason, ...f.map((k: string) => this.show(r.answer?.[k]).replace(/^—$/, '')), r.contact, r.phone, r.call_status]);
    } else {
      const ov = this.outVars(); const by = this.answersById();
      head = ['Name', 'Phone', ...(this.grouped() ? ['Rows answered', 'Rows'] : []), 'Call status', 'Dials', 'Talk (seconds)', 'Last dial', ...ov.map((v: any) => v.label || v.key), 'No answers because'];
      body = this.shownContacts().map((r: any) => { const a = by[r.primary_id];
        return [r.name, r.phone, ...(this.grouped() ? [r.rows_answered ?? 0, r.rows_count ?? ''] : []), outcomeView(r.outcome).label, r.attempts || 0, r.talk_seconds || 0, r.last_attempt_at || '', ...ov.map((v: any) => (a?.outputs?.[v.key] ?? '')), a?.no_answers?.label || '']; });
    }
    const csv = '﻿' + [head, ...body].map((row) => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${String(this.campaign()?.name || this.id).replace(/[^a-zA-Z0-9_-]+/g, '_')}-${this.tab() === 'rows' ? 'rows' : 'calls'}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  fmtSecs = fmtSecs;
  hover = statusHover;
  /** Long durations as "2 h 35 min"; short ones as m:ss. */
  fmtLong(s: number): string {
    if (s < 3600) return fmtSecs(s);
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${m} min`;
  }
  contacts = signal<any[]>([]);
  responses = signal<any[]>([]);
  error = signal('');
  busy = signal('');
  preview = signal<any>(null);
  confirmDial = signal(false);
  dialResult = signal<any>(null);

  private pollTimer: any = null;

  schema = computed(() => this.campaign()?.schema);
  outVars = computed(() => this.schema()?.output_variables || []);
  idLabel = computed(() => this.schema()?.primary_id_label || 'Primary id');
  grouped = computed(() => this.contacts().some(r => (r.rows_count || 1) > 1 || r.parts > 1));
  doneCount = computed(() => this.contacts().filter(r => !['in_progress'].includes(outcomeView(r.outcome).group)).length);
  dials = computed(() => this.contacts().reduce((n, r) => n + (r.attempts || 0), 0));
  talkSeconds = computed(() => this.contacts().reduce((n, r) => n + (r.talk_seconds || 0), 0));
  /** Calls per outcome group, in a fixed order, for the progress bar and its legend. */
  groupCounts = computed(() => GROUPS.map(g => ({ ...g, count: this.contacts().filter(r => outcomeView(r.outcome).group === g.key).length })));
  outcomeCounts = computed(() => {
    const m = new Map<string, number>();
    for (const r of this.contacts()) m.set(r.outcome, (m.get(r.outcome) || 0) + 1);
    return [...m.entries()].map(([key, count]) => ({ ...outcomeView(key), count })).sort((a, b) => GROUPS.findIndex((g) => g.key === a.group) - GROUPS.findIndex((g) => g.key === b.group) || b.count - a.count);
  });
  progressLabel = computed(() => this.groupCounts().filter(g => g.count).map(g => `${g.label} ${g.count}`).join(', '));
  pendingCount = computed(() => this.contacts().filter(r => r.status === 'pending').length);
  stoppable = computed(() => this.contacts().filter(r => ['pending', 'queued', 'dialled', 'retry_scheduled', 'scheduled'].includes(r.status)).length);
  campStatus = computed(() => campaignStatus(this.campaign()?.status));
  isOpen = computed(() => ['running', 'paused', 'scheduled'].includes(this.campaign()?.status));
  outcomeFilter = signal('');
  groupFilter = signal('');
  q = signal('');
  askStop = signal(false);
  filtersOn = computed(() => !!(this.outcomeFilter() || this.groupFilter() || this.q().trim()));
  clearFilters(): void { this.outcomeFilter.set(''); this.groupFilter.set(''); this.q.set(''); }
  private matches = (r: any): boolean => {
    const t = this.q().trim().toLowerCase();
    if (t && ![r.name, r.phone, r.primary_id].some(v => String(v || '').toLowerCase().includes(t))) return false;
    if (this.outcomeFilter() && r.outcome !== this.outcomeFilter()) return false;
    if (this.groupFilter() && outcomeView(r.outcome).group !== this.groupFilter()) return false;
    return true;
  };
  shownContacts = computed(() => this.contacts().filter(this.matches));
  /** Answers rows carry only ids; filter them through the contact they belong to. */
  shownResponses = computed(() => {
    const keep = new Set(this.shownContacts().map(r => r.primary_id));
    return this.responses().filter(r => keep.has(r.primary_id));
  });

  /** The agent's Ozonetel route — campaigns inherit it rather than owning one. */
  oznCampaign = computed(() => this.schema()?.ozonetel_campaign || '');

  /**
   * Whether any call has finished and reported. Gates the Responses tab and the
   * Results download: before the first one there is nothing to show, and an
   * empty results table reads as a failure rather than as "not yet".
   */
  hasResults = computed(() => this.responses().length > 0);

  /**
   * Why the upload button is disabled, or '' when it is not.
   *
   * Both conditions are enforced by the backend too; stating them here turns a
   * 400 the operator would hit after picking a file into a sentence they can read
   * before doing so.
   */
  uploadBlockedReason = computed(() => {
    if (!this.campaign()) return '';
    if (!this.oznCampaign()) {
      return `${this.schema()?.label || 'This agent'} has no calling line, so this campaign cannot call. Set one in the agent's Settings.`;
    }
    if ((this.campaign().contacts_count ?? 0) > 0) {
      return 'This campaign already has its contact list. One campaign is one upload — create a new campaign to call another list.';
    }
    return '';
  });

  /**
   * The subset of uploadBlockedReason() worth a persistent red banner rather
   * than just the disabled button's tooltip. "Already has its contact list"
   * is the expected state of every campaign after its one upload — it isn't
   * a problem, so showing it as an alarm forever (including on a finished
   * campaign) is just noise. A missing Ozonetel mapping actually is a
   * problem (the campaign can never be dialled), so that one stays visible.
   */
  uploadBlockedBanner = computed(() =>
    this.campaign() && !this.oznCampaign() ? this.uploadBlockedReason() : '',
  );

  canUpload(): boolean {
    return !this.busy() && !this.uploadBlockedReason();
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.id = params.get('id') || '';
      if (this.id) this.load();
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  async load(): Promise<void> {
    try {
      const c = await this.api.campaign(this.id);
      this.campaign.set(c);
      const [ct, rs] = await Promise.all([this.api.campaignContacts(this.id), this.api.campaignResponses(this.id)]);
      this.api.campaignRows(this.id).then((d) => this.rowData.set(d)).catch(() => {});
      this.statScope.set({ days: '3650', campaign_id: this.id });
      this.api.reportSummary({ days: '3650', campaign_id: this.id }).then((r) => this.stats.set(r)).catch(() => {});
      this.contacts.set(ct.contacts || []);
      this.responses.set(rs.responses || []);
      this.error.set('');
      
      if (['running', 'paused'].includes(c.status) && !this.pollTimer) {
        this.pollTimer = setInterval(() => this.load(), 5000);
      } else if (!['running', 'paused'].includes(c.status)) {
        this.stopPolling();
      }
    } catch (e: any) { this.error.set(e.message); }
  }

  async stop(): Promise<void> {
    this.busy.set('stopping');
    try {
      await this.api.stopCampaign(this.id);
      this.askStop.set(false);
      await this.load();
    } catch (e: any) {
      this.error.set(/404/.test(e.message) ? 'Stopping campaigns needs the updated backend.' : e.message);
      this.askStop.set(false);
    } finally { this.busy.set(''); }
  }

  stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  triggerUpload(): void { this.inputRef?.nativeElement?.click(); }

  async pick(file?: File): Promise<void> {
    this.error.set(''); this.preview.set(null);
    if (!file) return;
    if (!/\.xlsx?$|\.xlsm$/i.test(file.name)) {
      this.error.set('That file is not a spreadsheet. Upload the .xlsx template.');
      return;
    }
    this.busy.set('checking');
    try {
      const r = await this.api.uploadContacts(this.id, file, { dryRun: true });
      this.preview.set({ ...r, file });
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }

  /**
   * Store the list and dial it, using the mapping the operator confirmed.
   *
   * There is no store-without-dialling path, so this is the point of no return —
   * which is why the mapping screen sits in front of it rather than after.
   */
  async commitUpload(mapping: Record<string, number | null>): Promise<void> {
    const f = this.preview()?.file;
    if (!f) return;
    this.busy.set('dialling'); this.error.set('');
    try {
      const r = await this.api.uploadContacts(this.id, f, { dryRun: false, mapping });
      this.preview.set(null);
      if (this.inputRef?.nativeElement) this.inputRef.nativeElement.value = '';
      if (r.dial?.error) this.error.set(`Stored, but not dialled — ${r.dial.error}`);
      else if (r.dial?.dialled) this.dialResult.set(r.dial);
      // Contacts, not responses: nothing has been captured yet, and the responses
      // tab is hidden until something is.
      this.tab.set('contacts');
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }

  /**
   * Every transcript and recording as one zip, from the server — unlike the
   * CSV above this can't be built client-side, so it's a real network
   * request. Fetched (not a bare `<a href download>`) specifically so a slow
   * or near-empty export doesn't show the browser's own tab-loading spinner
   * next to the page title; the button's own busy state covers that instead.
   */
  async downloadCampaignZip(): Promise<void> {
    this.busy.set('exporting');
    this.error.set('');
    try {
      const res = await fetch(this.api.campaignExportUrl(this.id));
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const campName = this.campaign()?.name || this.id;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-${campName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      this.error.set(e.message || 'Could not export transcripts and audio');
    } finally {
      this.busy.set('');
    }
  }

  async dial(): Promise<void> {
    this.busy.set('dialling'); this.error.set('');
    try {
      const r = await this.api.dialCampaign(this.id);
      this.dialResult.set(r);
      this.confirmDial.set(false);
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(''); }
  }
}

