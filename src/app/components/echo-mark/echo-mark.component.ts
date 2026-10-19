import { Component, Input } from '@angular/core';

/**
 * The Echo mark (the e with two echo arcs) and its motion, from the Echo Motion Kit:
 *   still   the mark
 *   intro   the e draws, the arcs follow, one echo ripples out (once, about 1.6 s)
 *   loader  the arcs pulse outward and an echo ripples (1.6 s loop) for pages that take a moment
 *   inline  the arcs blink in turn (1 s loop) for buttons and small busy states
 *   live    rings keep leaving the mark (1.2 s loop) while a call is on the line
 * Reduced motion shows the still mark.
 */
@Component({
  selector: 'app-echo-mark',
  standalone: true,
  host: { '[class]': "'em em-' + mode + (tile ? '' : ' em-bare')", '[style.width.px]': 'size', '[style.height.px]': 'size', 'aria-hidden': 'true' },
  template: `
    <svg viewBox="-16 -16 96 96">
      <path class="em-g em-g1" d="M-4.4 57.75A45.5 45.5 0 0 1 46.78 -8.95" />
      <path class="em-g em-g2" d="M2.53 53.75A37.5 37.5 0 0 1 44.71 -1.22" />
      <g class="em-tile">
        @if (tile) { <rect width="64" height="64" rx="15" class="em-bg" /> }
        <path class="em-s em-r2" pathLength="1" d="M9.45 49.75A29.5 29.5 0 0 1 42.64 6.51" stroke-width="4" />
        <path class="em-s em-r1" pathLength="1" d="M16.38 45.75A21.5 21.5 0 0 1 40.56 14.23" stroke-width="4.4" />
        <path class="em-s em-e" pathLength="1" d="M22.5 35H47.5M47.5 35A12.5 12.5 0 1 0 44.29 43.36" stroke-width="6.4" />
      </g>
    </svg>
  `,
  styles: [`
    :host { display: inline-block; flex: none; line-height: 0; --em-tile: #047857; --em-ink: #fff; --em-ghost: #10B981; }
    :host(.em-bare) { --em-ink: var(--ds-accent, #047857); }
    svg { width: 100%; height: 100%; overflow: visible; }
    .em-bg { fill: var(--em-tile); }
    .em-s { fill: none; stroke: var(--em-ink); stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 0; }
    .em-r1 { opacity: .62; } .em-r2 { opacity: .32; }
    .em-g { fill: none; stroke: var(--em-ghost); stroke-width: 3; stroke-linecap: round; opacity: 0; transform-box: view-box; transform-origin: 35px 35px; }
    .em-tile { transform-box: view-box; transform-origin: 32px 32px; }

    :host(.em-intro) .em-tile { animation: emTile .52s cubic-bezier(.2,1.25,.3,1) both; }
    :host(.em-intro) .em-e { animation: emDraw .52s cubic-bezier(.65,0,.35,1) .2s both; }
    :host(.em-intro) .em-r1 { animation: emDraw .42s cubic-bezier(.2,.8,.2,1) .64s both, emOp1 .42s .64s both; }
    :host(.em-intro) .em-r2 { animation: emDraw .42s cubic-bezier(.2,.8,.2,1) .78s both, emOp2 .42s .78s both; }
    :host(.em-intro) .em-g1 { animation: emRip .9s cubic-bezier(.2,.8,.2,1) .9s both; }

    :host(.em-loader) .em-r1 { animation: emPulse1 1.6s cubic-bezier(.4,0,.2,1) infinite; }
    :host(.em-loader) .em-r2 { animation: emPulse2 1.6s cubic-bezier(.4,0,.2,1) .16s infinite; }
    :host(.em-loader) .em-g2 { animation: emRip 1.6s cubic-bezier(.2,.8,.2,1) .32s infinite; }

    :host(.em-inline) .em-r1 { animation: emBlink1 1s steps(1) infinite; }
    :host(.em-inline) .em-r2 { animation: emBlink2 1s steps(1) infinite; }

    :host(.em-live) .em-g1, :host(.em-live) .em-g2 { animation: emRip 1.2s cubic-bezier(.2,.8,.2,1) infinite; }
    :host(.em-live) .em-g1 { animation-delay: .6s; }

    @keyframes emTile { from { transform: scale(.72); opacity: 0 } to { transform: none; opacity: 1 } }
    @keyframes emDraw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
    @keyframes emOp1 { from { opacity: 0 } to { opacity: .62 } }
    @keyframes emOp2 { from { opacity: 0 } to { opacity: .32 } }
    @keyframes emRip { 0% { opacity: 0; transform: scale(.92) } 25% { opacity: .5 } 100% { opacity: 0; transform: scale(1.18) } }
    @keyframes emPulse1 { 0%, 100% { opacity: .22 } 40% { opacity: .95 } }
    @keyframes emPulse2 { 0%, 100% { opacity: .12 } 45% { opacity: .7 } }
    @keyframes emBlink1 { 0% { opacity: .25 } 25% { opacity: 1 } 75% { opacity: .25 } }
    @keyframes emBlink2 { 0% { opacity: .15 } 50% { opacity: 1 } 100% { opacity: .15 } }
    @media (prefers-reduced-motion: reduce) { .em-tile, .em-s, .em-g { animation: none !important; } .em-s { stroke-dashoffset: 0; } }
  `],
})
export class EchoMarkComponent {
  @Input() size = 40;
  @Input() mode: 'still' | 'intro' | 'loader' | 'inline' | 'live' = 'still';
  /** false draws the mark in the accent colour with no tile, for small inline use. */
  @Input() tile = true;
}

/** A page or panel waiting on data: the mark breathing, and what is loading. Shows after 400 ms so quick loads stay blank. */
@Component({
  selector: 'app-echo-loader',
  standalone: true,
  imports: [EchoMarkComponent],
  template: `<div class="el" role="status"><app-echo-mark mode="loader" [size]="size"></app-echo-mark><span>{{ label }}</span></div>`,
  styles: [`
    .el { display: grid; justify-items: center; gap: 10px; padding: 28px 12px; color: var(--ds-text-muted, #6b6b6b); font-size: 13px; animation: elIn .2s ease .4s both; }
    @keyframes elIn { from { opacity: 0 } to { opacity: 1 } }
    @media (prefers-reduced-motion: reduce) { .el { animation: none; } }
  `],
})
export class EchoLoaderComponent {
  @Input() label = 'Loading';
  @Input() size = 44;
}
