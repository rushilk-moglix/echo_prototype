import { outcomeView } from '../../utils/status';
import { Component, Input, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { ApiService } from '../../services/api.service';
import { fmtTime } from '../../utils/format';


@Component({
  selector: 'app-responses-table',
  standalone: true,
  imports: [IconComponent, RouterLink],
  template: `
    @if (!rows.length) {
      <div class="empty">
        <div class="empty-icon"><app-icon name="table" [size]="18" [strokeWidth]="1.8"></app-icon></div>
        <div class="empty-title">Nothing captured yet</div>
        <div class="empty-sub">Rows appear here as each call finishes and the agent reports its outcome.</div>
      </div>
    } @else {
      @if (selected().size) {
        <div class="bulk-actions-toolbar" style="margin: 0 16px 10px">
          <div class="bulk-left">
            <span class="bulk-pill">{{ selected().size }} selected</span>
            @if (bulkStatus()) { <span class="bulk-sub">{{ bulkStatus() }}</span> }
          </div>
          <div class="bulk-btns">
            <button class="btn btn-sm" (click)="downloadSelectedCsv()">
              <app-icon name="download" [size]="12"></app-icon> Export CSV
            </button>
            <button class="btn btn-sm" (click)="downloadSelectedAudio()" [disabled]="!selectedWithCall().length">
              <app-icon name="volume" [size]="12"></app-icon> Download audio
            </button>
            <button class="btn btn-sm" (click)="clearSelection()">Clear</button>
          </div>
        </div>
      }
      <div class="scroll-x">
        <div [style.min-width.px]="660 + outVars.length * 180">
          <div class="grid-head" [style.grid-template-columns]="cols()">
            <span class="row-check"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()" aria-label="Select every row" /></span>
            <span>{{ idLabel }}</span><span>Name</span><span>Call status</span>
            @for (v of outVars; track v.key) { <span [title]="v.description">{{ v.label }}</span> }
            <span>Captured</span><span></span>
          </div>
          @for (r of rows; track r.primary_id + $index; let i = $index) {
            <div [class]="'grid-row grid-row-top' + (isSelected(r) ? ' selected-row' : '')" [style.grid-template-columns]="cols()" [style.animation-delay]="(i < 12 ? i * 20 : 240) + 'ms'">
              <span class="row-check"><input type="checkbox" [checked]="isSelected(r)" (change)="toggleOne(r)" [attr.aria-label]="'Select row for ' + (r.name || r.primary_id)" /></span>
              <!-- primary_id isn't always a phone number — an externally-submitted
                   (Clarix) row uses their own call_id as primary_id, on purpose, so
                   it can be echoed straight back to them in the webhook payload (see
                   webhook-payload.ts). This column is labelled per-agent (idLabel)
                   and almost always means "phone" to an operator, so show the real
                   phone here; the id is still one hover away, not lost. -->
              <span class="mono" style="font-size: 12px" [title]="'id: ' + r.primary_id">{{ r.phone || r.primary_id }}</span>
              <span style="min-width: 0">{{ r.name || r.phone || '—' }}</span>
              <span><span [class]="'tag ' + st(r).cls" [title]="st(r).help">{{ st(r).label }}</span></span>
              @for (v of outVars; track v.key) {
                @if (isBlank(r.outputs?.[v.key])) {
                  <span style="color: var(--ds-text-placeholder)">—</span>
                } @else {
                  <!-- Wraps instead of truncating, so a long answer is read by
                       growing the row rather than scrolling the table sideways.
                       Clamped to keep the list scannable; click opens the rest. -->
                  <span
                    [class]="'cell-wrap' + (isOpen(i, v.key) ? ' open' : '')"
                    (click)="toggleCell(i, v.key)"
                    [title]="isOpen(i, v.key) ? '' : 'Click to expand'"
                  >{{ textValue(r.outputs?.[v.key]) }}</span>
                }
              }
              <span style="color: var(--faint); font-size: 12px">{{ fmtTime(r.captured_at) }}</span>
              <span style="white-space: nowrap; text-align: right">
                @if (r.call_id) {
                  <a class="icon-btn" [href]="api.callTranscriptUrl(r.call_id)" download title="Download transcript" aria-label="Download transcript"><app-icon name="transcript" [size]="15"></app-icon></a>
                  <a class="icon-btn" [href]="api.recordingUrls(r.call_id).download" download title="Download audio" aria-label="Download audio"><app-icon name="headphones" [size]="15"></app-icon></a>
                }
                <a class="icon-btn" [routerLink]="['/campaigns', campaignId, 'contacts', r.primary_id]" title="Open the call page" aria-label="Open the call page"><app-icon name="chevronRight" [size]="14"></app-icon></a>
              </span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class ResponsesTableComponent {
  @Input() rows: any[] = [];
  @Input() outVars: any[] = [];
  @Input() idLabel = '';
  /** Threaded onto the Analysis link's queryParams, so "Back to calls" there
   * returns here instead of to Overview — see CallAnalysisComponent. */
  @Input() campaignId = '';

  api = inject(ApiService);

  st(r: any) { return outcomeView(r.outcome); }
  fmtTime = fmtTime;
  cols = computed(() => `28px 150px minmax(120px, 1fr) 104px ${this.outVars.map(() => 'minmax(170px, 1.4fr)').join(' ')} 120px 110px`);

  /** Which cells the operator has expanded, as "rowIndex:varKey". */
  private expanded = new Set<string>();

  isOpen(row: number, key: string): boolean {
    return this.expanded.has(`${row}:${key}`);
  }

  toggleCell(row: number, key: string): void {
    const id = `${row}:${key}`;
    if (!this.expanded.delete(id)) this.expanded.add(id);
  }

  isBlank(val: any): boolean {
    return val === undefined || val === null || val === '';
  }

  textValue(val: any): string {
    if (this.isBlank(val)) return '—';
    if (typeof val === 'boolean') return val ? 'yes' : 'no';
    // Answers for each row read as a count here; the call page and the results file show every row.
    if (Array.isArray(val)) return `${val.length} row${val.length === 1 ? '' : 's'} answered`;
    // Objects would otherwise render as "[object Object]".
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  }

  // ── Selection ───────────────────────────────────────────────────────────

  selected = signal<Set<string>>(new Set());
  bulkBusy = signal(false);
  bulkStatus = signal('');

  private key(r: any): string {
    return String(r.primary_id);
  }

  isSelected(r: any): boolean {
    return this.selected().has(this.key(r));
  }

  allSelected(): boolean {
    return this.rows.length > 0 && this.selected().size === this.rows.length;
  }

  toggleOne(r: any): void {
    const next = new Set(this.selected());
    const k = this.key(r);
    if (!next.delete(k)) next.add(k);
    this.selected.set(next);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? new Set() : new Set(this.rows.map((r) => this.key(r))));
  }

  clearSelection(): void {
    this.selected.set(new Set());
    this.bulkStatus.set('');
  }

  /** Selected rows that actually have a call behind them — everything else
   * (never dialled, no answer) has nothing to download or analyse. */
  selectedWithCall(): any[] {
    const ids = this.selected();
    return this.rows.filter((r) => ids.has(this.key(r)) && r.call_id);
  }

  private selectedRows(): any[] {
    const ids = this.selected();
    return this.rows.filter((r) => ids.has(this.key(r)));
  }

  downloadSelectedCsv(): void {
    const list = this.selectedRows();
    if (!list.length) return;
    const headers = [this.idLabel || 'Primary ID', 'Name', 'Status', ...this.outVars.map((v) => v.label), 'Captured'];
    const csvRows = list.map((r) => [
      r.phone ?? r.primary_id ?? '',
      r.name ?? '',
      outcomeView(r.outcome).label,
      ...this.outVars.map((v) => this.textValue(r.outputs?.[v.key])),
      r.captured_at ?? '',
    ]);
    const csv = '﻿' + [headers, ...csvRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-responses-${list.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Triggers one download per selected call, staggered — enough browsers block
   * simultaneous downloads that firing them all in the same tick loses some. */
  downloadSelectedAudio(): void {
    const list = this.selectedWithCall();
    list.forEach((r, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = this.api.recordingUrls(r.call_id).download;
        a.download = `${r.call_id}.wav`;
        a.click();
      }, i * 400);
    });
  }

  async reanalyzeSelected(): Promise<void> {
    const list = this.selectedWithCall();
    if (!list.length) return;
    this.bulkBusy.set(true);
    let ok = 0;
    for (const r of list) {
      try {
        await this.api.analyzeCall(r.call_id);
        ok++;
      } catch {
        // best-effort — one failed call must not stop the rest of the batch
      }
    }
    this.bulkBusy.set(false);
    this.bulkStatus.set(`Analyzed ${ok} of ${list.length}`);
  }
}
