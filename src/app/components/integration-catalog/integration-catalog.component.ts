import { Component, EventEmitter, HostListener, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

/**
 * Pick an integration from a catalogue of any size: search by name, filter by
 * category, see what is already set up. Choosing one opens its setup flow.
 */
@Component({
  selector: 'app-integration-catalog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal ic" role="dialog" [attr.aria-label]="title" (click)="$event.stopPropagation()">
        <div class="modal-head ic-head">
          <div class="modal-title">{{ title }}</div>
          <button class="icon-btn" (click)="close.emit()" aria-label="Close"><app-icon name="close" [size]="15"></app-icon></button>
        </div>
        <div class="ic-tools">
          <label class="ic-search"><app-icon name="search" [size]="14"></app-icon><input class="input" #q [ngModel]="query()" (ngModelChange)="query.set($event)" [placeholder]="'Search ' + items.length + ' integrations'" aria-label="Search integrations" autofocus /></label>
          @if (cats().length > 1) {
            <div class="ic-cats" role="group" aria-label="Category">
              <button type="button" [class.on]="!cat()" (click)="cat.set('')">All <span>{{ items.length }}</span></button>
              @for (c of cats(); track c.key) { <button type="button" [class.on]="cat() === c.key" (click)="cat.set(c.key)">{{ c.label }} <span>{{ c.count }}</span></button> }
            </div>
          }
        </div>
        <div class="modal-body ic-body">
          <div class="ic-grid">
            @for (i of shown(); track i.key) {
              <button type="button" class="ic-card" (click)="pick.emit(i)" [title]="i.blurb">
                <span class="ic-logo" [style.background]="tint(i.label)">{{ initials(i.label) }}</span>
                <span class="ic-main"><b>{{ i.label }}</b><small>{{ i.category_label }}</small></span>
                @if (i.status === 'connected') { <span class="tag ok">On</span> }
                @else if (i.status === 'disabled') { <span class="tag muted">Off</span> }
                @else { <app-icon name="plus" [size]="14" class="ic-add"></app-icon> }
              </button>
            }
          </div>
          @if (!shown().length) { <div class="row-sub ic-none">Nothing matches. Webhook works with any system that takes a web address.</div> }
        </div>
        <div class="modal-foot"><span class="row-sub">{{ shown().length }} of {{ items.length }}</span></div>
      </div>
    </div>
  `,
  styles: [`
    .ic { max-width: 760px; width: calc(100vw - 32px); height: min(640px, 86vh); display: flex; flex-direction: column; }
    .ic-head { display: flex; align-items: center; justify-content: space-between; }
    .ic-tools { display: grid; gap: 10px; padding: 12px 18px 0; }
    .ic-search { position: relative; display: block; width: 100%; }
    .ic-search app-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--faint); pointer-events: none; }
    .ic-search .input { width: 100%; padding-left: 32px; }
    .ic-cats { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
    .ic-cats button { white-space: nowrap; border: 1px solid var(--line); background: var(--card); color: var(--ink-3); border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer; }
    .ic-cats button span { color: var(--faint); margin-left: 3px; }
    .ic-cats button.on { background: var(--ink); color: var(--on-ink); border-color: var(--ink); }
    .ic-cats button.on span { color: inherit; opacity: .7; }
    .ic-body { flex: 1; overflow-y: auto; padding: 12px 18px 16px; }
    .ic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
    .ic-card { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); cursor: pointer; text-align: left; font: inherit; color: var(--ink); min-width: 0; }
    .ic-card:hover { border-color: var(--ink-3); }
    .ic-logo { width: 34px; height: 34px; flex: 0 0 34px; border-radius: 8px; display: grid; place-items: center; font-family: var(--mono); font-size: 12px; font-weight: 600; color: #fff; }
    .ic-main { display: grid; min-width: 0; flex: 1; line-height: 1.25; }
    .ic-main b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ic-main small { font-size: 12px; color: var(--muted); }
    .ic-add { color: var(--faint); }
    .ic-none { padding: 20px 4px; }
  `],
})
export class IntegrationCatalogComponent {
  @Input() items: any[] = [];
  @Input() title = 'Add an integration';
  @Input() set category(c: string) { this.cat.set(c || ''); }
  @Output() pick = new EventEmitter<any>();
  @Output() close = new EventEmitter<void>();
  query = signal('');
  cat = signal('');
  cats = computed(() => {
    const m = new Map<string, { key: string; label: string; count: number }>();
    for (const i of this.items) { const c = m.get(i.category) || { key: i.category, label: i.category_label, count: 0 }; c.count++; m.set(i.category, c); }
    return [...m.values()];
  });
  shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items.filter((i) => (!this.cat() || i.category === this.cat()) && (!q || i.label.toLowerCase().includes(q) || i.category_label.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.status !== 'not_set') - Number(a.status !== 'not_set') || a.label.localeCompare(b.label));
  });
  initials(n: string): string { return n.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  /** A steady colour per name, from the warm palette. */
  tint(n: string): string {
    const pal = ['#d9232d', '#3d33a0', '#2a6247', '#9a5b0b', '#4a4540', '#a3121a', '#5a51c0', '#2e7d57'];
    let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pal[h % pal.length];
  }
  @HostListener('document:keydown.escape') onEsc(): void { this.close.emit(); }
}
