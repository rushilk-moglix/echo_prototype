import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';

/**
 * Call recording player: one row with play, back and forward 10 s, a waveform
 * you can click or drag to jump, time, speed and download. Speaker turns tint
 * the waveform (agent and caller), so you can find who spoke when at a glance.
 * The transcript calls seek() to play from a line.
 */
@Component({
  selector: 'app-player',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (state() === 'waiting') {
      <div class="pl pl-empty"><app-icon name="loader" [size]="14"></app-icon> Saving the recording…</div>
    } @else if (state() === 'unavailable') {
      <div class="pl pl-empty"><app-icon name="volume" [size]="14"></app-icon> No recording was saved for this call.</div>
    } @else {
      <div class="pl" role="group" aria-label="Call recording">
        <audio #audio [src]="audioUrl" preload="metadata" (loadedmetadata)="onMeta()" (timeupdate)="t.set(a()?.currentTime || 0)" (play)="playing.set(true)" (pause)="playing.set(false)" (ended)="playing.set(false)"></audio>
        <button class="pl-play" (click)="toggle()" [attr.aria-label]="playing() ? 'Pause' : 'Play'" [title]="playing() ? 'Pause (space)' : 'Play (space)'">
          <app-icon [name]="playing() ? 'pause' : 'play'" [size]="16" [strokeWidth]="2"></app-icon>
        </button>
        <button class="pl-btn" (click)="skip(-10)" aria-label="Back 10 seconds" title="Back 10 s"><app-icon name="back10" [size]="15"></app-icon></button>
        <button class="pl-btn" (click)="skip(10)" aria-label="Forward 10 seconds" title="Forward 10 s"><app-icon name="fwd10" [size]="15"></app-icon></button>
        <div class="pl-wave" #wave role="slider" tabindex="0" aria-label="Position" [attr.aria-valuemax]="dur()" [attr.aria-valuenow]="t()"
          (pointerdown)="drag($event)" (keydown.arrowleft)="skip(-5)" (keydown.arrowright)="skip(5)">
          @for (b of bars(); track $index) {
            <i [style.height.%]="b.h" [class]="b.who + ($index / bars().length < pct() ? ' on' : '')"></i>
          }
        </div>
        <span class="pl-time mono">{{ clock(t()) }} / {{ clock(dur()) }}</span>
        <button class="pl-btn pl-speed mono" (click)="speed()" [title]="'Speed ' + rate() + '×'" aria-label="Playback speed">{{ rate() }}×</button>
        <a class="pl-btn" [href]="downloadUrl" download title="Download audio" aria-label="Download audio"><app-icon name="download" [size]="15"></app-icon></a>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pl { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); min-width: 0; }
    .pl-empty { color: var(--faint); font-size: 13px; gap: 8px; }
    .pl-play { width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; border: 0; background: var(--ds-text); color: var(--ds-text-inverse); display: grid; place-items: center; cursor: pointer; }
    .pl-play:hover { background: var(--ink-2); }
    .pl-btn { width: 30px; height: 30px; flex-shrink: 0; border-radius: 8px; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
    .pl-btn:hover { background: var(--bg); color: var(--ink); }
    .pl-speed { width: auto; padding: 0 6px; font-size: 12px; font-weight: 600; }
    .pl-wave { flex: 1; min-width: 80px; height: 30px; display: flex; align-items: center; gap: 2px; cursor: pointer; touch-action: none; border-radius: 6px; }
    .pl-wave:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
    .pl-wave i { flex: 1; min-width: 1px; border-radius: 2px; background: var(--line-strong); }
    .pl-wave i.agent { background: var(--ds-speaker-agent-soft); } .pl-wave i.caller { background: var(--ds-speaker-caller-soft); }
    .pl-wave i.on { background: var(--ink-3); } .pl-wave i.agent.on { background: var(--ds-speaker-agent); } .pl-wave i.caller.on { background: var(--ds-speaker-caller); }
    .pl-time { font-size: 12px; color: var(--muted); white-space: nowrap; }
    @media (max-width: 560px) { .pl { flex-wrap: wrap; } .pl-wave { order: 9; flex-basis: 100%; } }
  `],
  host: { '(document:keydown.space)': 'onSpace($event)' },
})
export class PlayerComponent implements OnInit, OnDestroy {
  /** Call id: the recording is fetched by it unless a direct link is known. */
  @Input() callId = '';
  @Input() recordingUrl = '';
  /** Who spoke when, in seconds from the start, to tint the waveform. */
  @Input() turns: { at: number; who: 'agent' | 'caller' }[] = [];
  @Input() seconds = 0;
  @ViewChild('audio') audioRef?: ElementRef<HTMLAudioElement>;
  @ViewChild('wave') waveRef?: ElementRef<HTMLElement>;
  private api = inject(ApiService);

  state = signal<'waiting' | 'ready' | 'unavailable'>('waiting');
  playing = signal(false);
  t = signal(0);
  dur = signal(0);
  rate = signal(1);
  audioUrl = '';
  downloadUrl = '';
  private alive = true;
  pct = computed(() => (this.dur() ? this.t() / this.dur() : 0));
  /** 90 bars; heights are a stable pattern from the call id, colour from the speaker at that moment. */
  bars = computed(() => {
    const n = 90, d = this.dur() || this.seconds || 1;
    let h = 0; for (const ch of this.callId || 'x') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const turns = [...this.turns].sort((a, b) => a.at - b.at);
    return Array.from({ length: n }, (_, i) => {
      h = (h * 1103515245 + 12345) >>> 0;
      const at = (i / n) * d;
      const who = turns.filter((x) => x.at <= at).slice(-1)[0]?.who || '';
      return { h: 22 + (h % 70), who };
    });
  });

  a(): HTMLAudioElement | undefined { return this.audioRef?.nativeElement; }
  ngOnInit(): void {
    if (this.seconds) this.dur.set(this.seconds);
    if (this.recordingUrl) { this.audioUrl = this.downloadUrl = this.recordingUrl; this.state.set('ready'); return; }
    const u = this.api.recordingUrls(this.callId);
    this.audioUrl = u.audio; this.downloadUrl = u.download;
    this.poll(u.status, 0);
  }
  ngOnDestroy(): void { this.alive = false; }
  private async poll(url: string, tries: number): Promise<void> {
    if (!this.alive) return;
    try { if ((await (await fetch(url)).json())?.ready) { this.state.set('ready'); return; } } catch { /* try again */ }
    if (tries < 30) setTimeout(() => this.poll(url, tries + 1), 600); else this.state.set('unavailable');
  }
  onMeta(): void { const d = this.a()?.duration; if (d && isFinite(d)) this.dur.set(d); }
  toggle(): void { const a = this.a(); if (!a) return; a.paused ? a.play() : a.pause(); }
  /** Play from a moment, used by the transcript. */
  seek(sec: number, play = true): void {
    const a = this.a(); if (!a) return;
    a.currentTime = Math.max(0, Math.min(sec, this.dur() || sec)); this.t.set(a.currentTime);
    if (play) a.play();
  }
  skip(d: number): void { const a = this.a(); if (a) this.seek(a.currentTime + d, !a.paused); }
  speed(): void {
    const order = [1, 1.25, 1.5, 2]; const next = order[(order.indexOf(this.rate()) + 1) % order.length];
    this.rate.set(next); const a = this.a(); if (a) a.playbackRate = next;
  }
  drag(e: PointerEvent): void {
    const el = this.waveRef?.nativeElement; if (!el) return;
    const at = (x: number) => { const r = el.getBoundingClientRect(); this.seek(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (this.dur() || 0), !this.a()?.paused); };
    at(e.clientX);
    const move = (m: PointerEvent) => at(m.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  onSpace(e: Event): void {
    if ((e.target as HTMLElement)?.closest('input, textarea, select, button, a, [contenteditable]')) return;
    e.preventDefault(); this.toggle();
  }
  clock(s: number): string { const n = Math.floor(s || 0); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
}
