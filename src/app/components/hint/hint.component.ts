import { Component, HostListener, Input, signal } from '@angular/core';

let uid = 0;

/**
 * Standard info icon: a small, quiet "i" with a tooltip, so screens carry no
 * explanatory subtitles.
 *
 * Opens on hover or keyboard focus and closes by itself when the pointer or
 * focus leaves; a tap toggles it on touch screens; Escape closes it. The text is
 * linked to the icon with aria-describedby, so screen readers read it on focus.
 * Placed on the page (fixed), so a scrolling box never cuts it off. For ideas
 * that need a picture, use app-guide (the animated info icon) instead.
 */
@Component({
  selector: 'app-hint',
  standalone: true,
  template: `
    <span class="h-i" tabindex="0" role="button" [attr.aria-label]="label" [attr.aria-describedby]="open() ? id : null" [attr.aria-expanded]="open()"
      (pointerenter)="enter($event)" (pointerleave)="leave()" (focus)="show($event)" (blur)="hide()" (click)="tap($event)" (keydown.enter)="tap($event)">
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r="0.7" class="d" /></svg>
    </span>
    @if (open()) {
      <span class="h-tip" role="tooltip" [id]="id" [class.above]="pos().above" [style.top.px]="pos().top" [style.left.px]="pos().left">
        @if (heading) { <b class="h-head">{{ heading }}</b> }
        @if (sections?.length) {
          @for (x of sections; track x.k) { <span class="h-sec"><span class="h-k">{{ x.k }}</span><span>{{ x.v }}</span></span> }
        } @else { {{ text }} }
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .h-i { display: inline-flex; margin-left: 2px; padding: 2px; color: var(--ds-text-placeholder); cursor: help; border-radius: 50%; }
    .h-i:hover, .h-i[aria-expanded="true"] { color: var(--ds-text); }
    .h-i:focus-visible { outline: 2px solid var(--ds-focus, currentColor); outline-offset: 1px; }
    .h-i svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .h-i .d { fill: currentColor; stroke: none; }
    .h-tip { position: fixed; z-index: 1300; max-width: 320px; padding: 9px 11px; border-radius: var(--ds-r-md); background: var(--ds-tooltip-bg); color: var(--ds-tooltip-text);
      font-family: var(--ds-font); font-size: var(--ds-fs-sm); font-weight: 400; line-height: 1.5; text-align: left; text-transform: none; letter-spacing: 0; white-space: pre-line;
      box-shadow: var(--ds-shadow-md); pointer-events: none; animation: h-in .14s var(--ds-ease) both; }
    /* Above the icon: the bottom edge sits just over it, whatever the text length. */
    .h-head { display: block; font-weight: 650; margin-bottom: 4px; }
    .h-sec { display: block; margin-top: 4px; }
    .h-k { display: block; font-family: var(--ds-mono); font-size: var(--ds-fs-xs); letter-spacing: .08em; text-transform: uppercase; opacity: .72; }
    .h-tip.above { animation-name: h-in-up; translate: 0 -100%; }
    @keyframes h-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
    @keyframes h-in-up { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
  `],
})
export class HintComponent {
  @Input() text = '';
  /** Optional structured content: a heading and labelled sections, instead of plain text. */
  @Input() heading = '';
  @Input() sections: { k: string; v: string }[] | null = null;
  /** Accessible name for the icon; the tooltip text is its description. */
  @Input() label = 'More information';
  readonly id = `hint-${++uid}`;
  open = signal(false);
  pos = signal({ top: 0, left: 0, above: false });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pinned = false;

  enter(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const el = e.currentTarget as HTMLElement;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.place(el), 120);
  }
  leave(): void { clearTimeout(this.timer); if (!this.pinned) this.open.set(false); }
  show(e: Event): void { this.place(e.currentTarget as HTMLElement); }
  hide(): void { clearTimeout(this.timer); this.pinned = false; this.open.set(false); }
  /** Touch and keyboard: a tap or Enter toggles and keeps it open until the next tap, blur or Escape. */
  tap(e: Event): void {
    e.stopPropagation(); e.preventDefault();
    this.pinned = !this.open() || !this.pinned;
    if (this.pinned) this.place(e.currentTarget as HTMLElement); else this.open.set(false);
  }
  private place(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const W = Math.min(300, window.innerWidth - 16);
    const above = r.bottom + 110 > window.innerHeight;
    this.pos.set({ above, top: above ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left - 12, window.innerWidth - W - 8)) });
    this.open.set(true);
  }
  @HostListener('document:keydown.escape') esc(): void { this.hide(); }
  @HostListener('window:scroll') scrolled(): void { if (this.open()) this.hide(); }
  @HostListener('document:click') outside(): void { if (this.pinned) this.hide(); }
}
