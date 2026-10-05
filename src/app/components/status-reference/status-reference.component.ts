import { Component, HostListener, Input, signal } from '@angular/core';
import { callStatuses, CAMPAIGN_STATUSES, GROUPS } from '../../utils/status';
import { IconComponent } from '../icon/icon.component';

/**
 * "Call statuses" reference: every status, what it means, the exact telephony
 * values that produce it, and whether Echo dials again by default. Opened from
 * a small link next to any status list, so the definitions are one click away
 * wherever a status is shown. `highlight` marks the status being looked at.
 */
@Component({
  selector: 'app-status-reference',
  standalone: true,
  imports: [IconComponent],
  template: `
    <button type="button" class="sr-link" (click)="open.set(true); $event.stopPropagation()" title="What each status means and exactly how it is worked out">
      <app-icon name="book" [size]="13"></app-icon> {{ label }}
    </button>
    @if (open()) {
      <div class="modal-backdrop" (click)="open.set(false)">
        <div class="modal sr" role="dialog" aria-label="Call statuses" (click)="$event.stopPropagation()">
          <div class="modal-head sr-head">
            <div>
              <div class="modal-title">Statuses</div>
              <div class="row-sub">Each call has one status, worked out from the telephony service status for the dial and what the agent heard. Rules are checked top to bottom.</div>
            </div>
            <button class="btn-icon" (click)="open.set(false)" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button>
          </div>
          <div class="modal-body sr-body">
            <div class="sr-group">Campaign statuses <span class="row-sub">· follow from the call statuses</span></div>
            @for (c of campaigns; track c.key) {
              <div class="sr-row sr-camp"><span><span [class]="'tag ' + c.cls">{{ c.label }}</span></span><span class="sr-mean">{{ c.hint }}</span></div>
            }
            <div class="sr-group" style="margin-top: 18px">Call statuses</div>
            @for (g of groups; track g.key) {
              <div class="sr-group"><i [class]="'g-' + g.key"></i>{{ g.label }} <span class="row-sub">· {{ g.help }}</span></div>
              @for (s of byGroup(g.key); track s.key) {
                <div [class]="'sr-row' + (s.key === highlight ? ' on' : '')">
                  <span><span [class]="'tag ' + s.cls">{{ s.label }}</span></span>
                  <span class="sr-mean">{{ s.help }}</span>
                  <span class="sr-oz mono">{{ s.ozonetel }}</span>
                  <span class="sr-retry" [title]="s.retry ? 'Dialled again by default (change in the agent settings)' : 'Not dialled again'">
                    @if (s.retry) { <app-icon name="repeat" [size]="13"></app-icon> } @else { <span class="row-sub">–</span> }
                  </span>
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .sr-link { display: inline-flex; gap: 4px; align-items: center; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 6px; min-height: 24px; border-radius: 6px; }
    .sr-link:hover { color: var(--ds-accent-fg); background: var(--red-wash); }
    .sr { max-width: 860px; width: calc(100vw - 32px); }
    .sr-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    .sr-head .row-sub { white-space: normal; max-width: 640px; margin-top: 2px; }
    .sr-body { max-height: 70vh; overflow-y: auto; padding-top: 4px; }
    .sr-group { display: flex; align-items: center; gap: 6px; margin: 14px 0 6px; font-weight: 600; font-size: 13px; color: var(--ink-2); }
    .sr-group i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
    .sr-row { display: grid; grid-template-columns: 130px minmax(0, 1fr) minmax(0, 1.3fr) 28px; gap: 12px; align-items: center; padding: 7px 8px; border-radius: 8px; font-size: 13px; }
    .sr-row:nth-child(even) { background: var(--raised); }
    .sr-row.on { outline: 2px solid var(--red); background: var(--red-wash); }
    .sr-mean { color: var(--ink-2); }
    .sr-oz { color: var(--muted); font-size: 12px; }
    .sr-retry { color: var(--ink-3); text-align: center; }
    .sr-camp { grid-template-columns: 150px minmax(0, 1fr); }
    @media (max-width: 720px) { .sr-row { grid-template-columns: 110px minmax(0, 1fr); } .sr-oz { grid-column: 1 / -1; } .sr-retry { display: none; } }
  `],
})
export class StatusReferenceComponent {
  @Input() label = 'Call statuses';
  @Input() highlight = '';
  open = signal(false);
  campaigns = CAMPAIGN_STATUSES;
  groups = [GROUPS[3], GROUPS[0], GROUPS[1], GROUPS[2], GROUPS[4]];
  byGroup(g: string) { return callStatuses().filter((s) => s.group === g); }
  @HostListener('document:keydown.escape') esc(): void { this.open.set(false); }
}
