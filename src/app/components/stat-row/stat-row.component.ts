import { Component, computed, inject, input, signal } from '@angular/core';
import { EchoLoaderComponent } from '../echo-mark/echo-mark.component';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { HintComponent } from '../hint/hint.component';
import { IconComponent } from '../icon/icon.component';

interface Tile { key: string; label: string; help: string; count: number; sub: string }

/**
 * What is done and what waits on a person, for any agent: one result per contact and five stats.
 * Every number opens the rows behind it. The same row sits on the Overview and on each campaign page.
 */
@Component({
  selector: 'app-stat-row',
  standalone: true,
  imports: [EchoLoaderComponent, RouterLink, HintComponent, IconComponent],
  template: `
    <div class="card sr">
      @if (total()) {
        <div class="sr-head">
          <span class="card-title">Result</span>
          <app-hint text="Every contact, or every row when several rows share a call, ends in one of four results. Successful: the call completed and its answers were saved. Needs action: a person has to do something; open it to see what. In progress: calling is still trying, or a call back is due. Closed: nothing more will happen. When an agent has its own goal, that goal decides what successful means."></app-hint>
          <span style="flex: 1"></span><span class="row-sub">{{ total() }} {{ unit() }}</span>
        </div>
        <div class="sr-bar" role="group" aria-label="Result">
          @for (s of segments(); track s.key) {
            @if (s.count) { <button type="button" [class]="'sr-seg ' + s.key" [style.flex-grow]="s.count" (click)="open(s.key, s.label, s.help)" [attr.aria-label]="s.label + ': ' + s.count"></button> }
          }
        </div>
        <div class="sr-legend">
          @for (s of segments(); track s.key) {
            <button type="button" class="sr-leg" [disabled]="!s.count" (click)="open(s.key, s.label, s.help)"><i [class]="'sr-dot ' + s.key"></i>{{ s.label }} <b>{{ s.count }}</b></button>
          }
        </div>
      }
      <div class="sr-tiles">
        @for (t of tiles(); track t.key) {
          <div [class]="'sr-tile' + (t.count ? '' : ' zero')">
            <button type="button" class="sr-open" [disabled]="!t.count" (click)="open(t.key, t.label, t.help)" [attr.aria-label]="t.label + ': ' + t.count + '. Open the list'">
              <span class="sr-n">{{ t.count }}</span>
            </button>
            <span class="sr-l">{{ t.label }} <app-hint [text]="t.help"></app-hint></span>
            <span class="sr-sub">{{ t.sub }}</span>
          </div>
        }
      </div>
    </div>

    @if (list(); as l) {
      <div class="modal-backdrop" (click)="list.set(null)">
        <div class="modal sr-modal" role="dialog" [attr.aria-label]="l.label" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <div>
              <div class="modal-title">{{ l.label }} <span class="pill">{{ l.total ?? '…' }}</span></div>
              <div class="modal-sub">{{ l.help }}</div>
            </div>
            <button class="icon-btn" (click)="list.set(null)" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button>
          </div>
          <div class="modal-body flush">
            @if (!l.rows) { <app-echo-loader label="Loading rows" [size]="32"></app-echo-loader> }
            @for (r of l.rows || []; track r.campaign_id + r.primary_id) {
              <a class="sr-item" [routerLink]="['/campaigns', r.campaign_id, 'contacts', r.primary_id]" (click)="list.set(null)">
                <span><span class="sr-name">{{ r.name || r.phone }}</span><span class="row-sub mono">{{ r.phone }}</span></span>
                <span><span class="tag muted">{{ r.status }}</span></span>
                <span class="sr-why">{{ r.why }}@if (r.call_back) { <span class="row-sub"> · call back {{ r.call_back }}</span> }</span>
                <span class="row-sub sr-camp">{{ clean(r.campaign_name) }}</span>
                <app-icon name="chevronRight" [size]="14"></app-icon>
              </a>
            }
          </div>
          @if (l.key === 'follow_up' || l.key === 'needs_action' || l.key === 'answers_missing') {
            <div class="modal-foot"><span class="row-sub">Owner, notes, a corrected number and call again are in Follow ups.</span><span style="flex: 1"></span><a class="btn primary" routerLink="/follow-ups" (click)="list.set(null)">Open Follow ups</a></div>
          }
        </div>
      </div>
    }
  `,
})
export class StatRowComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  stats = input<any>(null);
  result = input<any>(null);
  /** What a result is counted in: contacts, or rows when several rows share a call. */
  unit = input<string>('contacts');
  /** Query that scopes the rows: days, agent, campaign_id. */
  scope = input<Record<string, string>>({});
  list = signal<{ key: string; label: string; help: string; total?: number; rows?: any[] } | null>(null);

  total = computed(() => Object.values(this.result() || {}).reduce((n: number, v: any) => n + (Number(v) || 0), 0));
  segments = computed(() => {
    const r = this.result() || {};
    return [
      { key: 'successful', label: 'Successful', count: r.successful || 0, help: 'The call completed and its answers were saved.' },
      { key: 'needs_action', label: 'Needs action', count: r.needs_action || 0, help: 'A person has to do something: correct a number, call by hand, fill in missing answers or fix a rejected row.' },
      { key: 'in_progress', label: 'In progress', count: r.in_progress || 0, help: 'Waiting, calling, a retry is booked, or the contact asked to be called later.' },
      { key: 'closed', label: 'Closed', count: r.closed || 0, help: 'Nothing more will happen and nothing is left to do: for example the contact picked up and never spoke, or the campaign was stopped.' },
    ];
  });
  tiles = computed<Tile[]>(() => {
    const s = this.stats() || {};
    const why = (s.not_dialled_why || []).map((w: any) => `${w.label} ${w.count}`).join(' · ');
    return [
      { key: 'follow_up', label: 'Needs follow up', count: s.follow_up || 0, sub: 'waiting on a person', help: 'Contacts that calling alone cannot settle: blocked, wrong number, rejected, every try used, or answers missing. Each one gets an owner in Follow ups.' },
      { key: 'callbacks_due', label: 'Call backs due', count: s.callbacks_due || 0, sub: 'asked to be called later', help: 'Contacts who asked to be called later. Echo calls back at the time given; until then they count as in progress.' },
      { key: 'answers_missing', label: 'Answers missing', count: s.answers_missing || 0, sub: 'spoke, nothing saved', help: 'The contact spoke but no answers were saved, even after Echo read the transcript. A call like this is never shown as Completed.' },
      { key: 'tech_failures', label: 'No audio', count: s.tech_failures || 0, sub: 'picked up, no sound', help: 'Calls that were picked up and had no audio either way. They are retried by the retry rules of the agent.' },
      { key: 'not_dialled', label: 'Not dialled', count: s.not_dialled || 0, sub: why || 'every row was dialled', help: 'Rows that were never dialled, with the reason: failed the upload check, repeated number, stopped, expired, or no calling line set for the agent.' },
    ];
  });

  clean(name: string): string { return (name || '').replace(/_[0-9a-f]{20,}$/, ''); }

  async open(key: string, label: string, help: string): Promise<void> {
    this.list.set({ key, label, help });
    try {
      const r = await this.api.reportRows({ ...this.scope(), stat: key });
      if (this.list()?.key === key) this.list.set({ key, label, help, total: r.total, rows: r.rows });
    } catch { if (this.list()?.key === key) this.list.set({ key, label, help, total: 0, rows: [] }); }
  }
}
