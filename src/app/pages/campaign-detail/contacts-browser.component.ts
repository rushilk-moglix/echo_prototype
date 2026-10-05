import { Component, Input, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { outcomeView, dialSentence, telephonyLine, statusHover } from '../../utils/status';
import { fmtSecs } from '../../utils/format';
import { IconComponent } from '../../components/icon/icon.component';
import { HintComponent } from '../../components/hint/hint.component';

/**
 * The campaign's calls as one full width table. A click opens the call page
 * (outcome, dials, rows and answers, recording, transcript, analysis), so there
 * is no side panel to squeeze the transcript into. Transcript and audio can be
 * downloaded straight from the row.
 */
@Component({
  selector: 'app-contacts-browser',
  standalone: true,
  imports: [IconComponent, HintComponent],
  template: `
    @if (!rows.length) {
      <div class="empty">
        <div class="empty-icon"><app-icon name="file" [size]="18" [strokeWidth]="1.8"></app-icon></div>
        <div class="empty-title">{{ filtered ? 'No calls match' : 'No list uploaded' }}</div>
        <div class="empty-sub">{{ filtered ? 'Clear the filters to see every call.' : 'Download the template, fill it in, then use Upload data.' }}</div>
      </div>
    } @else {
      <div class="scroll-x">
        <table class="table ct">
          <thead>
            <tr>
              <th>Contact</th>
              @if (grouped) { <th>Rows</th> }
              <th>Call status</th><th class="num">Dials</th><th class="num">Talk</th><th>Last dial</th>
              <th class="ct-act-h"><span class="sr-only">Downloads</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows; track r.primary_id) {
              <tr class="ct-row" tabindex="0" (click)="open(r)" (keydown.enter)="open(r)" [title]="'Open the call page for ' + (r.name || r.phone)">
                <td>
                  <div class="ct-name">{{ r.name || '—' }}</div>
                  <div class="row-sub mono">{{ r.phone }}@if (r.parts > 1) { · call {{ r.part }} of {{ r.parts }} }</div>
                </td>
                @if (grouped) { <td class="mono">{{ r.rows_count }}</td> }
                <td class="nowrap">
                  <span [class]="'tag ct-status ' + ov(r).cls">{{ ov(r).label }}</span>
                  <span (click)="$event.stopPropagation()"><app-hint [text]="why(r)"></app-hint></span>
                </td>
                <td class="num mono">{{ r.attempts || 0 }}</td>
                <td class="num mono">{{ r.talk_seconds ? fmtSecs(r.talk_seconds) : '—' }}</td>
                <td class="mono row-sub">{{ r.last_attempt_at ? clock(r.last_attempt_at) : '—' }}</td>
                <td class="ct-act" (click)="$event.stopPropagation()">
                  @if (r.call_id) {
                    <a class="icon-btn" [href]="api.callTranscriptUrl(r.call_id)" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
                    <a class="icon-btn" [href]="api.recordingUrls(r.call_id).download" download title="Download audio" aria-label="Download audio"><app-icon name="headphones" [size]="15"></app-icon></a>
                  } @else {
                    <span class="icon-btn off" title="No call was answered, so there is no transcript or audio"><app-icon name="transcript" [size]="15"></app-icon></span>
                    <span class="icon-btn off" title="No call was answered, so there is no transcript or audio"><app-icon name="headphones" [size]="15"></app-icon></span>
                  }
                  <app-icon name="chevronRight" [size]="14" class="ct-go"></app-icon>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .ct td { vertical-align: middle; }
    .ct th { text-align: left; white-space: nowrap; }
    .ct th, .ct td { padding: 10px 12px; }
    .ct td.num, .ct th.num { text-align: right; }
    .ct-row { cursor: pointer; }
    .ct-row:hover td, .ct-row:focus-visible td { background: var(--raised); }
    .ct-row:focus-visible { outline: 2px solid var(--red); outline-offset: -2px; }
    .ct-name { font-weight: 500; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
    .num { text-align: right; }
    .ct-status { font-size: 13px; font-weight: 600; }
    .ct-act-h { width: 96px; }
    .ct-act { white-space: nowrap; text-align: right; }
    .ct-go { color: var(--faint); margin-left: 4px; vertical-align: middle; }
  `],
})
export class ContactsBrowserComponent {
  @Input() rows: any[] = [];
  @Input() campaignId = '';
  @Input() grouped = false;
  @Input() filtered = false;

  api = inject(ApiService);
  private router = inject(Router);
  fmtSecs = fmtSecs;
  telephonyLine = telephonyLine;

  ov(r: any) { return outcomeView(r.outcome); }
  hover = statusHover;
  detail(r: any): string {
    if (r.outcome === 'will_retry' && r.next_attempt_at) return `next try ${this.clock(r.next_attempt_at)}`;
    if (r.outcome === 'bad_data') return r.validation_error || '';
    // Talk time has its own column, so reached calls just say what happened.
    if (this.ov(r).group === 'reached') return r.attempts > 1 ? this.ov(r).help + ' · after ' + r.attempts + ' dials' : this.ov(r).help;
    const s = dialSentence({ outcome: r.outcome, ring_seconds: r.ring_seconds, talk_seconds: r.talk_seconds, facts: { ended_by: /user/i.test(r.hangup_by || '') ? 'caller' : /agent/i.test(r.hangup_by || '') ? 'agent' : '' } });
    return r.attempts > 1 && s ? `${s} · after ${r.attempts} dials` : s;
  }
  /** Everything behind the status, in one info icon: what happened, what the telephony service sent, and the rule. */
  why(r: any): string {
    const parts = [this.detail(r), telephonyLine(r.last_provider), `How: ${this.ov(r).ozonetel}`].filter((x) => x && x !== 'How: ');
    return parts.join('\n');
  }
  open(r: any): void { this.router.navigate(['/campaigns', this.campaignId, 'contacts', r.primary_id]); }
  clock(ts: string): string {
    return ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  }
}
