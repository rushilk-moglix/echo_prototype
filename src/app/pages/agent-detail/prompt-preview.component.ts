import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-prompt-preview',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal" role="dialog" aria-label="Full prompt" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div>
            <div class="modal-title">Full prompt — {{ agentLabel }}</div>
            <div class="modal-sub">
              {{ preview.draft
                ? 'The editor’s current sections, including unsaved changes.'
                : 'The saved prompt.' }}
              Sections joined in order, exactly as written — {{ '{{tokens}}' }} shown as typed, not filled in.
              {{ preview.prompt.length.toLocaleString() }} characters.
            </div>
          </div>
          <button class="btn btn-sm" (click)="close.emit()" title="Close (Esc)">
            <app-icon name="close" [size]="13"></app-icon>
          </button>
        </div>
        <pre class="modal-body flush prompt-preview mono">{{ preview.prompt }}</pre>
        <div class="modal-foot">
          <button class="btn btn-sm" (click)="copy()">Copy</button>
          <button class="btn btn-primary btn-sm" (click)="close.emit()">Close</button>
        </div>
      </div>
    </div>
  `,
})
export class PromptPreviewComponent {
  @Input() preview: any;
  @Input() agentLabel = '';
  @Output() close = new EventEmitter<void>();

  @HostListener('window:keydown.Escape')
  onEsc(): void { this.close.emit(); }

  copy(): void { navigator.clipboard?.writeText(this.preview.prompt); }
}
