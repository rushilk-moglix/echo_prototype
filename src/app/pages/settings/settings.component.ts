import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { StatusReferenceComponent } from '../../components/status-reference/status-reference.component';
import { ConnectComponent } from '../../components/connect/connect.component';
import { StatusPickerComponent } from '../../components/status-picker/status-picker.component';
import { IntegrationCatalogComponent } from '../../components/integration-catalog/integration-catalog.component';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { API_BASE } from '../../core/endpoints';
import { CALL_STATUSES, statusHover, setNoReplyUnder } from '../../utils/status';

const ROLE_WORDS: Record<string, string> = {
  org_admin: 'Admin',
  campaign_manager: 'Campaign manager',
  user: 'Member',
};
const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
type Tab = 'workspace' | 'telephony' | 'calling' | 'data' | 'integrations' | 'developer';
const PAGE = 40;

/**
 * Platform settings for the workspace, in tabs, with one Save for plain fields:
 * workspace (time zone, calling hours, parallel calls), telephony (providers,
 * the calling flows agents may use, recording, DND, No reply cut-off), calling
 * defaults, data (what is kept, where, and the outside rules that limit it)
 * and integrations. Providers and integrations save through their own setup
 * flow, only after their checks pass.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, FormsModule, RouterLink, NgTemplateOutlet, HintComponent, GuideComponent, StatusReferenceComponent, ConnectComponent, ConfirmComponent, IntegrationCatalogComponent, StatusPickerComponent],
  template: `
    <div class="page">
      <div class="page-head agent-head">
        <h1 class="page-title">Settings</h1>
        <div class="page-actions">
          @if (dirty()) { <button class="btn btn-ghost" (click)="discard()">Discard</button> }
          <button class="btn btn-primary" [disabled]="!dirty() || saving() || !isOrgAdmin()" (click)="save()" [title]="isOrgAdmin() ? '' : 'Only admins can change settings'">{{ saving() ? 'Saving…' : dirty() ? 'Save changes' : 'Saved' }}</button>
        </div>
      </div>
      @if (error()) { <div class="note bad">{{ error() }} <button class="btn btn-sm" style="margin-left: 8px" (click)="error.set('')">Dismiss</button></div> }
      @if (toast()) { <div class="toast" role="status">{{ toast() }}</div> }

      <div class="card">
        <div class="card-head">
          <span class="card-title">
            @for (t of TABS; track t.key) { <button [class]="'tab' + (tab() === t.key ? ' on' : '')" (click)="tab.set(t.key)">{{ t.label }}</button> }
          </span>
        </div>

        @if (s(); as st) {
          @if (tab() === 'workspace') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <div class="field"><span class="field-label">Signed in as</span><code>{{ auth.me()?.email || '—' }}</code></div>
                <label class="field"><span class="field-label">Workspace <app-hint text="Each workspace has its own agents, campaigns, telephony and team."></app-hint></span>
                  @if (memberships().length > 1) {
                    <select class="select" [ngModel]="auth.currentOrgId()" (ngModelChange)="switchOrg($event)">@for (m of memberships(); track m.org_id) { <option [value]="m.org_id">{{ m.org_name }}</option> }</select>
                  } @else { <code>{{ auth.currentMembership()?.org_name || '—' }}</code> }
                </label>
                <div class="field"><span class="field-label">Your role <app-hint [text]="roleHelp()"></app-hint></span><span>{{ roleWords() }}@if (isOrgAdmin()) { · <a class="link" routerLink="/team">Team</a> }</span></div>
              </div>
              <div class="set-grid">
                <label class="field"><span class="field-label">Time zone <app-hint text="Used for calling hours, schedules and every time shown in Echo."></app-hint></span>
                  <select class="select" [ngModel]="st.workspace.timezone" (ngModelChange)="patch('workspace', { timezone: $event })">@for (z of ZONES; track z) { <option [value]="z">{{ z }}</option> }</select></label>
                <label class="field"><span class="field-label">Default language <app-hint text="Language new agents start with. Each agent can change it."></app-hint></span>
                  <select class="select" [ngModel]="st.workspace.language" (ngModelChange)="patch('workspace', { language: $event })">@for (l of LANGS; track l[0]) { <option [value]="l[0]">{{ l[1] }}</option> }</select></label>
                <label class="field"><span class="field-label">Calls at the same time <app-hint text="Most calls this workspace places at once. Extra calls wait in the queue."></app-hint></span>
                  <input class="input" type="number" min="1" max="200" [ngModel]="st.workspace.max_parallel_calls" (ngModelChange)="patch('workspace', { max_parallel_calls: +$event || 1 })" /></label>
              </div>
              <div class="field">
                <span class="field-label">Calling hours <app-hint text="Echo only dials inside these hours and days. Calls outside wait for the next window."></app-hint></span>
                <div class="hours">
                  <input class="input" type="time" [ngModel]="st.workspace.calling_hours.from" (ngModelChange)="patchHours({ from: $event })" aria-label="From" />
                  <span class="row-sub">to</span>
                  <input class="input" type="time" [ngModel]="st.workspace.calling_hours.to" (ngModelChange)="patchHours({ to: $event })" aria-label="To" />
                  <div class="seg" role="group" aria-label="Days">
                    @for (d of DAYS; track d[0]) { <button type="button" [class.on]="st.workspace.calling_hours.days.includes(d[0])" (click)="toggleDay(d[0])">{{ d[1] }}</button> }
                  </div>
                </div>
              </div>
            </div>
          }

          @if (tab() === 'telephony') {
            <div class="card-body settings-tab wide">
              <section class="set-sec">
                <div class="set-head">
                  <div class="set-title">Providers <app-hint text="The services that place your calls. Set one up, Echo checks it works, then it can be turned off or removed at any time."></app-hint></div>
                  <button class="btn btn-sm" [disabled]="!isOrgAdmin()" (click)="openCatalog('telephony')"><app-icon name="plus" [size]="12"></app-icon> Add provider</button>
                </div>
                <ng-container *ngTemplateOutlet="intList; context: { $implicit: setUp(telephonyInts()), empty: 'No provider yet. Add one to start calling.' }"></ng-container>
              </section>

              <section class="set-sec">
                <div class="set-title">
                  Calling flows <app-guide topic="line"></app-guide>
                  <span class="pill" style="margin-left: 6px">{{ onCount() }} on · {{ flows().length }} fetched</span>
                </div>
                <div class="filter-bar flow-bar">
                  <label class="search"><app-icon name="search" [size]="14"></app-icon><input class="input" [ngModel]="flowQ()" (ngModelChange)="flowQ.set($event); flowLimit.set(PAGE)" placeholder="Search flows or numbers" aria-label="Search flows" /></label>
                  <div class="seg" role="group" aria-label="Show">
                    <button type="button" [class.on]="flowShow() === 'on'" (click)="flowShow.set('on')">On ({{ onCount() }})</button>
                    <button type="button" [class.on]="flowShow() === 'all'" (click)="flowShow.set('all')">All</button>
                  </div>
                  @if (flowProviders().length > 1) {
                    <select class="select select-sm" [ngModel]="flowProvider()" (ngModelChange)="flowProvider.set($event)" aria-label="Provider"><option value="">Every provider</option>@for (p of flowProviders(); track p.key) { <option [value]="p.key">{{ p.label }}</option> }</select>
                  }
                  <span style="flex: 1"></span>
                  @for (p of flowProviders(); track p.key) {
                    <button class="btn btn-sm" [disabled]="fetching() === p.key || p.status !== 'connected' || !isOrgAdmin()" (click)="fetchFlows(p.key)" [title]="'Last fetched ' + ago(fetchedAt()[p.key]) + '. Fetch again to pick up flows added in ' + p.label + '.'">
                      <app-icon name="refresh" [size]="12"></app-icon> {{ fetching() === p.key ? 'Fetching…' : 'Fetch from ' + p.label }}
                    </button>
                  }
                </div>
                <div class="scroll-x">
                  <table class="table flows">
                    <thead><tr><th style="width: 52px">On <app-hint text="Only flows turned on show in an agent's Calls go out on list. A flow an agent uses cannot be turned off."></app-hint></th><th>Flow</th><th>Type <app-hint text="How the provider dials: IVR plays a flow, Progressive dials as agents free up, Preview shows the record first, Predictive dials ahead."></app-hint></th><th>Number shown</th><th>Used by</th></tr></thead>
                    <tbody>
                      @for (f of shownFlows(); track f.name) {
                        <tr [class.off]="!f.enabled">
                          <td><label class="switch" [title]="f.used_by.length && f.enabled ? 'Used by ' + f.used_by.join(', ') : f.enabled ? 'Turn off' : 'Turn on'">
                            <input type="checkbox" [checked]="f.enabled" [disabled]="!isOrgAdmin() || (f.enabled && f.used_by.length > 0)" (change)="setFlow(f, $any($event.target).checked)" [attr.aria-label]="'Use ' + f.name" /><i></i></label></td>
                          <td><span class="mono">{{ f.name }}</span>@if (flowProviders().length > 1) { <span class="row-sub"> · {{ providerLabel(f.provider) }}</span> }</td>
                          <td class="row-sub">{{ f.type }}</td>
                          <td class="mono row-sub">{{ f.did || '—' }}</td>
                          <td class="row-sub">{{ f.used_by.length ? f.used_by.join(', ') : '—' }}</td>
                        </tr>
                      }
                      @if (!shownFlows().length) { <tr><td colspan="5" class="row-sub" style="padding: 14px 12px">{{ flowShow() === 'on' && !flowQ() ? 'No flows turned on. Switch to All and turn on the ones agents should use.' : 'No flows match.' }}</td></tr> }
                    </tbody>
                  </table>
                </div>
                @if (matchedFlows().length > shownFlows().length) {
                  <button class="btn btn-sm" style="justify-self: start" (click)="flowLimit.set(flowLimit() + PAGE)">Show {{ Math.min(PAGE, matchedFlows().length - shownFlows().length) }} more of {{ matchedFlows().length - shownFlows().length }}</button>
                }
              </section>

              <section class="set-sec">
                <div class="set-title">Calls</div>
                <div class="set-grid">
                  <label class="field"><span class="field-label">Record calls <app-hint text="Keep a recording of every answered call. How long it is kept is under Data."></app-hint></span>
                    <select class="select" [ngModel]="st.telephony.record_calls" (ngModelChange)="patch('telephony', { record_calls: $event === true || $event === 'true' })"><option [ngValue]="true">On</option><option [ngValue]="false">Off</option></select></label>
                  <label class="field"><span class="field-label">Skip DND numbers <app-hint text="Numbers on the national do not disturb list are not dialled and get call status Blocked."></app-hint></span>
                    <select class="select" [ngModel]="st.telephony.dnd_check" (ngModelChange)="patch('telephony', { dnd_check: $event === true || $event === 'true' })"><option [ngValue]="true">On</option><option [ngValue]="false">Off</option></select></label>
                  <label class="field"><span class="field-label">No reply under (seconds) <app-hint [text]="'Answered calls with talk time under this are No reply. At this or more, the call is Completed (agent finished) or Caller hung up. Default 5.'"></app-hint></span>
                    <input class="input" type="number" min="1" max="30" [ngModel]="st.telephony.no_reply_under_seconds" (ngModelChange)="patch('telephony', { no_reply_under_seconds: +$event || 5 })" /></label>
                </div>
              </section>
            </div>
          }

          @if (tab() === 'calling') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <label class="field"><span class="field-label">Tries per contact <app-guide topic="retry"></app-guide></span>
                  <input class="input" type="number" min="1" max="6" [ngModel]="st.calling_defaults.tries" (ngModelChange)="patch('calling_defaults', { tries: +$event || 1 })" /></label>
                <label class="field"><span class="field-label">Wait between tries (min) <app-hint text="Minutes from the end of one dial to the next."></app-hint></span>
                  <input class="input" type="number" min="5" max="1440" [ngModel]="st.calling_defaults.gap_minutes" (ngModelChange)="patch('calling_defaults', { gap_minutes: +$event || 60 })" /></label>
              </div>
              <div class="field">
                <span class="field-label">Try again when the call status is <app-hint text="New agents start with these. Each agent can change them under Settings, Advanced. Hover or focus the i next to a status for what it means, how it is decided and what happens next."></app-hint> <app-status-reference label="All statuses"></app-status-reference></span>
                <app-status-picker [selected]="st.calling_defaults.on" [tries]="st.calling_defaults.tries" [gapMinutes]="st.calling_defaults.gap_minutes" (selectedChange)="patch('calling_defaults', { on: $event })"></app-status-picker>
              </div>
            </div>
          }

          @if (tab() === 'data') {
            <div class="card-body settings-tab wide">
              <div class="data-head">
                <span class="row-sub">Read from storage and providers {{ ago(policyAt()) }}</span>
                <button class="btn btn-sm" (click)="loadPolicy()"><app-icon name="refresh" [size]="12"></app-icon> Check again</button>
              </div>
              <div class="data-list">
                @for (d of policy(); track d.key) {
                  <div class="data-row">
                    <div class="data-what">
                      <b>{{ d.label }}</b>
                      <span class="row-sub mono" [title]="d.where"><app-icon [name]="d.where.includes('S3') ? 'cloud' : 'database'" [size]="12"></app-icon> {{ d.where }}</span>
                    </div>
                    <div class="data-keep">
                      @if (d.setting) {
                        <label class="keep">
                          <span class="row-sub">Keep</span>
                          <input class="input" type="number" [min]="d.min" [max]="d.max" [ngModel]="st.data[d.setting]" (ngModelChange)="patchDays(d, $event)" [attr.aria-label]="'Days to keep ' + d.label" />
                          <span class="row-sub">days</span>
                        </label>
                        <span class="row-sub">Allowed {{ d.min }} to {{ d.max }}</span>
                      } @else {
                        <span><app-icon name="lock" [size]="12"></app-icon> {{ d.min }} days</span>
                        <span class="row-sub">Fixed</span>
                      }
                    </div>
                    <div class="data-rules">
                      @for (r of d.rules; track r.source) {
                        <div class="rule" [title]="r.detail">
                          <app-icon [name]="r.kind === 'copy' ? 'archive' : 'lock'" [size]="12"></app-icon>
                          <span>{{ ruleWords(r) }}</span>
                          <app-hint [text]="r.source + ': ' + r.detail"></app-hint>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
              <div class="set-grid">
                <label class="field"><span class="field-label">Hide numbers from members <app-hint text="Members see numbers as 98XXXXXX21. Admins and campaign managers see them in full."></app-hint></span>
                  <select class="select" [ngModel]="st.data.mask_numbers_for_users" (ngModelChange)="patch('data', { mask_numbers_for_users: $event === true || $event === 'true' })"><option [ngValue]="false">Off</option><option [ngValue]="true">On</option></select></label>
                <div class="field"><span class="field-label">Call history <app-hint text="Whether new calls are being written to storage right now."></app-hint></span><span><span [class]="'dot ' + (today()?.storage_connected ? 'ok' : 'bad')"></span> {{ today()?.storage_connected ? 'Being saved' : 'Not being saved right now' }}</span></div>
              </div>
            </div>
          }

          @if (tab() === 'integrations') {
            <div class="card-body settings-tab wide">
              <section class="set-sec">
                <div class="set-head">
                  <div class="set-title">Connected <app-guide topic="destination"></app-guide></div>
                  <span class="row-sub">{{ otherInts().length }} available</span>
                  <button class="btn btn-sm btn-primary" [disabled]="!isOrgAdmin()" (click)="openCatalog('')"><app-icon name="plus" [size]="12"></app-icon> Add integration</button>
                </div>
                <ng-container *ngTemplateOutlet="intList; context: { $implicit: setUp(otherInts()), empty: 'Nothing connected yet. Add a CRM, sheet, helpdesk, database, webhook or your own model keys.' }"></ng-container>
              </section>
            </div>
          }

          @if (tab() === 'developer') {
            <div class="card-body settings-tab">
              <div class="set-grid">
                <div class="field"><span class="field-label">API</span><code>{{ apiBase }}</code></div>
                <div class="field"><span class="field-label">Voice service</span><code>{{ api.webrtcBase }}</code></div>
                <div class="field"><span class="field-label">Version</span><code>{{ healthData()?.version || '—' }}</code></div>
                <div class="field"><span class="field-label">Round trip</span><code>{{ healthData() ? healthData().ms + ' ms' : 'unreachable' }}</code></div>
              </div>
            </div>
          }
        } @else { <div class="card-body row-sub">Loading…</div> }
      </div>
    </div>

    <!-- One list style for providers and destinations: status, on/off, and a menu. -->
    <ng-template #intList let-list let-empty="empty">
      <div class="ints">
        @if (!list.length) { <div class="row-sub int-empty">{{ empty }}</div> }
        @for (i of list; track i.key) {
          <div class="int-row" [class.off]="i.status !== 'connected'">
            <span class="int-name"><span class="int-logo" [style.background]="tint(i.label)">{{ initials(i.label) }}</span><span><b>{{ i.label }}</b><small>{{ i.category_label }}</small></span></span>
            <span class="int-state">
              @if (i.status === 'connected') { <span class="tag ok">On</span> }
              @else if (i.status === 'disabled') { <span class="tag muted">Off</span> }
              @else { <span class="row-sub">Not set up</span> }
              @if (i.status !== 'not_set') { <span class="row-sub">Checked {{ ago(i.checked_at) }}{{ usedWords(i) }}</span> }
            </span>
            <span class="int-act">
              @if (i.status === 'not_set') {
                <button class="btn btn-sm" [disabled]="!isOrgAdmin()" (click)="setup.set(i)"><app-icon name="plus" [size]="12"></app-icon> Set up</button>
              } @else {
                <label class="switch" [title]="i.status === 'connected' ? 'Turn off (setup is kept)' : 'Turn on'">
                  <input type="checkbox" [checked]="i.status === 'connected'" [disabled]="!isOrgAdmin()" (change)="toggleInt(i, $any($event.target).checked)" [attr.aria-label]="'Use ' + i.label" /><i></i>
                </label>
                <span class="row-menu">
                  <button class="btn-icon" (click)="openMenu(i.key, $event)" [attr.aria-label]="'Actions for ' + i.label" title="Actions"><app-icon name="moreVertical" [size]="15"></app-icon></button>
                  @if (menuFor() === i.key) {
                    <div class="row-menu-list floating" role="menu" [style.top.px]="menuPos().top" [style.left.px]="menuPos().left">
                      <button (click)="setup.set(i); menuFor.set('')"><app-icon name="edit" [size]="13"></app-icon> Edit setup</button>
                      <button (click)="setup.set(i); menuFor.set('')"><app-icon name="checks" [size]="13"></app-icon> Run checks again</button>
                      <hr />
                      <button class="danger" (click)="askRemove.set(i); menuFor.set('')"><app-icon name="trash" [size]="13"></app-icon> Remove</button>
                    </div>
                  }
                </span>
              }
            </span>
          </div>
        }
      </div>
    </ng-template>

    @if (catalogFor() !== null) {
      <app-integration-catalog [items]="catalogItems()" [category]="''" [title]="catalogFor() === 'telephony' ? 'Add a telephony provider' : 'Add an integration'"
        (pick)="catalogFor.set(null); setup.set($event)" (close)="catalogFor.set(null)"></app-integration-catalog>
    }
    @if (setup(); as it) {
      <app-connect [item]="it" [orgId]="org()" (close)="setup.set(null)" (saved)="onSaved($event)"></app-connect>
    }
    @if (askRemove(); as it) {
      <app-confirm [title]="'Remove ' + it.label + '?'" [body]="removeWords(it)" confirmLabel="Remove" [danger]="true" [busy]="removing()" (confirm)="remove(it)" (cancel)="askRemove.set(null)"></app-confirm>
    }
  `,
  styles: [`
    .hours { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .hours .input { width: auto; }
    .settings-tab.wide { max-width: 1100px; }
    .ints { border: 1px solid var(--line); border-radius: 8px; }
    .int-row { display: grid; grid-template-columns: minmax(140px, 220px) minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 9px 12px; border-bottom: 1px solid var(--line-soft); }
    .int-row:last-child { border-bottom: 0; }
    .int-row.off .int-name { color: var(--muted); }
    .int-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .int-name > span:last-child { display: grid; line-height: 1.25; min-width: 0; }
    .int-name small { font-size: 12px; color: var(--muted); }
    .int-logo { width: 30px; height: 30px; flex: 0 0 30px; border-radius: 8px; display: grid; place-items: center; font-family: var(--mono); font-size: 11px; font-weight: 600; color: #fff; }
    .int-empty { padding: 12px; }
    .set-head { display: flex; align-items: center; gap: 10px; }
    .set-head .set-title { margin-right: auto; }
    .int-state { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; min-width: 0; }
    .int-act { display: flex; gap: 8px; align-items: center; }
    .flow-bar { padding: 0; border: 0; }
    .flows th, .flows td { padding: 7px 12px; text-align: left; white-space: nowrap; }
    .flows tr.off td { color: var(--muted); }
    .data-head { display: flex; gap: 10px; align-items: center; justify-content: flex-end; }
    .data-list { border: 1px solid var(--line); border-radius: 8px; }
    .data-row { display: grid; grid-template-columns: minmax(200px, 1.2fr) minmax(170px, 0.8fr) minmax(0, 1.6fr); gap: 14px; padding: 12px; border-bottom: 1px solid var(--line-soft); align-items: start; }
    .data-row:last-child { border-bottom: 0; }
    .data-what, .data-keep { display: grid; gap: 3px; min-width: 0; }
    .data-what .row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; gap: 4px; align-items: center; }
    .keep { display: flex; gap: 6px; align-items: center; }
    .keep .input { width: 84px; }
    .data-rules { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
    .rule { display: flex; gap: 6px; align-items: center; }
    .rule app-icon { color: var(--muted); }
    @media (max-width: 760px) { .int-row, .data-row { grid-template-columns: 1fr; } }
  `],
})
export class SettingsComponent implements OnInit {
  private healthService = inject(HealthService);
  api = inject(ApiService);
  auth = inject(AuthService);
  apiBase = API_BASE || window.location.origin;
  healthData = this.healthService.health;
  today = this.healthService.todayMetrics;
  memberships = computed(() => this.auth.me()?.memberships || []);
  isOrgAdmin = computed(() => !!this.auth.me()?.platform_admin || this.auth.currentMembership()?.role === 'org_admin');
  readonly Math = Math;
  readonly PAGE = PAGE;

  readonly TABS: { key: Tab; label: string }[] = [
    { key: 'workspace', label: 'Workspace' }, { key: 'telephony', label: 'Telephony' }, { key: 'calling', label: 'Calling defaults' },
    { key: 'data', label: 'Data' }, { key: 'integrations', label: 'Integrations' }, { key: 'developer', label: 'Developer' },
  ];
  readonly DAYS = DAYS;
  readonly ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];
  readonly LANGS = [['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['hinglish', 'Hinglish'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar', 'Arabic']];
  readonly RETRYABLE = CALL_STATUSES.filter((s) => s.group !== 'in_progress' && s.group !== 'not_dialled').map((s) => ({ key: s.key, label: s.label, hover: statusHover(s.key) }));

  tab = signal<Tab>('workspace');
  s = signal<any>(null);
  private saved = signal('');
  dirty = computed(() => !!this.s() && JSON.stringify(this.s()) !== this.saved());
  saving = signal(false);
  error = signal('');
  toast = signal('');

  // Integrations
  ints = signal<any[]>([]);
  telephonyInts = computed(() => this.ints().filter((i) => i.kind === 'telephony'));
  destinationInts = computed(() => this.ints().filter((i) => i.kind === 'destination'));
  /** Everything that is not telephony: destinations and model keys. */
  otherInts = computed(() => this.ints().filter((i) => i.kind !== 'telephony'));
  setUp(list: any[]): any[] { return list.filter((i) => i.status !== 'not_set'); }
  /** Catalogue modal: null closed, 'telephony' for providers, '' for everything else. */
  catalogFor = signal<string | null>(null);
  catalogItems = computed(() => this.catalogFor() === 'telephony' ? this.telephonyInts() : this.otherInts());
  openCatalog(kind: string): void { this.catalogFor.set(kind); }
  initials(n: string): string { return n.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  tint(n: string): string { const pal = ['#d9232d', '#3d33a0', '#2a6247', '#9a5b0b', '#4a4540', '#a3121a', '#5a51c0', '#2e7d57']; let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return pal[h % pal.length]; }
  setup = signal<any>(null);
  askRemove = signal<any>(null);
  removing = signal(false);
  menuFor = signal('');
  menuPos = signal({ top: 0, left: 0 });
  private agents = signal<any[]>([]);

  // Calling flows
  flows = signal<any[]>([]);
  fetchedAt = signal<Record<string, string>>({});
  fetching = signal('');
  flowQ = signal('');
  flowShow = signal<'on' | 'all'>('on');
  flowProvider = signal('');
  flowLimit = signal(PAGE);
  flowProviders = computed(() => this.telephonyInts().filter((i) => i.status !== 'not_set'));
  onCount = computed(() => this.flows().filter((f) => f.enabled).length);
  matchedFlows = computed(() => {
    const q = this.flowQ().trim().toLowerCase();
    return this.flows()
      .filter((f) => (this.flowShow() === 'all' || f.enabled) && (!this.flowProvider() || f.provider === this.flowProvider()))
      .filter((f) => !q || f.name.toLowerCase().includes(q) || String(f.did || '').includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  });
  shownFlows = computed(() => this.matchedFlows().slice(0, this.flowLimit()));

  // Data
  policy = signal<any[]>([]);
  policyAt = signal('');

  roleWords = computed(() => ROLE_WORDS[this.auth.currentMembership()?.role || ''] || (this.auth.me()?.platform_admin ? 'Platform admin' : '—'));
  roleHelp = computed(() => 'Admins manage the team, settings, agents and every campaign. Campaign managers run campaigns. Members see the campaigns shared with their group.');

  ngOnInit(): void {
    this.loadAll();
    document.addEventListener('click', () => this.menuFor.set(''));
  }

  org(): string { return this.auth.currentOrgId(); }
  private async loadAll(): Promise<void> {
    if (!this.org()) return;
    this.api.orgSettings(this.org()).then((st) => { this.s.set(structuredClone(st)); this.saved.set(JSON.stringify(st)); }).catch((e) => this.error.set(e.message));
    this.loadInts(); this.loadFlows(); this.loadPolicy();
    try { this.agents.set((await this.api.agentList()).agents || []); } catch { this.agents.set([]); }
  }
  private loadInts(): void { this.api.integrations(this.org()).then((l) => this.ints.set(l)).catch((e) => this.error.set(e.message)); }
  private loadFlows(): void {
    this.api.telephonyFlows(this.org()).then((r) => { this.flows.set(r.flows || []); this.fetchedAt.set(r.fetched_at || {}); }).catch(() => this.flows.set([]));
  }
  loadPolicy(): void { this.api.dataPolicy(this.org()).then((p) => { this.policy.set(p); this.policyAt.set(new Date().toISOString()); }).catch(() => this.policy.set([])); }

  patch(part: string, c: any): void { this.s.update((x) => ({ ...x, [part]: { ...x[part], ...c } })); }
  patchHours(c: any): void { this.patch('workspace', { calling_hours: { ...this.s().workspace.calling_hours, ...c } }); }
  /** Days to keep, held inside what the outside rules allow. */
  patchDays(d: any, v: any): void { this.patch('data', { [d.setting]: Math.min(d.max, Math.max(d.min, Math.round(+v || d.min))) }); }
  toggleDay(d: string): void {
    const days: string[] = this.s().workspace.calling_hours.days;
    this.patchHours({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] });
  }
  toggleRetry(k: string, on: boolean): void {
    const cur: string[] = this.s().calling_defaults.on;
    this.patch('calling_defaults', { on: on ? [...new Set([...cur, k])] : cur.filter((x) => x !== k) });
  }
  discard(): void { this.s.set(JSON.parse(this.saved())); }
  async save(): Promise<void> {
    this.saving.set(true); this.error.set('');
    try {
      const st = await this.api.saveOrgSettings(this.org(), this.s());
      this.s.set(structuredClone(st)); this.saved.set(JSON.stringify(st));
      setNoReplyUnder(st.telephony?.no_reply_under_seconds);
      this.say('Settings saved.');
    } catch (e: any) { this.error.set(`Not saved: ${e.message}`); }
    finally { this.saving.set(false); }
  }

  ruleWords(r: any): string {
    if (r.kind === 'min') return `At least ${r.days} days · ${r.source}`;
    if (r.kind === 'max') return `Deleted by ${r.days} days · ${r.source}`;
    return r.days ? `Copy kept ${r.days} more days · ${r.source}` : `Separate copy · ${r.source}`;
  }

  // Integrations
  usedCount(i: any): number {
    return i.kind === 'destination'
      ? this.agents().filter((a) => a.synced_platform === i.key).length
      : this.agents().filter((a) => this.flows().some((f) => f.provider === i.key && f.name === a.ozonetel_campaign)).length;
  }
  usedWords(i: any): string { const n = this.usedCount(i); return n ? ` · used by ${n} agent${n === 1 ? '' : 's'}` : ''; }
  removeWords(i: any): string {
    const n = this.usedCount(i);
    const who = `${n} agent${n === 1 ? '' : 's'}`;
    const tail = !n ? '' : i.kind === 'telephony'
      ? ` ${who} call through its flows and stop calling until they pick another flow.`
      : ` ${who} send results here; their results stay in Echo until another destination is picked.`;
    return `Its setup and saved keys are deleted.${tail} To pause it instead, turn it off.`;
  }
  openMenu(key: string, e: MouseEvent): void {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPos.set({ top: r.bottom + 4, left: Math.max(8, r.right - 200) });
    this.menuFor.set(this.menuFor() === key ? '' : key);
  }
  onSaved(i: any): void {
    this.ints.update((l) => l.map((x) => (x.key === i.key ? i : x)));
    this.setup.set(null);
    this.say(`${i.label} checked and turned on.`);
    if (i.kind === 'telephony') this.loadFlows();
  }
  async toggleInt(i: any, on: boolean): Promise<void> {
    try { const r = await this.api.setIntegrationEnabled(this.org(), i.key, on); this.ints.update((l) => l.map((x) => (x.key === i.key ? r : x))); this.say(`${i.label} turned ${on ? 'on' : 'off'}.`); }
    catch (e: any) { this.error.set(e.message); }
  }
  async remove(i: any): Promise<void> {
    this.removing.set(true);
    try { await this.api.removeIntegration(this.org(), i.key); this.askRemove.set(null); this.say(`${i.label} removed.`); this.loadInts(); this.loadFlows(); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.removing.set(false); }
  }

  // Calling flows
  providerLabel(k: string): string { return this.ints().find((i) => i.key === k)?.label || k; }
  async setFlow(f: any, on: boolean): Promise<void> {
    try { const r = await this.api.setFlowEnabled(this.org(), f.name, on); this.flows.update((l) => l.map((x) => (x.name === f.name ? r : x))); }
    catch (e: any) { this.error.set(e.message); this.flows.update((l) => [...l]); }
  }
  async fetchFlows(provider: string): Promise<void> {
    this.fetching.set(provider);
    try { const r = await this.api.fetchFlows(this.org(), provider); this.say(r.added ? `${r.added} new flows found.` : 'No new flows.'); this.loadFlows(); }
    catch (e: any) { this.error.set(e.message); }
    finally { this.fetching.set(''); }
  }

  ago(ts: string): string {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 1000));
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  }
  switchOrg(orgId: string): void { this.auth.setCurrentOrg(orgId); window.location.reload(); }
  private say(m: string): void { this.toast.set(m); setTimeout(() => this.toast.set(''), 2600); }
}
