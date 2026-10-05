import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { HintComponent } from '../hint/hint.component';
import { callStatuses, GROUPS, OutcomeView } from '../../utils/status';

/**
 * Pick which final call statuses get another dial. One clean list, grouped the
 * way calls are counted (Reached, Not reached, Failed). Each row is a status and
 * a plain "Try again" or "Final" switch; the detail (what it means, how it is
 * decided, what happens next) is in the row's info popover on hover, focus or tap.
 * Used by Settings, Calling defaults and by each agent's Advanced settings.
 */
@Component({
  selector: 'app-status-picker',
  standalone: true,
  imports: [HintComponent],
  template: `
    <div class="sp-top">
      <span class="sp-sum"><b>{{ selected.length }}</b> of {{ all().length }} statuses get another dial</span>
      <span class="sp-presets" role="group" aria-label="Quick choices">
        <button type="button" class="btn btn-sm btn-ghost" (click)="set(recommended())">Recommended</button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="set(notReachedOnly())">Only when not reached</button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="set([])">Never</button>
      </span>
    </div>
    @for (g of groups(); track g.key) {
      <section class="sp-group" [attr.aria-label]="g.label">
        <div class="sp-gh"><i [class]="'sp-dot g-' + g.key" aria-hidden="true"></i>{{ g.label }}<span class="sp-gsub">{{ g.help }}</span></div>
        <ul class="sp-list">
          @for (s of g.items; track s.key) {
            <li class="sp-row">
              <span class="sp-name">{{ s.label }}</span>
              <app-hint [label]="'About ' + s.label" [heading]="s.label" [sections]="details(s)"></app-hint>
              <label class="sp-switch">
                <span class="switch"><input type="checkbox" [checked]="selected.includes(s.key)" (change)="toggle(s.key, $any($event.target).checked)" [attr.aria-label]="'Try again when ' + s.label" /><i></i></span>
                <span [class]="'sp-state ' + (selected.includes(s.key) ? 'on' : '')">{{ selected.includes(s.key) ? 'Try again' : 'Final' }}</span>
              </label>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [`
    :host { display: grid; gap: 12px; }
    .sp-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
    .sp-sum { font-size: var(--ds-fs-base); color: var(--ds-text-2); margin-right: auto; }
    .sp-sum b { color: var(--ds-text); }
    .sp-presets { display: flex; flex-wrap: wrap; gap: 4px; }
    .sp-group { border: 1px solid var(--ds-border); border-radius: var(--ds-r-lg); background: var(--ds-surface); overflow: clip; }
    .sp-gh { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; padding: 8px 12px; background: var(--ds-surface-sunken); border-bottom: 1px solid var(--ds-border-subtle); font-size: var(--ds-fs-sm); font-weight: 650; color: var(--ds-text); }
    .sp-gsub { font-weight: 400; color: var(--ds-text-muted); }
    .sp-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; align-self: center; }
    .g-reached { background: var(--ds-success); } .g-not_reached { background: var(--ds-danger); } .g-failed { background: var(--ds-warning); }
    .sp-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .sp-row { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 6px 12px; border-bottom: 1px solid var(--ds-border-subtle); border-right: 1px solid var(--ds-border-subtle); }
    .sp-name { font-size: var(--ds-fs-base); font-weight: 500; color: var(--ds-text); overflow-wrap: anywhere; }
    .sp-switch { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex: 0 0 auto; }
    .sp-state { font-size: var(--ds-fs-sm); color: var(--ds-text-muted); min-width: 62px; }
    .sp-state.on { color: var(--ds-success-fg); font-weight: 600; }
  `],
})
export class StatusPickerComponent {
  @Input() selected: string[] = [];
  @Input() tries = 3;
  @Input() gapMinutes = 60;
  @Output() selectedChange = new EventEmitter<string[]>();

  all = signal<OutcomeView[]>(callStatuses().filter((s) => ['reached', 'not_reached', 'failed'].includes(s.group)));
  groups = computed(() => GROUPS.filter((g) => ['reached', 'not_reached', 'failed'].includes(g.key))
    .map((g) => ({ ...g, items: this.all().filter((s) => s.group === g.key) })));
  recommended = computed(() => this.all().filter((s) => s.retry).map((s) => s.key));
  notReachedOnly = computed(() => this.all().filter((s) => s.retry && s.group !== 'reached').map((s) => s.key));

  /** Status, what it means, how it is decided, what happens next. */
  details(s: OutcomeView): { k: string; v: string }[] {
    const on = this.selected.includes(s.key);
    return [
      { k: 'What it means', v: s.help },
      { k: 'How it is decided', v: s.ozonetel },
      { k: 'What happens next', v: on ? `Dialled again after ${this.gapMinutes} min, up to ${this.tries} tries in all; then this status is final.` : 'Final: no more dials; the row goes to results with this status.' },
    ];
  }
  toggle(k: string, on: boolean): void { this.set(on ? [...new Set([...this.selected, k])] : this.selected.filter((x) => x !== k)); }
  set(keys: string[]): void { this.selected = keys; this.selectedChange.emit(keys); }
}
