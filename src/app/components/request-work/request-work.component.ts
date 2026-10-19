import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';
import { IconComponent } from '../icon/icon.component';
import { BuyCreditsComponent } from '../buy-credits/buy-credits.component';

/** Ask the Vanik team to build an agent or an integration. A small deposit holds the slot; the quote comes next. */
@Component({
  selector: 'app-request-work',
  standalone: true,
  imports: [FormsModule, IconComponent, BuyCreditsComponent],
  template: `
    <div class="modal-backdrop" (click)="close()">
      <form class="modal" style="max-width: 560px; width: calc(100vw - 32px)" role="dialog" [attr.aria-label]="heading()" (click)="$event.stopPropagation()" (ngSubmit)="send()">
        <div class="modal-head"><div class="modal-title">{{ heading() }}</div>
          <button type="button" class="btn-icon" (click)="close()" aria-label="Close"><app-icon name="close" [size]="16"></app-icon></button></div>
        @if (sent()) {
          <div class="modal-body" style="display: grid; gap: 8px">
            <b>Request sent</b>
            <span class="row-sub">The Vanik team replies with a quote within one working day. Follow it on the Credits page, under Requests.</span>
          </div>
          <div class="modal-foot"><span style="flex: 1"></span><button type="button" class="btn btn-primary" (click)="close()">Done</button></div>
        } @else {
          <div class="modal-body" style="display: grid; gap: 12px">
            <div class="seg" role="group" aria-label="What you need">
              <button type="button" [class.on]="kind() === 'custom_agent'" (click)="kind.set('custom_agent')">An agent</button>
              <button type="button" [class.on]="kind() === 'custom_integration'" (click)="kind.set('custom_integration')">An integration</button>
            </div>
            <label class="field"><span class="field-label">What do you need, in a line</span>
              <input class="input" name="title" [ngModel]="title()" (ngModelChange)="title.set($event)" [placeholder]="kind() === 'custom_agent' ? 'Collections agent in Hindi for our dealers' : 'Write answers back to SAP S/4 purchase orders'" autofocus /></label>
            <label class="field"><span class="field-label">Details <span class="row-sub">· optional</span></span>
              <textarea class="input" name="details" rows="4" [ngModel]="details()" (ngModelChange)="details.set($event)" placeholder="Who it calls, what it should find out, where the answers go, how many calls a month"></textarea></label>
            <div class="rw-cost">
              <span><b class="mono">{{ fmt(deposit) }}</b> credit deposit now, counted in the quote. Usual price {{ kind() === 'custom_agent' ? 'from ' + fmt(price('custom_agent')) : 'from ' + fmt(price('custom_integration')) }} credits.</span>
              <span class="row-sub">Cancel before you accept the quote and the deposit comes back.</span>
            </div>
            @if (error()) { <div class="note bad">{{ error() }} @if (short()) { <button type="button" class="link" (click)="buying.set(true)">Buy credits</button> }</div> }
          </div>
          <div class="modal-foot"><button type="button" class="btn" (click)="close()">Cancel</button><span style="flex: 1"></span>
            <button class="btn btn-primary" [disabled]="busy() || !title().trim()">{{ busy() ? 'Sending…' : 'Send request · ' + fmt(deposit) + ' credits' }}</button></div>
        }
      </form>
    </div>
    @if (buying()) { <app-buy-credits [need]="deposit" (closed)="buying.set(false)"></app-buy-credits> }
  `,
  styles: [`.rw-cost { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--ds-surface-sunken); font-size: 13px; }`],
})
export class RequestWorkComponent implements OnInit {
  @Input() initialKind: 'custom_agent' | 'custom_integration' = 'custom_agent';
  @Input() initialTitle = '';
  @Output() closed = new EventEmitter<void>();
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private credits = inject(CreditsService);
  fmt = fmtCredits;
  deposit = 5000;
  kind = signal<'custom_agent' | 'custom_integration'>('custom_agent');
  title = signal('');
  details = signal('');
  busy = signal(false);
  error = signal('');
  short = signal(false);
  sent = signal(false);
  buying = signal(false);
  heading = () => (this.kind() === 'custom_agent' ? 'Have our team build an agent' : 'Request a custom integration');
  price = (k: string) => this.credits.price(k);
  ngOnInit(): void { this.kind.set(this.initialKind); this.title.set(this.initialTitle); if (!this.credits.wallet()) this.credits.refresh(); }
  async send(): Promise<void> {
    this.busy.set(true); this.error.set(''); this.short.set(false);
    try { this.credits.set(await this.api.createRequest(this.auth.currentOrgId(), { kind: this.kind(), title: this.title().trim(), details: this.details().trim() })); this.sent.set(true); }
    catch (e: any) { this.error.set(e.message); this.short.set(/credits/i.test(e.message)); }
    finally { this.busy.set(false); }
  }
  close(): void { if (!this.busy()) this.closed.emit(); }
}
