import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

/**
 * In-app confirmation, replacing window.confirm. Shows what will happen and
 * waits for an explicit click; Escape or the backdrop cancels.
 */
@Component({
  selector: 'app-confirm',
  standalone: true,
  template: `
    <div class="modal-backdrop" (click)="cancel.emit()">
      <div class="modal" role="dialog" [attr.aria-label]="title" (click)="$event.stopPropagation()" style="max-width: 460px">
        <div class="modal-head"><div class="modal-title">{{ title }}</div></div>
        <div class="modal-body" style="padding: 16px 18px">
          <p style="margin: 0; color: var(--ink-3); line-height: 1.55">{{ body }}</p>
          <ng-content></ng-content>
        </div>
        <div class="modal-foot">
          <button class="btn" (click)="cancel.emit()">Cancel</button>
          <button [class]="'btn ' + (danger ? 'btn-stop' : 'btn-primary')" [disabled]="busy" (click)="confirm.emit()">{{ busy ? 'Working…' : confirmLabel }}</button>
        </div>
      </div>
    </div>
  `,
})
export class ConfirmComponent {
  @Input() title = 'Are you sure?';
  @Input() body = '';
  @Input() confirmLabel = 'Confirm';
  @Input() danger = false;
  @Input() busy = false;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @HostListener('document:keydown.escape') onEsc(): void { this.cancel.emit(); }
}
