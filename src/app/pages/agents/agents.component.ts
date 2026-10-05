import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { fmtAgo } from '../../utils/format';

interface SyncPlatformOption { platform_key: string; label: string; }

/** One row: the list API's fields plus the route (from /webrtc/agents) and usage (from campaigns). */
interface AgentRow {
  key: string;
  label: string;
  description?: string;
  input_count: number;
  output_count: number;
  primary_id_key?: string;
  synced_platform?: string | null;
  sync_status?: string | null;
  sync_last_error?: string | null;
  synced_at?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  ozonetel_campaign: string;
  used_by: number;
}

type SyncState = { label: string; cls: string; title: string };

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [FormsModule, IconComponent, ConfirmComponent, HintComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="page-title">Agents</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="14"></app-icon> New agent</button>
        </div>
      </div>

      @if (!storage()) {
        <div class="note bad">Agents cannot be created or edited right now because the database is not reachable. Calls still run.</div>
      }
      @if (error()) { <div class="note bad">{{ error() }}</div> }

      <div class="card">
        <div class="toolbar">
          <input class="input search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Search agents" aria-label="Search agents" />
          <div class="seg" role="group" aria-label="Filter">
            <button [class.on]="filter() === 'all'" (click)="filter.set('all')">All {{ rows().length }}</button>
            <button [class.on]="filter() === 'used'" (click)="filter.set('used')">In use {{ usedCount() }}</button>
            <button [class.on]="filter() === 'unrouted'" (click)="filter.set('unrouted')">No flow {{ unroutedCount() }}</button>
          </div>
          <span class="spacer"></span>
          <span class="row-sub">Sorted by last change</span>
        </div>

        @if (loading()) {
          <div class="card-body">Loading…</div>
        } @else if (rows().length === 0) {
          <div class="empty">
            <div class="empty-icon"><app-icon name="bot" [size]="22"></app-icon></div>
            <div class="empty-title">No agents yet</div>
            <div class="empty-sub">Create one, or start from a copy of an existing agent.</div>
            <button class="btn btn-primary" style="margin-top: 12px" (click)="openNew()">New agent</button>
          </div>
        } @else if (shown().length === 0) {
          <div class="card-body row-sub">No agents match.</div>
        } @else {
          <div class="scroll-x">
            <div class="grid-head" [style.grid-template-columns]="cols">
              <span>Agent</span><span class="nowrap">Calling flow <app-hint text="The telephony flow this agent calls through. Pick which flows agents can use in Settings, Telephony."></app-hint></span><span>Call data</span><span>Used by</span><span>Updated</span>
              <span>Results go to <app-hint text="Where each row's call status and answers are sent after every call."></app-hint></span>
              <span></span>
            </div>
            @for (a of shown(); track a.key) {
              <div class="grid-row clickable" [style.grid-template-columns]="cols" (click)="open(a.key)">
                <span style="min-width: 0">
                  <div class="row-title" [title]="a.label">{{ a.label }}</div>
                  <div class="row-sub">{{ a.description || a.key }}</div>
                </span>
                <span>
                  @if (a.ozonetel_campaign) { <span class="mono row-sub ellipsis" [title]="a.ozonetel_campaign">{{ a.ozonetel_campaign }}</span> }
                  @else { <span class="tag warn" title="Pick a calling flow before this agent can call">Not set</span> }
                </span>
                <span class="row-sub">{{ a.input_count }} in · {{ a.output_count }} out</span>
                <span class="row-sub">{{ a.used_by ? a.used_by + ' campaign' + (a.used_by === 1 ? '' : 's') : 'Not used' }}</span>
                <span class="row-sub" [title]="a.updated_at || a.created_at || ''">{{ ago(a.updated_at || a.created_at) }}{{ a.updated_by ? ' · ' + a.updated_by : '' }}</span>
                <!-- Where results go: a plain dropdown, changed right here. -->
                <span (click)="$event.stopPropagation()" style="display: flex; align-items: center; gap: 6px; min-width: 0">
                  <select class="select select-sm" [value]="a.synced_platform || 'none'" (change)="setDestination(a, $any($event.target).value)" [attr.aria-label]="'Results of ' + a.label + ' go to'">
                    <option value="none">Nowhere</option>
                    @for (p of syncPlatforms(); track p.platform_key) { @if (p.connected || p.platform_key === a.synced_platform) { <option [value]="p.platform_key" [disabled]="!p.connected">{{ p.label }}{{ p.connected ? '' : ' (turned off)' }}</option> } }
                  </select>
                  @if (a.sync_status === 'failed') { <span class="tag bad" [title]="a.sync_last_error || 'Last send failed'">!</span> }
                </span>
                <span class="row-menu" (click)="$event.stopPropagation()">
                  <button class="btn-icon" (click)="toggleMenu(a.key, $event)" [attr.aria-label]="'Actions for ' + a.label" title="Actions">
                    <app-icon name="moreVertical" [size]="15"></app-icon>
                  </button>
                  @if (menuFor() === a.key) {
                    <div class="row-menu-list floating" role="menu" [style.top.px]="menuPos().top" [style.left.px]="menuPos().left">
                      <button (click)="open(a.key)"><app-icon name="fileText" [size]="13"></app-icon> Open</button>
                      <button (click)="testCall(a.key)"><app-icon name="phone" [size]="13"></app-icon> Test call</button>
                      <button (click)="startClone(a)"><app-icon name="copy" [size]="13"></app-icon> Clone</button>
                      @if (a.synced_platform) {
                        <button (click)="syncNow(a)" [disabled]="syncing() === a.key"><app-icon name="refresh" [size]="13"></app-icon> Send to {{ platformLabel(a.synced_platform) }} now</button>
                      }
                      <hr />
                      <button class="danger" (click)="askDelete(a)"><app-icon name="trash" [size]="13"></app-icon> Delete</button>
                    </div>
                  }
                </span>
              </div>
            }
          </div>
        }
      </div>
    </div>

    @if (creating()) {
      <div class="modal-backdrop" (click)="creating.set(false)">
        <form class="modal" style="max-width: 520px" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <div class="modal-head"><div class="modal-title">{{ copyFrom() ? 'Clone agent' : 'New agent' }}</div></div>
          <div class="modal-body" style="padding: 16px 18px; display: grid; gap: 12px">
            <label class="field">
              <span class="field-label">Name</span>
              <input class="input" [ngModel]="label()" (ngModelChange)="label.set($event)" name="label" placeholder="Payment follow-up" autofocus />
            </label>
            <label class="field">
              <span class="field-label">Start from</span>
              <select class="select" [ngModel]="copyFrom()" (ngModelChange)="copyFrom.set($event)" name="copyFrom">
                <option value="">Blank agent</option>
                @for (a of rows(); track a.key) { <option [value]="a.key">Copy of {{ a.label }}</option> }
              </select>
              <span class="hint" style="margin: 2px 0 0">{{ copyFrom() ? 'Copies the prompt and call data. You can change everything next.' : 'You add the prompt and call data next.' }}</span>
            </label>
            <label class="field">
              <span class="field-label">Calling flow <app-hint text="Only flows turned on in Settings, Telephony are listed."></app-hint></span>
              <select class="select" [ngModel]="oznCampaign()" (ngModelChange)="oznCampaign.set($event)" name="oznCampaign">
                <option value="">{{ oznCampaigns().length ? 'Choose later' : 'No flows turned on in Settings' }}</option>
                @for (c of oznCampaigns(); track c.name) { <option [value]="c.name">{{ c.name }}{{ c.provider_label ? ' · ' + c.provider_label : '' }}</option> }
              </select>
            </label>
            <label class="field">
              <span class="field-label">What it is for <span style="color: var(--ds-text-placeholder)">· optional</span></span>
              <input class="input" [ngModel]="description()" (ngModelChange)="description.set($event)" name="description" placeholder="Reminds suppliers about pending purchase orders" />
            </label>
            @if (createError()) { <div class="note bad" style="margin: 0">{{ createError() }}</div> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn" (click)="creating.set(false)">Cancel</button>
            <button class="btn btn-primary" [disabled]="busy() || !label().trim()">{{ busy() ? 'Creating…' : (copyFrom() ? 'Clone and open' : 'Create and open') }}</button>
          </div>
        </form>
      </div>
    }

    @if (deleting(); as d) {
      <app-confirm
        [title]="'Delete ' + d.label + '?'"
        [body]="d.used_by ? 'It is used by ' + d.used_by + ' campaign' + (d.used_by === 1 ? '' : 's') + '. Their calls and results stay, but no new calls can use this agent. This cannot be undone.' : 'This removes its prompt and call data. This cannot be undone.'"
        confirmLabel="Delete agent" [danger]="true" [busy]="busy()"
        (confirm)="confirmDelete()" (cancel)="deleting.set(null)"></app-confirm>
    }

    @if (toast()) { <div class="toast" role="status">{{ toast() }}</div> }
  `,
})
export class AgentsComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  cols = 'minmax(220px, 2fr) minmax(150px, 1.2fr) 100px 110px minmax(120px, 1fr) 170px 44px';

  rows = signal<AgentRow[]>([]);
  storage = signal(true);
  loading = signal(true);
  error = signal('');
  syncPlatforms = signal<(SyncPlatformOption & { connected?: boolean })[]>([]);
  q = signal('');
  filter = signal<'all' | 'used' | 'unrouted'>('all');
  menuFor = signal<string | null>(null);
  syncing = signal<string | null>(null);
  toast = signal('');
  private toastTimer: any = null;

  creating = signal(false);
  label = signal('');
  description = signal('');
  copyFrom = signal('');
  oznCampaign = signal('');
  oznCampaigns = signal<any[]>([]);
  createError = signal('');
  busy = signal(false);
  deleting = signal<AgentRow | null>(null);

  usedCount = computed(() => this.rows().filter((a) => a.used_by > 0).length);
  unroutedCount = computed(() => this.rows().filter((a) => !a.ozonetel_campaign).length);
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return this.rows()
      .filter((a) => this.filter() === 'all' || (this.filter() === 'used' ? a.used_by > 0 : !a.ozonetel_campaign))
      .filter((a) => !term || [a.label, a.key, a.description, a.ozonetel_campaign].some((v) => (v || '').toLowerCase().includes(term)))
      .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  });

  ago = fmtAgo;

  ngOnInit(): void {
    this.load();
    this.api.ozonetelCampaigns(true).then((r) => this.oznCampaigns.set(r.campaigns || [])).catch(() => this.oznCampaigns.set([]));
    const orgId = this.auth.currentOrgId();
    if (orgId) this.api.orgSyncPlatforms(orgId).then((p) => this.syncPlatforms.set(p || [])).catch(() => this.syncPlatforms.set([]));
  }

  @HostListener('document:click') closeMenu(): void { this.menuFor.set(null); }
  /** The menu is placed on the page, not inside the scrolling table, so it is never cut off; scrolling closes it. */
  @HostListener('window:resize') @HostListener('document:wheel') @HostListener('document:touchmove') onMove(): void { if (this.menuFor()) this.menuFor.set(null); }
  menuPos = signal({ top: 0, left: 0 });

  async load(): Promise<void> {
    try {
      const [list, tester, camps] = await Promise.all([
        this.api.agentList(),
        this.api.agents().catch(() => []),
        this.api.campaigns().catch(() => ({ campaigns: [] })),
      ]);
      const route = new Map<string, any>((tester || []).map((a: any) => [a.key, a]));
      const used = new Map<string, number>();
      for (const c of camps.campaigns || []) used.set(c.agent, (used.get(c.agent) || 0) + 1);
      this.rows.set((list.agents || []).map((a: any) => ({
        ...a,
        description: a.description ?? '',
        ozonetel_campaign: a.ozonetel_campaign ?? route.get(a.key)?.ozonetel_campaign ?? '',
        used_by: used.get(a.key) || 0,
      })));
      this.storage.set(list.storage_connected !== false);
      this.error.set('');
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  /** In sync unless the agent changed after its last push. Older backends send no
   * dates; then "synced" is taken at its word. */
  platformLabel(k: string | null | undefined): string { return this.syncPlatforms().find((p) => p.platform_key === k)?.label || k || ''; }
  syncState(a: AgentRow): SyncState {
    const platform = this.platformLabel(a.synced_platform) || 'Clarix';
    if (!a.synced_platform) return { label: 'Nowhere', cls: 'muted', title: 'Results stay in Echo. Pick a destination in the agent settings.' };
    if (a.sync_status === 'failed') return { label: 'Failed', cls: 'bad', title: a.sync_last_error || 'The last sync failed. Use Sync now to try again.' };
    if (a.sync_status === 'pending') return { label: 'Syncing', cls: 'info', title: `Sending to ${platform}` };
    if (a.synced_at && a.updated_at && a.updated_at > a.synced_at) return { label: `${platform}: changes waiting`, cls: 'warn', title: `Edited after the last sync to ${platform}` };
    return { label: platform, cls: 'ok', title: a.synced_at ? `Last synced ${fmtAgo(a.synced_at)}` : `Synced with ${platform}` };
  }

  toggleMenu(key: string, e?: Event): void {
    const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
    if (r) {
      const W = 200, H = 220;
      const top = r.bottom + H + 8 > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4;
      this.menuPos.set({ top, left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)) });
    }
    this.menuFor.set(this.menuFor() === key ? null : key);
  }
  open(key: string): void { this.router.navigate(['/agents', key]); }
  testCall(key: string): void { this.router.navigate(['/console'], { queryParams: { agent: key } }); }

  openNew(): void {
    this.label.set(''); this.description.set(''); this.copyFrom.set(''); this.oznCampaign.set(''); this.createError.set('');
    this.creating.set(true);
  }

  startClone(a: AgentRow): void {
    this.menuFor.set(null);
    this.label.set(`${a.label} (copy)`); this.description.set(a.description || ''); this.copyFrom.set(a.key);
    this.oznCampaign.set(a.ozonetel_campaign || ''); this.createError.set('');
    this.creating.set(true);
  }

  async create(): Promise<void> {
    const l = this.label().trim();
    if (!l) return;
    this.busy.set(true); this.createError.set('');
    try {
      const out = await this.api.createAgent({
        label: l,
        description: this.description().trim(),
        copy_from: this.copyFrom() || undefined,
        ozonetel_campaign: this.oznCampaign(),
        ozonetel_type: this.oznCampaigns().find((c) => c.name === this.oznCampaign())?.type || '',
      });
      this.router.navigate(['/agents', out.agent.key]);
    } catch (err: any) {
      this.createError.set(err.message);
    } finally {
      this.busy.set(false);
    }
  }

  async syncNow(a: AgentRow): Promise<void> {
    const platform = this.syncPlatforms().find((p) => p.platform_key === a.synced_platform);
    if (!platform) return;
    this.menuFor.set(null); this.syncing.set(a.key);
    try {
      await this.api.syncAgent(a.key, platform.platform_key);
      this.rows.update((l) => l.map((r) => (r.key === a.key ? { ...r, synced_platform: platform.platform_key, sync_status: 'pending', sync_last_error: null } : r)));
      this.say(`Sending ${a.label} to ${platform.label}…`);
      setTimeout(() => this.load(), 2500);
    } catch (e: any) {
      this.say(/409/.test(e.message) || /already/i.test(e.message) ? `${a.label} is already in sync.` : `Sync failed: ${e.message}`);
    } finally {
      this.syncing.set(null);
    }
  }

  /** Change where an agent's results go, straight from the list. */
  async setDestination(a: AgentRow, type: string): Promise<void> {
    try {
      await this.api.updateAgent(a.key, { sync_target: { type, url: '' } });
      this.rows.update((l) => l.map((r) => (r.key === a.key ? { ...r, synced_platform: type === 'none' ? null : type, sync_status: type === 'none' ? null : 'pending' } : r)));
      this.say(type === 'none' ? `${a.label}: results stay in Echo.` : `${a.label}: results go to ${this.platformLabel(type)}.`);
      setTimeout(() => this.load(), 1200);
    } catch (e: any) { this.say(`Could not change it: ${e.message}`); }
  }

  askDelete(a: AgentRow): void { this.menuFor.set(null); this.deleting.set(a); }

  async confirmDelete(): Promise<void> {
    const a = this.deleting();
    if (!a) return;
    this.busy.set(true);
    try {
      const out = await this.api.deleteAgent(a.key);
      this.rows.update((l) => l.filter((r) => r.key !== a.key));
      this.say(out?.note || `${a.label} deleted.`);
      this.deleting.set(null);
    } catch (e: any) {
      this.error.set(e.message);
      this.deleting.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  private say(msg: string): void {
    this.toast.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 3200);
  }
}
