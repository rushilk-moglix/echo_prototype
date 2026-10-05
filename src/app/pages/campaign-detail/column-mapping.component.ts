import { Component, Input, Output, EventEmitter, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';

/**
 * Confirm which sheet column feeds which of the agent's inputs, before dialling.
 *
 * The backend matches by header name and falls back to column position, which is
 * right often enough to be dangerous: a wrong guess produces a clean-looking
 * upload that calls the correct people and tells them the wrong things. So the
 * proposal is always shown, always with real values from the sheet, and the
 * operator confirms or corrects it.
 *
 * Nothing here re-parses. It edits an index-per-column map and hands it back.
 */
@Component({
  selector: 'app-column-mapping',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="cancel.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div>
            <div class="modal-title">Check the columns</div>
            <div class="modal-sub">
              {{ parsedRows }} rows read from <span class="mono">{{ fileName }}</span>. Confirm each
              of the agent's inputs is reading the right column — the values shown are from your
              sheet.
            </div>
          </div>
        </div>

        <div class="modal-body flush">
          @if (guessed().length > 0) {
            <div class="note" style="margin: 14px 18px 0">
              {{ guessed().length }} column{{ guessed().length === 1 ? '' : 's' }} matched by
              position, not by name — <span class="mono">{{ guessed().join(', ') }}</span>. Check
              these especially.
            </div>
          }
          @if (duplicates().length > 0) {
            <div class="note bad" style="margin: 14px 18px 0">
              <span class="mono">{{ duplicates().join(', ') }}</span> are reading the same column.
            </div>
          }
          @if (missingRequired().length > 0) {
            <div class="note bad" style="margin: 14px 18px 0">
              <span class="mono">{{ missingRequired().join(', ') }}</span> must be mapped before
              this can be dialled.
            </div>
          }

          <div class="map-rows">
            @for (m of rows(); track m.column; let i = $index) {
              <div class="map-row">
                <div class="map-target">
                  <span class="mono">{{ m.column }}</span>
                  @if (m.required) { <span style="color: var(--ds-accent-fg)">*</span> }
                  @if (m.role === 'dial') {
                    <div class="map-role">the number called</div>
                  } @else if (m.role === 'primary_id') {
                    <div class="map-role">results keyed by this</div>
                  }
                </div>
                <div class="map-arrow"><app-icon name="back" [size]="13"></app-icon></div>
                <div>
                  <select class="select" [ngModel]="m.index" (ngModelChange)="setIndex(i, $event)">
                    <option [ngValue]="null">— not mapped —</option>
                    @for (h of sheetHeaders; track $index; let c = $index) {
                      <option [ngValue]="c">{{ h || 'column ' + (c + 1) }}</option>
                    }
                  </select>
                  <div class="map-sample">
                    @if (m.index === null) {
                      <span style="color: var(--ds-text-placeholder)">nothing will be filled in</span>
                    } @else {
                      @for (v of samplesFor(m.index); track $index) {
                        <span class="map-chip">{{ v || '—' }}</span>
                      }
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn" (click)="cancel.emit()">Cancel</button>
          <button class="btn btn-primary" [disabled]="!valid() || busy" (click)="emitConfirm()">
            {{ busy ? 'Pushing…' : 'Upload & call ' + parsedRows + ' numbers' }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ColumnMappingComponent implements OnInit {
  /** Backend proposal: [{column, index, header, matched_by, required}, …] */
  @Input() mapping: any[] = [];
  @Input() sheetHeaders: string[] = [];
  @Input() sampleRows: string[][] = [];
  @Input() parsedRows = 0;
  @Input() fileName = '';
  @Input() busy = false;

  @Output() confirm = new EventEmitter<Record<string, number | null>>();
  @Output() cancel = new EventEmitter<void>();

  rows = signal<any[]>([]);

  ngOnInit(): void {
    this.rows.set(this.mapping.map((m) => ({ ...m, index: m.index ?? null })));
  }

  setIndex(i: number, index: number | null): void {
    this.rows.update((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, index, matched_by: 'operator' } : r)),
    );
  }

  samplesFor(index: number): string[] {
    return this.sampleRows.map((r) => r[index] ?? '').slice(0, 3);
  }

  /** Columns the backend guessed by position — the ones worth a second look. */
  guessed = computed(() =>
    this.rows().filter((r) => r.matched_by === 'position').map((r) => r.column),
  );

  /**
   * Two inputs reading one column. Allowed by the data model but almost always a
   * mistake, and it silently duplicates one value into two prompt tokens.
   */
  duplicates = computed(() => {
    const seen = new Map<number, string[]>();
    for (const r of this.rows()) {
      if (r.index === null) continue;
      seen.set(r.index, [...(seen.get(r.index) || []), r.column]);
    }
    return [...seen.values()].filter((cols) => cols.length > 1).flat();
  });

  missingRequired = computed(() =>
    this.rows().filter((r) => r.required && r.index === null).map((r) => r.column),
  );

  valid = computed(() => this.missingRequired().length === 0 && this.duplicates().length === 0);

  emitConfirm(): void {
    const out: Record<string, number | null> = {};
    for (const r of this.rows()) out[r.column] = r.index;
    this.confirm.emit(out);
  }
}
