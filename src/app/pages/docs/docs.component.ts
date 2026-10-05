import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { GuideComponent } from '../../components/guide/guide.component';
import { callStatuses, GROUPS, CAMPAIGN_STATUSES } from '../../utils/status';

interface Topic { id: string; title: string; icon: string; guides?: string[]; body: string[]; link?: { to: string; label: string } }

/**
 * Documentation inside Echo: how the product works, in plain words, built from
 * the same data the screens use (statuses and their rules come from utils/status,
 * animations from the guides), so it never drifts from the product.
 * A public docs site can replace or link from here later.
 */
@Component({
  selector: 'app-docs',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, GuideComponent],
  template: `
    <div class="page docs">
      <div class="page-head">
        <h1 class="page-title">Documentation</h1>
        <label class="docs-search"><app-icon name="search" [size]="14"></app-icon><input class="input" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Search the docs" aria-label="Search the docs" /></label>
      </div>
      <div class="docs-grid">
        <nav class="docs-toc" aria-label="Topics">
          @for (t of shown(); track t.id) { <a [href]="'#' + t.id" (click)="go($event, t.id)"><app-icon [name]="t.icon" [size]="14"></app-icon> {{ t.title }}</a> }
          <a href="#statuses" (click)="go($event, 'statuses')"><app-icon name="activity" [size]="14"></app-icon> Call statuses</a>
          <a href="#keys" (click)="go($event, 'keys')"><app-icon name="key" [size]="14"></app-icon> Keyboard</a>
        </nav>
        <div class="docs-body">
          @for (t of shown(); track t.id) {
            <section class="card docs-sec" [id]="t.id">
              <div class="card-head"><span class="card-title"><app-icon [name]="t.icon" [size]="14"></app-icon> {{ t.title }}</span>
                @if (t.link) { <a class="btn btn-sm" [routerLink]="t.link.to">{{ t.link.label }}</a> }</div>
              <div class="card-body">
                @for (p of t.body; track $index) { <p class="docs-p">{{ p }}</p> }
                @if (t.guides?.length) { <div class="docs-guides">See it: @for (g of t.guides; track g) { <app-guide [topic]="g"></app-guide> }</div> }
              </div>
            </section>
          }
          @if (!shown().length && q()) { <div class="empty"><div class="empty-title">Nothing matches "{{ q() }}"</div><div class="empty-sub">Try a shorter word, such as status, retry or flow.</div></div> }

          <section class="card docs-sec" id="statuses">
            <div class="card-head"><span class="card-title"><app-icon name="activity" [size]="14"></app-icon> Call statuses</span></div>
            <div class="card-body">
              <p class="docs-p">Every call ends with exactly one status, worked out from the telephony service status for the dial and what the agent heard. Rules are checked top to bottom. Campaign statuses follow from the call statuses.</p>
              @for (g of groups; track g.key) {
                <h3 class="docs-h">{{ g.label }} <span class="row-sub">· {{ g.help }}</span></h3>
                <div class="scroll-x">
                  <table class="table docs-table">
                    <thead><tr><th>Status</th><th>What it means</th><th>How it is decided</th><th>Tried again by default</th></tr></thead>
                    <tbody>@for (s of byGroup(g.key); track s.key) { <tr><td><span [class]="'tag ' + s.cls">{{ s.label }}</span></td><td>{{ s.help }}</td><td class="docs-rule">{{ s.ozonetel }}</td><td>{{ s.retry ? 'Yes' : 'No' }}</td></tr> }</tbody>
                  </table>
                </div>
              }
              <h3 class="docs-h">Campaign statuses</h3>
              <ul class="docs-list">@for (c of campaign; track c.key) { <li><span [class]="'tag ' + c.cls">{{ c.label }}</span> {{ c.hint }}</li> }</ul>
            </div>
          </section>

          <section class="card docs-sec" id="keys">
            <div class="card-head"><span class="card-title"><app-icon name="key" [size]="14"></app-icon> Keyboard</span></div>
            <div class="card-body">
              <dl class="docs-keys">
                <dt><kbd>Tab</kbd></dt><dd>Move between controls; info icons open when focused</dd>
                <dt><kbd>Esc</kbd></dt><dd>Close a popover, menu or modal</dd>
                <dt><kbd>j</kbd> / <kbd>k</kbd></dt><dd>Next or previous call on a call page</dd>
                <dt><kbd>Space</kbd></dt><dd>Play or pause a recording</dd>
                <dt><kbd>Ctrl</kbd> + <kbd>S</kbd></dt><dd>Save an agent</dd>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .docs { max-width: 1200px; }
    .docs-search { position: relative; width: min(320px, 100%); }
    .docs-search app-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--ds-text-placeholder); pointer-events: none; }
    .docs-search .input { padding-left: 32px; }
    .docs-grid { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-items: start; }
    .docs-toc { position: sticky; top: 8px; display: grid; gap: 2px; }
    .docs-toc a { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 0 10px; border-radius: var(--ds-r-sm); color: var(--ds-text-2); font-size: var(--ds-fs-base); text-decoration: none; }
    .docs-toc a:hover { background: var(--ds-hover); color: var(--ds-text); }
    .docs-body { display: grid; gap: 12px; min-width: 0; }
    .docs-sec { scroll-margin-top: 12px; }
    .docs-p { margin: 0 0 8px; font-size: var(--ds-fs-md); line-height: 1.6; color: var(--ds-text-2); max-width: 72ch; }
    .docs-guides { display: flex; align-items: center; gap: 6px; font-size: var(--ds-fs-sm); color: var(--ds-text-muted); margin-top: 4px; }
    .docs-h { font-size: var(--ds-fs-md); font-weight: 650; margin: 16px 0 6px; color: var(--ds-text); }
    .docs-table th, .docs-table td { padding: 8px 10px; text-align: left; vertical-align: top; font-size: var(--ds-fs-base); }
    .docs-table th { white-space: nowrap; }
    .docs-rule { color: var(--ds-text-muted); min-width: 260px; }
    .docs-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: var(--ds-fs-base); color: var(--ds-text-2); }
    .docs-keys { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: var(--ds-fs-base); }
    .docs-keys dd { margin: 0; color: var(--ds-text-2); }
    kbd { font-family: var(--ds-mono); font-size: var(--ds-fs-xs); padding: 1px 6px; border: 1px solid var(--ds-border-strong); border-bottom-width: 2px; border-radius: var(--ds-r-xs); background: var(--ds-surface-sunken); color: var(--ds-text); }
    @media (max-width: 860px) { .docs-grid { grid-template-columns: 1fr; } .docs-toc { position: static; display: flex; flex-wrap: wrap; } }
  `],
})
export class DocsComponent {
  q = signal('');
  readonly groups = GROUPS.filter((g) => g.key !== 'in_progress').concat(GROUPS.filter((g) => g.key === 'in_progress'));
  readonly campaign = CAMPAIGN_STATUSES;
  byGroup(g: string) { return callStatuses().filter((s) => s.group === g); }
  readonly topics: Topic[] = [
    { id: 'start', title: 'Getting started', icon: 'play', link: { to: '/campaigns', label: 'Open Campaigns' }, body: [
      '1. Connect a telephony provider and turn on the calling flows agents may use (Settings, Telephony).',
      '2. Create an agent: write the prompt, list the call data it needs and the answers it must collect (Agents).',
      '3. Test it from the Call console in your browser or on your phone.',
      '4. Start a campaign: pick the agent, download its template, fill it in, drop it back and start.'] },
    { id: 'agents', title: 'Agents', icon: 'bot', guides: ['one_row', 'group_rows'], link: { to: '/agents', label: 'Open Agents' }, body: [
      'An agent is a prompt, the call data it is given, the answers it collects and how it sounds. Tabs: Prompt, Call data, Answers, Settings.',
      'Call data can be one row per call, or several rows per call grouped by any column, so one contact hears about all their items at once.',
      'Voice and brain: one voice to voice model, or the sandwich (listen, think, speak) with separate models. Advanced adds a backup model and conversation settings.'] },
    { id: 'campaigns', title: 'Campaigns', icon: 'megaphone', guides: ['check_file'], body: [
      'A campaign is one uploaded sheet run by one agent. The sheet is checked first, so you see how many rows become calls before anything is dialled.',
      'Every call has a call status; filter by status, open any call for its recording, transcript, answers and every dial.'] },
    { id: 'retries', title: 'Trying again', icon: 'repeat', guides: ['retry', 'retry_answer'], body: [
      'Pick which final statuses get another dial, how many tries in all and the wait between them. You can also try again when an answer has a given value, such as a call back request.',
      'Workspace defaults are in Settings, Calling defaults; each agent can change them under Settings, Advanced.'] },
    { id: 'telephony', title: 'Telephony and calling flows', icon: 'route', guides: ['line'], link: { to: '/settings', label: 'Open Settings' }, body: [
      'Set up a provider; Echo checks the connection before saving. Echo then fetches every calling flow from the provider; turn on the few agents may use.',
      'Answered calls shorter than the No reply cut-off (5 seconds by default) count as No reply.'] },
    { id: 'integrations', title: 'Integrations and results', icon: 'plug', guides: ['destination'], body: [
      'Connect a CRM, helpdesk, sheet, database, webhook or your own model keys from the catalogue in Settings, Integrations. Every integration is checked before it is saved and can be turned off without losing its setup.',
      'Each agent sends results to one connected destination: one update per row with its call status and answers.'] },
    { id: 'data', title: 'Data and retention', icon: 'database', body: [
      'Settings, Data shows where recordings, transcripts and files are kept, and the storage and provider rules that set the shortest and longest time they can be kept.'] },
  ];
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.topics.filter((t) => (t.title + ' ' + t.body.join(' ')).toLowerCase().includes(q)) : this.topics;
  });
  go(e: Event, id: string): void { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
