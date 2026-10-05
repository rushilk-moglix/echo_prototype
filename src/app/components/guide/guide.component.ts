import { Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';

/**
 * Smart info: a small icon that opens a looping animation and two plain lines
 * explaining one option. Used wherever a setting is hard to picture in words
 * (how a file becomes calls, retries, presets, outcomes).
 *
 * Every animation is inline SVG with CSS keyframes, so it costs no requests and
 * loops quietly. Users who prefer reduced motion see the final frame.
 */
interface Guide { title: string; lines: string[] }

const GUIDES: Record<string, Guide> = {
  one_row: { title: 'One row, one call', lines: ['Every row of your file becomes its own call.', 'Use it when each row is a different contact.'] },
  group_rows: { title: 'Several rows, one call', lines: ['Rows that belong to the same contact are covered on one call.', 'For example several open items for one customer.'] },
  group_by: { title: 'Which rows go together', lines: ['Rows with the same value in this column share one call.', 'Usually the phone number, or any id column.'] },
  once_each: { title: 'Said once, or row by row', lines: ['"Once per call" is said at the start, like the contact name.', '"Each row" is gone through one by one.'] },
  order: { title: 'Order of rows', lines: ['The agent goes through the rows of a call in this order.', 'For example the earliest date first.'] },
  max_split: { title: 'Too many rows? Another call', lines: ['A call covers at most this many rows.', 'The rest go on the next call to the same contact.'] },
  max_cap: { title: 'Too many rows? Cover the first', lines: ['Only the first rows are covered on the call.', 'The rest are marked Not covered in your results.'] },
  row_answers: { title: 'An answer for every row', lines: ['The agent records answers for each row it covers.', 'Your results file shows them next to the right row.'] },
  check_file: { title: 'Try it before you run', lines: ['Choose a sample file to see how many calls it becomes.', 'Nothing is dialled.'] },
  retry: { title: 'Trying again', lines: ['When a call ends in a status you ticked, Echo waits and dials again.', 'It stops when tries run out or the status is not ticked.'] },
  retry_answer: { title: 'Try again on an answer', lines: ['Dial again when the agent records a certain answer.', 'For example when the contact asks to be called later.'] },
  call_status: { title: 'How a call status is set', lines: ['Each dial gets a result from the telephony service.', 'Echo adds what the agent heard and picks one call status.'] },
  line: { title: 'Calling flow', lines: ['Your telephony account can hold hundreds of flows.', 'Turn on the few agents may use in Settings, Telephony. Each agent calls through one.'] },
  reference: { title: 'Reference files', lines: ['Big files the agent can search during a call.', 'Only the few lines it needs are used.'] },
  lookup: { title: 'Lookups', lines: ['The agent asks another system for live facts.', 'Before the call for each contact, or when the caller asks.'] },
  destination: { title: 'Send results to', lines: ['After each call, every row is sent with its call status and answers.', 'Pick any connected tool or a web address.'] },
  preset_natural: { title: 'One voice model', lines: ['One model hears and speaks directly.', 'Quickest replies and the most natural feel.'] },
  preset_pipeline: { title: 'Listen, think, speak', lines: ['Separate models turn speech to text, think, then speak.', 'More control over each step and each voice.'] },
  outcomes: { title: 'What the colours mean', lines: ['Green reached, red not reached, amber failed (safe to retry).', 'Blue is still in progress, grey was never dialled.'] },
};

let guideUid = 0;

@Component({
  selector: 'app-guide',
  standalone: true,
  template: `
    <!-- Animated info icon: the info glyph with a small play mark, so it reads as "shows a short animation". -->
    <button type="button" class="g-btn" [attr.aria-label]="'How this works: ' + g().title" [attr.aria-expanded]="open()" [attr.aria-describedby]="open() ? id : null"
      (pointerenter)="enter($event)" (pointerleave)="leaveSoon()" (focus)="show($event)" (blur)="hide()" (click)="tap($event)">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r="0.6" class="g-dot" /><path class="g-spark" d="M18 1.8v5.4l4.4-2.7z" /></svg>
    </button>
    @if (open()) {
      <div class="g-pop" role="tooltip" [id]="id" [class.above]="pos().above" [style.top.px]="pos().top" [style.left.px]="pos().left"
        (pointerenter)="stay()" (pointerleave)="leaveSoon()" (click)="$event.stopPropagation()">
        <div class="g-stage">
          @switch (topic) {
            @case ('one_row') {
              <svg viewBox="0 0 240 110">
                <rect x="14" y="16" width="86" height="78" rx="8" class="sheet" />
                @for (i of [0,1,2]; track i) {
                  <rect [attr.x]="22" [attr.y]="26 + i * 22" width="70" height="14" rx="3" class="row r1" [style.animation-delay.s]="i * 0.9" />
                  <circle cx="200" [attr.cy]="33 + i * 22" r="9" class="phone" [style.animation-delay.s]="i * 0.9 + 0.6" />
                  <path [attr.d]="'M196 ' + (33 + i * 22) + 'h8'" class="phone-mark" />
                  <circle cx="100" [attr.cy]="33 + i * 22" r="3.5" class="packet" [style.animation-delay.s]="i * 0.9" />
                }
              </svg>
            }
            @case ('group_rows') {
              <svg viewBox="0 0 240 110">
                <rect x="10" y="8" width="84" height="94" rx="8" class="sheet" />
                @for (r of groupRows; track $index) {
                  <rect x="18" [attr.y]="16 + $index * 16" width="68" height="11" rx="3" [class]="'row tag-' + r.g + ' fly fly-' + r.g + '-' + r.k" />
                }
                <rect x="140" y="12" width="88" height="40" rx="9" class="card ca" />
                <rect x="140" y="60" width="88" height="44" rx="9" class="card cb" />
                <text x="150" y="25" class="lbl">Call 1 · A</text>
                <text x="150" y="73" class="lbl">Call 2 · B</text>
              </svg>
            }
            @case ('group_by') {
              <svg viewBox="0 0 240 110">
                <rect x="10" y="10" width="220" height="90" rx="8" class="sheet" />
                @for (c of [0,1,2,3]; track c) { <rect [attr.x]="18 + c * 52" y="18" width="46" height="12" rx="3" [class]="c === 1 ? 'head pick' : 'head'" /> }
                @for (r of [0,1,2,3]; track r) {
                  @for (c of [0,1,2,3]; track c) {
                    <rect [attr.x]="18 + c * 52" [attr.y]="38 + r * 15" width="46" height="10" rx="2" [class]="c === 1 ? 'cell key k' + (r < 2 ? 'a' : 'b') : 'cell'" />
                  }
                }
                <text x="47" y="27" class="lbl light">column</text>
              </svg>
            }
            @case ('once_each') {
              <svg viewBox="0 0 240 110">
                <rect x="40" y="8" width="160" height="94" rx="10" class="card" />
                <rect x="50" y="18" width="140" height="18" rx="5" class="once" />
                <text x="58" y="31" class="lbl light">Once: contact name</text>
                @for (i of [0,1,2]; track i) {
                  <rect x="50" [attr.y]="44 + i * 18" width="140" height="13" rx="4" class="each" [style.animation-delay.s]="0.6 + i * 0.8" />
                  <text x="58" [attr.y]="54 + i * 18" class="lbl" [style.animation-delay.s]="0.6 + i * 0.8">Row {{ i + 1 }}: item details</text>
                }
                <circle cx="206" cy="27" r="6" class="talk" />
              </svg>
            }
            @case ('order') {
              <svg viewBox="0 0 240 110">
                <rect x="40" y="10" width="160" height="90" rx="8" class="sheet" />
                <g class="ord o1"><rect x="50" y="20" width="140" height="18" rx="4" class="row" /><text x="60" y="33" class="lbl">05 Oct</text></g>
                <g class="ord o2"><rect x="50" y="46" width="140" height="18" rx="4" class="row" /><text x="60" y="59" class="lbl">01 Oct</text></g>
                <g class="ord o3"><rect x="50" y="72" width="140" height="18" rx="4" class="row" /><text x="60" y="85" class="lbl">03 Oct</text></g>
              </svg>
            }
            @case ('max_split') {
              <svg viewBox="0 0 240 110">
                @for (i of ten; track i) { <rect x="14" [attr.y]="8 + i * 9.4" width="60" height="7" rx="2" [class]="'row sp sp' + (i < 8 ? 'a' : 'b')" [style.animation-delay.s]="i * 0.12" /> }
                <rect x="120" y="8" width="104" height="58" rx="9" class="card" /><text x="130" y="21" class="lbl">Call 1 · 8 rows</text>
                <rect x="120" y="74" width="104" height="30" rx="9" class="card cb2" /><text x="130" y="87" class="lbl">Call 2 · 2 rows</text>
              </svg>
            }
            @case ('max_cap') {
              <svg viewBox="0 0 240 110">
                @for (i of ten; track i) { <rect x="14" [attr.y]="8 + i * 9.4" width="60" height="7" rx="2" [class]="'row cp cp' + (i < 8 ? 'a' : 'b')" [style.animation-delay.s]="i * 0.12" /> }
                <rect x="120" y="8" width="104" height="58" rx="9" class="card" /><text x="130" y="21" class="lbl">Call · 8 rows</text>
                <text x="120" y="96" class="lbl muted nc">2 rows: not covered</text>
              </svg>
            }
            @case ('row_answers') {
              <svg viewBox="0 0 240 110">
                <rect x="20" y="10" width="200" height="90" rx="8" class="sheet" />
                @for (i of [0,1,2,3]; track i) {
                  <rect x="30" [attr.y]="20 + i * 20" width="110" height="13" rx="3" class="row" />
                  <rect x="150" [attr.y]="20 + i * 20" width="60" height="13" rx="6" [class]="i === 3 ? 'ans no' : 'ans'" [style.animation-delay.s]="i * 0.7" />
                }
              </svg>
            }
            @case ('check_file') {
              <svg viewBox="0 0 240 110">
                <rect x="20" y="16" width="70" height="80" rx="8" class="sheet" />
                @for (i of [0,1,2,3,4]; track i) { <rect x="28" [attr.y]="26 + i * 13" width="54" height="8" rx="2" class="row" /> }
                <path d="M100 56h40" class="arrow" /><path d="M134 50l6 6-6 6" class="arrow" />
                <text x="152" y="52" class="big count">5 rows</text>
                <text x="152" y="72" class="big count2">2 calls</text>
              </svg>
            }
            @case ('retry') {
              <svg viewBox="0 0 240 110">
                <g class="rt-phone"><circle cx="60" cy="55" r="22" class="phone big" /><path d="M52 55h16" class="phone-mark" /></g>
                <path d="M100 42l12 12M112 42l-12 12" class="miss" />
                <circle cx="150" cy="50" r="16" class="clock" /><path d="M150 50v-9" class="hand" />
                <circle cx="200" cy="55" r="15" class="ok" /><path d="M193 55l5 5 9-10" class="okmark" />
              </svg>
            }
            @case ('retry_answer') {
              <svg viewBox="0 0 240 110">
                <rect x="16" y="30" width="96" height="26" rx="13" class="ans-chip" /><text x="28" y="47" class="lbl">"Call me later"</text>
                <path d="M118 43h26" class="arrow" /><path d="M138 37l6 6-6 6" class="arrow" />
                <circle cx="168" cy="43" r="15" class="clock" style="opacity: 1" /><path d="M168 43v-8" class="hand" style="opacity: 1" />
                <g class="redial"><circle cx="212" cy="43" r="14" class="phone big" /><path d="M206 43h12" class="phone-mark" /></g>
                <text x="150" y="84" class="lbl muted">dials again after the wait</text>
              </svg>
            }
            @case ('call_status') {
              <svg viewBox="0 0 240 110">
                <circle cx="30" cy="55" r="16" class="phone big" /><path d="M24 55h12" class="phone-mark" />
                <rect x="62" y="22" width="80" height="22" rx="5" class="sheet tl1" /><text x="68" y="37" class="lbl">telephony status</text>
                <rect x="62" y="66" width="80" height="22" rx="5" class="sheet tl2" /><text x="68" y="81" class="lbl">what agent heard</text>
                <path d="M146 33l22 18M146 77l22-18" class="arrow" />
                <rect x="172" y="44" width="58" height="22" rx="11" class="st-out" /><text x="180" y="59" class="lbl light">Call status</text>
              </svg>
            }
            @case ('line') {
              <svg viewBox="0 0 240 110">
                <rect x="10" y="6" width="96" height="98" rx="6" class="sheet" /><text x="18" y="20" class="lbl">Provider flows</text>
                @for (i of [0,1,2,3,4,5]; track i) {
                  <rect x="18" [attr.y]="28 + i * 12" width="58" height="6" rx="2" [class]="i === 1 || i === 4 ? 'row hit' : 'row'" />
                  <rect x="82" [attr.y]="27 + i * 12" width="16" height="8" rx="4" [class]="i === 1 || i === 4 ? 'tog on' : 'tog'" />
                }
                <path d="M100 43 C130 43 128 55 150 55 M100 79 C130 79 128 55 150 55" class="wire" style="stroke: var(--ink-3)" />
                <circle cx="166" cy="55" r="16" class="agent" /><text x="155" y="59" class="lbl light">Agent</text>
                <path d="M183 55h20" class="wire" style="stroke: var(--ink-3)" />
                <circle cx="218" cy="55" r="12" class="phone big pulse" /><path d="M213 55h10" class="phone-mark" />
              </svg>
            }
            @case ('reference') {
              <svg viewBox="0 0 240 110">
                <rect x="16" y="8" width="70" height="94" rx="6" class="sheet" />
                @for (i of [0,1,2,3,4,5,6]; track i) { <rect x="24" [attr.y]="18 + i * 11" width="54" height="5" rx="2" [class]="i === 4 ? 'row hit' : 'row'" /> }
                <g class="lens"><circle cx="50" cy="30" r="12" class="glass" /><path d="M58 39l9 9" class="glass" /></g>
                <rect x="104" y="58" width="44" height="10" rx="3" class="snip" />
                <circle cx="200" cy="55" r="22" class="agent" /><text x="188" y="59" class="lbl light">Agent</text>
              </svg>
            }
            @case ('lookup') {
              <svg viewBox="0 0 240 110">
                <circle cx="50" cy="55" r="24" class="agent" /><text x="37" y="59" class="lbl light">Agent</text>
                <rect x="160" y="28" width="64" height="54" rx="8" class="sys" /><text x="166" y="59" class="lbl">Your system</text>
                <circle cx="80" cy="46" r="4" class="pk out" /><circle cx="156" cy="64" r="4" class="pk back" />
                <path d="M80 46H156M156 64H80" class="wire" />
              </svg>
            }
            @case ('destination') {
              <svg viewBox="0 0 240 110">
                <rect x="16" y="16" width="80" height="78" rx="8" class="sheet" />
                @for (i of [0,1,2,3]; track i) { <rect x="24" [attr.y]="26 + i * 16" width="64" height="10" rx="3" class="row dst" [style.animation-delay.s]="i * 0.6" /> }
                <rect x="160" y="30" width="64" height="50" rx="10" class="sys" /><text x="168" y="59" class="lbl">Your tool</text>
              </svg>
            }
            @case ('preset_natural') {
              <svg viewBox="0 0 240 110">
                <circle cx="40" cy="55" r="18" class="person" /><text x="28" y="88" class="lbl muted">Caller</text>
                <circle cx="150" cy="55" r="26" class="model" /><text x="133" y="59" class="lbl light">One model</text>
                @for (i of [0,1,2]; track i) { <path [attr.d]="'M' + (66 + i * 12) + ' 55q4 -8 8 0t8 0'" class="wave" [style.animation-delay.s]="i * 0.2" /> }
              </svg>
            }
            @case ('preset_pipeline') {
              <svg viewBox="0 0 240 110">
                <rect x="14" y="36" width="56" height="38" rx="9" class="stage s1" /><text x="24" y="59" class="lbl">Listen</text>
                <rect x="92" y="36" width="56" height="38" rx="9" class="stage s2" /><text x="104" y="59" class="lbl">Think</text>
                <rect x="170" y="36" width="56" height="38" rx="9" class="stage s3" /><text x="181" y="59" class="lbl">Speak</text>
                <path d="M72 55h18M150 55h18" class="arrow" />
              </svg>
            }
            @case ('outcomes') {
              <svg viewBox="0 0 240 110">
                <rect x="14" y="30" width="212" height="16" rx="8" class="track" />
                <rect x="14" y="30" width="90" height="16" rx="8" class="seg g1" />
                <rect x="104" y="30" width="50" height="16" class="seg g2" />
                <rect x="154" y="30" width="20" height="16" class="seg g3" />
                <rect x="174" y="30" width="36" height="16" class="seg g4" />
                <rect x="210" y="30" width="16" height="16" rx="0" class="seg g5" />
                <text x="14" y="66" class="lbl">Reached</text><text x="104" y="66" class="lbl">Not reached</text><text x="14" y="86" class="lbl muted">Failed · In progress · Not dialled</text>
              </svg>
            }
          }
        </div>
        <div class="g-text">
          <div class="g-title">{{ g().title }}</div>
          @for (l of g().lines; track l) { <div class="g-line">{{ l }}</div> }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .g-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin: -2px -2px -2px 0; border: 0; border-radius: 50%; background: transparent; color: var(--ds-accent-fg); cursor: help; padding: 0; }
    .g-btn:hover, .g-btn[aria-expanded="true"] { background: var(--ds-accent-soft); }
    .g-btn:focus-visible { outline: 2px solid var(--ds-focus, currentColor); outline-offset: 1px; }
    .g-btn svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
    .g-btn .g-dot { fill: currentColor; }
    /* The small play mark says: this one shows a short animation. Accent colour keeps it distinct from the plain grey "i". */
    .g-btn .g-spark { fill: currentColor; stroke: none; }
    .tog { fill: var(--line-strong); } .tog.on { fill: var(--ds-success-fg); }
    .g-pop { position: fixed; z-index: 1100; width: min(300px, calc(100vw - 16px)); background: var(--ds-surface-raised); border: 1px solid var(--ds-border); border-radius: var(--ds-r-lg); box-shadow: var(--ds-shadow-lg); padding: 10px; animation: g-in .16s var(--ds-ease) both; }
    .g-pop.above { translate: 0 -100%; animation-name: g-in-up; }
    @keyframes g-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes g-in-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .g-stage { background: var(--raised); border-radius: 8px; padding: 4px; }
    .g-stage svg { width: 100%; height: auto; display: block; }
    .g-text { padding: 10px 6px 4px; }
    .g-title { font-weight: 600; color: var(--ink); font-size: 14px; margin-bottom: 3px; }
    .g-line { font-size: 13px; color: var(--ink-3); line-height: 1.45; }

    /* shared shapes */
    .sheet { fill: var(--card); stroke: var(--line); }
    .row { fill: var(--line); }
    .card { fill: var(--card); stroke: var(--line); }
    .lbl { font: 600 9px var(--sans, system-ui); fill: var(--ink-3); }
    .lbl.light { fill: var(--ds-on-accent); }
    .lbl.muted { fill: var(--faint); }
    .phone { fill: var(--line); }
    .phone-mark, .arrow, .wire { stroke: var(--ink-3); stroke-width: 2; fill: none; stroke-linecap: round; }
    .packet { fill: var(--red); opacity: 0; }

    /* one row */
    .r1 { animation: rowlit 2.7s infinite; }
    @keyframes rowlit { 0%, 30% { fill: var(--red); } 40%, 100% { fill: var(--line); } }
    .packet { animation: travel 2.7s infinite; }
    @keyframes travel { 0% { opacity: 1; transform: translateX(0); } 22% { opacity: 1; transform: translateX(90px); } 23%, 100% { opacity: 0; transform: translateX(90px); } }
    .phone { animation: ring 2.7s infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes ring { 0%, 10% { fill: var(--ds-success); transform: scale(1.15); } 25%, 100% { fill: var(--line); transform: scale(1); } }

    /* group rows */
    .tag-a { fill: var(--ds-danger); } .tag-b { fill: var(--ds-info); }
    .fly { animation-duration: 3.6s; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }
    .fly-a-0 { animation-name: fa0; } .fly-a-1 { animation-name: fa1; } .fly-b-0 { animation-name: fb0; } .fly-b-1 { animation-name: fb1; } .fly-b-2 { animation-name: fb2; }
    @keyframes fa0 { 0%, 20% { transform: none; } 50%, 85% { transform: translate(132px, 14px); } 100% { transform: none; } }
    @keyframes fa1 { 0%, 20% { transform: none; } 50%, 85% { transform: translate(132px, -6px); } 100% { transform: none; } }
    @keyframes fb0 { 0%, 25% { transform: none; } 55%, 85% { transform: translate(132px, 44px); } 100% { transform: none; } }
    @keyframes fb1 { 0%, 25% { transform: none; } 55%, 85% { transform: translate(132px, 24px); } 100% { transform: none; } }
    @keyframes fb2 { 0%, 25% { transform: none; } 55%, 85% { transform: translate(132px, 20px); } 100% { transform: none; } }

    /* group by */
    .head { fill: var(--line); } .cell { fill: var(--line-soft, #eee); }
    .head.pick { animation: pick 3s infinite; }
    @keyframes pick { 0%, 15% { fill: var(--line); } 30%, 100% { fill: var(--ink-3); } }
    .key { animation: keyc 3s infinite; }
    .ka { --c: var(--ds-danger); } .kb { --c: var(--ds-info); }
    @keyframes keyc { 0%, 35% { fill: var(--line-soft, #eee); } 50%, 100% { fill: var(--c); } }

    /* once / each */
    .once { fill: var(--ink-3); }
    .each { fill: var(--line); animation: lit 2.4s infinite; }
    @keyframes lit { 0% { fill: var(--line); } 15%, 30% { fill: var(--ds-warning-border); } 45%, 100% { fill: var(--line); } }
    .talk { fill: var(--ds-success); animation: talk 0.8s infinite alternate; transform-box: fill-box; transform-origin: center; }
    @keyframes talk { to { transform: scale(1.35); opacity: .6; } }

    /* order */
    .ord { animation-duration: 3.4s; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }
    .o1 { animation-name: o1; } .o2 { animation-name: o2; } .o3 { animation-name: o3; }
    @keyframes o1 { 0%, 25% { transform: none; } 50%, 85% { transform: translateY(52px); } 100% { transform: none; } }
    @keyframes o2 { 0%, 25% { transform: none; } 50%, 85% { transform: translateY(-26px); } 100% { transform: none; } }
    @keyframes o3 { 0%, 25% { transform: none; } 50%, 85% { transform: translateY(-26px); } 100% { transform: none; } }

    /* split / cap */
    .sp, .cp { animation-duration: 3.6s; animation-iteration-count: infinite; animation-timing-function: ease-in-out; }
    .spa, .cpa { animation-name: toCard; } .spb { animation-name: toCard2; } .cpb { animation-name: fadeOut; }
    @keyframes toCard { 0%, 15% { fill: var(--line); } 30%, 88% { fill: var(--ds-success); } 100% { fill: var(--line); } }
    @keyframes toCard2 { 0%, 45% { fill: var(--line); } 60%, 88% { fill: var(--ds-info); } 100% { fill: var(--line); } }
    @keyframes fadeOut { 0%, 40% { opacity: 1; } 60%, 90% { opacity: .2; } 100% { opacity: 1; } }
    .cb2 { stroke: var(--ds-info); }
    .nc { animation: fadeIn 3.6s infinite; }
    @keyframes fadeIn { 0%, 50% { opacity: 0; } 65%, 90% { opacity: 1; } 100% { opacity: 0; } }

    /* answers */
    .ans { fill: var(--ds-success-border); opacity: 0; animation: ansIn 3s infinite; }
    .ans.no { fill: var(--ds-danger-border); }
    @keyframes ansIn { 0% { opacity: 0; transform: translateX(-8px); } 15%, 85% { opacity: 1; transform: none; } 100% { opacity: 0; } }

    /* check file */
    .count, .count2 { font: 700 14px var(--sans, system-ui); fill: var(--ink); opacity: 0; animation: fadeIn 3s infinite; }
    .count2 { fill: var(--ds-success); animation-delay: .5s; }

    /* retry */
    .rt-phone { animation: shake 3.2s infinite; transform-origin: 60px 55px; }
    @keyframes shake { 0%, 20% { transform: rotate(0); } 4%, 12% { transform: rotate(-12deg); } 8%, 16% { transform: rotate(12deg); } 21%, 100% { transform: rotate(0); } }
    .phone.big { fill: var(--ds-border-strong); }
    .miss { stroke: var(--red); stroke-width: 3; stroke-linecap: round; opacity: 0; animation: step1 3.2s infinite; }
    .clock { fill: none; stroke: var(--ink-3); stroke-width: 2; opacity: 0; animation: step2 3.2s infinite; }
    .hand { stroke: var(--ink-3); stroke-width: 2; stroke-linecap: round; transform-origin: 150px 50px; opacity: 0; animation: step2 3.2s infinite, spin 3.2s infinite linear; }
    .ok { fill: var(--ds-success); opacity: 0; animation: step3 3.2s infinite; } .okmark { stroke: var(--ds-surface); stroke-width: 2.5; fill: none; stroke-linecap: round; opacity: 0; animation: step3 3.2s infinite; }
    @keyframes step1 { 0%, 22% { opacity: 0; } 28%, 95% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes step2 { 0%, 38% { opacity: 0; } 45%, 95% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes step3 { 0%, 65% { opacity: 0; } 72%, 95% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* retry on answer, call status, line */
    .ans-chip { fill: var(--ds-warning-border); }
    .redial { animation: shake 2.6s infinite; transform-origin: 212px 43px; }
    .tl1 { animation: lit 2.6s infinite; } .tl2 { animation: lit 2.6s infinite .5s; }
    .st-out { fill: var(--red); animation: step3 2.6s infinite; }
    .pulse { animation: ring 1.8s infinite; transform-box: fill-box; transform-origin: center; }

    /* reference */
    .hit { animation: hit 3s infinite; } @keyframes hit { 0%, 40% { fill: var(--line); } 50%, 100% { fill: var(--ds-warning-border); } }
    .lens { animation: scan 3s infinite ease-in-out; }
    @keyframes scan { 0% { transform: translateY(0); } 45%, 100% { transform: translateY(44px); } }
    .glass { fill: none; stroke: var(--ink-3); stroke-width: 2.5; stroke-linecap: round; }
    .snip { fill: var(--ds-warning-border); opacity: 0; animation: snip 3s infinite; }
    @keyframes snip { 0%, 50% { opacity: 0; transform: translateX(0); } 55% { opacity: 1; } 85% { opacity: 1; transform: translateX(60px); } 100% { opacity: 0; transform: translateX(60px); } }
    .agent { fill: var(--red); }

    /* lookup */
    .sys { fill: var(--card); stroke: var(--ink-3); stroke-width: 1.5; }
    .wire { stroke: var(--line); stroke-dasharray: 3 4; }
    .pk { fill: var(--red); }
    .pk.out { animation: out 2.4s infinite ease-in-out; } .pk.back { fill: var(--ds-success); animation: back 2.4s infinite ease-in-out; }
    @keyframes out { 0% { transform: none; opacity: 1; } 45% { transform: translateX(76px); opacity: 1; } 50%, 100% { opacity: 0; transform: translateX(76px); } }
    @keyframes back { 0%, 50% { transform: none; opacity: 0; } 55% { opacity: 1; } 95% { transform: translateX(-76px); opacity: 1; } 100% { opacity: 0; transform: translateX(-76px); } }

    /* destination */
    .dst { animation: dst 2.4s infinite ease-in; }
    @keyframes dst { 0%, 10% { transform: none; opacity: 1; } 60% { transform: translateX(110px) scale(.6); opacity: 0; } 100% { opacity: 0; transform: translateX(110px) scale(.6); } }

    /* presets */
    .person { fill: var(--line); } .model { fill: var(--red); }
    .wave { stroke: var(--ds-success); stroke-width: 2; fill: none; stroke-linecap: round; animation: wv 1.2s infinite; }
    @keyframes wv { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
    .stage { fill: var(--card); stroke: var(--line); stroke-width: 1.5; animation: stg 3s infinite; }
    .s2 { animation-delay: .6s; } .s3 { animation-delay: 1.2s; }
    @keyframes stg { 0%, 30% { stroke: var(--red); fill: var(--red-wash); } 40%, 100% { stroke: var(--line); fill: var(--card); } }

    /* outcomes */
    .track { fill: var(--line); }
    .seg { transform-box: fill-box; transform-origin: left; animation: grow 3s infinite ease-out; }
    .g1 { fill: var(--ds-success); } .g2 { fill: var(--ds-danger); animation-delay: .2s; } .g3 { fill: var(--ds-warning); animation-delay: .4s; } .g4 { fill: var(--ds-info); animation-delay: .6s; } .g5 { fill: var(--ds-text-placeholder); animation-delay: .8s; }
    @keyframes grow { 0% { transform: scaleX(0); } 40%, 100% { transform: scaleX(1); } }

    @media (prefers-reduced-motion: reduce) { .g-stage *, .g-btn * { animation: none !important; } }
  `],
})
export class GuideComponent {
  @Input() topic = '';
  private host = inject(ElementRef);
  open = signal(false);
  pos = signal({ top: 0, left: 0, above: false });
  readonly ten = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  readonly groupRows = [{ g: 'a', k: 0 }, { g: 'b', k: 0 }, { g: 'a', k: 1 }, { g: 'b', k: 1 }, { g: 'b', k: 2 }];
  g = () => GUIDES[this.topic] || { title: 'How this works', lines: [] };

  readonly id = `guide-${++guideUid}`;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pinned = false;
  /** Hover opens after a short pause; moving onto the popover keeps it open; leaving both closes it. */
  enter(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const el = e.currentTarget as HTMLElement;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.place(el), 160);
  }
  stay(): void { clearTimeout(this.timer); }
  leaveSoon(): void { clearTimeout(this.timer); if (!this.pinned) this.timer = setTimeout(() => this.open.set(false), 180); }
  show(e: Event): void { this.place(e.currentTarget as HTMLElement); }
  hide(): void { clearTimeout(this.timer); this.pinned = false; this.open.set(false); }
  /** Touch: a tap opens it and keeps it open until the next tap, a tap elsewhere or Escape. */
  tap(e: Event): void {
    e.stopPropagation();
    this.pinned = !this.open() || !this.pinned;
    if (this.pinned) this.place(e.currentTarget as HTMLElement); else this.open.set(false);
  }
  private place(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const W = Math.min(300, window.innerWidth - 16);
    const above = r.bottom + 300 > window.innerHeight && r.top > 300;
    this.pos.set({ above, top: above ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left - 20, window.innerWidth - W - 8)) });
    this.open.set(true);
  }
  @HostListener('document:click', ['$event']) outside(e: Event): void { if (this.open() && !this.host.nativeElement.contains(e.target)) this.hide(); }
  @HostListener('document:keydown.escape') esc(): void { this.hide(); }
  @HostListener('document:wheel') wheel(): void { if (!this.pinned) this.hide(); }
}
