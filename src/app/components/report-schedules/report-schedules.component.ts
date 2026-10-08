import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';
import { HintComponent } from '../hint/hint.component';
import { ConfirmComponent } from '../confirm/confirm.component';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FORMATS = [
  { key: 'image', label: 'Picture', icon: 'image', help: 'One picture in the email body, ready to forward to a chat group.' },
  { key: 'pdf', label: 'PDF', icon: 'file', help: 'A two page summary for reviews.' },
  { key: 'excel', label: 'Spreadsheet', icon: 'table', help: 'Five tabs: summary, comparison, day by day, follow ups and every contact.' },
];

/**
 * Reports by email: the list of what is sent, and one short form to add or change one.
 * A compact centred popup; the report itself is whatever the Overview shows for the same choices.
 */
@Component({
  selector: 'app-report-schedules',
  standalone: true,
  imports: [FormsModule, IconComponent, HintComponent, ConfirmComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal rs" role="dialog" aria-label="Reports by email" (click)="$event.stopPropagation()">
        <div class="modal-head">
          <div class="modal-title">{{ form() ? (form().id ? 'Change report' : 'New report by email') : 'Reports by email' }}</div>
          <button class="icon-btn" (click)="form() ? form.set(null) : close.emit()" [attr.aria-label]="form() ? 'Back to the list' : 'Close'"><app-icon [name]="form() ? 'back' : 'close'" [size]="16"></app-icon></button>
        </div>

        @if (!form()) {
          <div class="modal-body rs-body">
            @if (error()) { <div class="note bad">{{ error() }}</div> }
            @if (!list().length) {
              <div class="empty"><div class="empty-icon"><app-icon name="mail" [size]="18"></app-icon></div><div class="empty-title">Nothing is sent yet</div><div class="empty-sub">Add a report and it arrives by email on the days you pick.</div></div>
            }
            @for (s of list(); track s.id) {
              <div class="rs-row" [class.off]="!s.on">
                <label class="switch" [title]="s.on ? 'Sending. Switch off to pause.' : 'Paused'"><input type="checkbox" [checked]="s.on" (change)="toggle(s)" [attr.aria-label]="'Send ' + s.name" /><i></i></label>
                <div class="rs-main">
                  <b>{{ s.name }}</b>
                  <span class="row-sub">{{ agentLabel(s) }} · {{ when(s) }} · to {{ s.recipients.length }} {{ s.recipients.length === 1 ? 'person' : 'people' }} · {{ formatsLabel(s) }}</span>
                  <span class="row-sub">{{ s.last_sent_at ? 'Last sent ' + ago(s.last_sent_at) : 'Not sent yet' }}@if (sent() === s.id) { <span class="rs-ok"> · sent just now</span> }</span>
                </div>
                <button class="icon-btn" (click)="sendNow(s)" title="Send it now" [attr.aria-label]="'Send ' + s.name + ' now'"><app-icon name="send" [size]="15"></app-icon></button>
                <button class="icon-btn" (click)="edit(s)" title="Change" [attr.aria-label]="'Change ' + s.name"><app-icon name="edit" [size]="15"></app-icon></button>
                <button class="icon-btn" (click)="removing.set(s)" title="Remove" [attr.aria-label]="'Remove ' + s.name"><app-icon name="trash" [size]="15"></app-icon></button>
              </div>
            }
          </div>
          <div class="modal-foot">
            <button class="btn" (click)="close.emit()">Close</button>
            <button class="btn btn-primary" (click)="add()"><app-icon name="plus" [size]="14"></app-icon> New report</button>
          </div>
        } @else {
          <div class="modal-body rs-body">
            @if (error()) { <div class="note bad">{{ error() }}</div> }
            <label class="field"><span class="field-label">Name</span><input class="input" [(ngModel)]="form().name" placeholder="End of day calling report" maxlength="80" /></label>
            <div class="rs-two">
              <div class="field"><span class="field-label">Send <app-hint text="Daily reports cover that day. Weekly reports cover the seven days before."></app-hint></span>
                <div class="seg" role="group" aria-label="How often"><button [class.on]="form().every === 'day'" (click)="setEvery('day')">Daily</button><button [class.on]="form().every === 'week'" (click)="setEvery('week')">Weekly</button></div>
              </div>
              <label class="field"><span class="field-label">At <app-hint text="India time (IST)."></app-hint></span><input class="input" type="time" [(ngModel)]="form().time" /></label>
            </div>
            <div class="field"><span class="field-label">{{ form().every === 'week' ? 'On' : 'On these days' }}</span>
              <div class="rs-days" role="group" aria-label="Days">
                @for (d of DAYS; track d; let i = $index) { <button [class.on]="form().weekdays.includes(i)" (click)="toggleDay(i)" [attr.aria-pressed]="form().weekdays.includes(i)">{{ d }}</button> }
              </div>
            </div>
            <div class="field"><span class="field-label">To <app-hint text="Type an email address and press Enter. Up to 25 people."></app-hint></span>
              <div class="rs-chips">
                @for (e of form().recipients; track e) { <span class="rs-chip">{{ e }}<button (click)="dropRecipient(e)" [attr.aria-label]="'Remove ' + e"><app-icon name="close" [size]="11"></app-icon></button></span> }
                <input class="rs-chip-input" [(ngModel)]="typing" (keydown.enter)="addRecipient($event)" (keydown.,)="addRecipient($event)" (blur)="addRecipient()" placeholder="name@company.com" aria-label="Add an email address" />
              </div>
            </div>
            <div class="field"><span class="field-label">Attach</span>
              <div class="rs-formats">
                @for (f of FORMATS; track f.key) {
                  <label class="rs-format" [class.on]="form().formats.includes(f.key)" [title]="f.help"><input type="checkbox" [checked]="form().formats.includes(f.key)" (change)="toggleFormat(f.key)" /><app-icon [name]="f.icon" [size]="15"></app-icon> {{ f.label }}</label>
                }
              </div>
            </div>
            <details class="adv">
              <summary>Advanced <span class="adv-hint">what the report compares and covers</span></summary>
              <div class="adv-body">
                <label class="field"><span class="field-label">Agent <app-hint text="All agents sends the calling numbers only. One agent adds its answers."></app-hint></span>
                  <select class="select" [(ngModel)]="form().agent" (ngModelChange)="form().by === 'agent' && $event ? (form().by = 'campaign') : null">
                    <option value="">All agents</option>
                    @for (a of agents; track a.key) { <option [value]="a.key">{{ a.label }}</option> }
                  </select>
                </label>
                <div class="rs-two">
                  <label class="field"><span class="field-label">Compare by</span>
                    <select class="select" [(ngModel)]="form().by" (ngModelChange)="form().value = ''">
                      <option value="campaign">Campaign</option><option value="agent">Agent</option><option value="day">Day</option>
                      @for (c of columns; track c.key) { <option [value]="c.key">{{ c.label }}</option> }
                    </select>
                  </label>
                  <label class="field"><span class="field-label">Only <app-hint text="Send one team only its own numbers: pick a column to compare by, then the value this report is about."></app-hint></span>
                    <select class="select" [(ngModel)]="form().value" [disabled]="!valuesFor(form().by).length">
                      <option value="">Everything</option>
                      @for (v of valuesFor(form().by); track v) { <option [value]="v">{{ v }}</option> }
                    </select>
                  </label>
                </div>
                <label class="rs-check"><input type="checkbox" [(ngModel)]="form().include_follow_ups" /> Include the list of contacts that need follow up</label>
              </div>
            </details>
          </div>
          <div class="modal-foot">
            <span class="row-sub rs-next">{{ preview() }}</span>
            <button class="btn" (click)="form.set(null)">Cancel</button>
            <button class="btn btn-primary" [disabled]="busy()" (click)="save()">{{ busy() ? 'Saving…' : form().id ? 'Save' : 'Start sending' }}</button>
          </div>
        }
      </div>
    </div>
    @if (removing(); as r) {
      <app-confirm title="Remove this report?" [body]="r.name + ' will stop being sent to ' + r.recipients.length + (r.recipients.length === 1 ? ' person.' : ' people.')" confirmLabel="Remove" [danger]="true" (confirm)="remove(r)" (cancel)="removing.set(null)"></app-confirm>
    }
  `,
})
export class ReportSchedulesComponent implements OnInit {
  private api = inject(ApiService);
  /** What the page is showing now; a new report starts from it. */
  @Input() by = 'campaign';
  @Input() value = '';
  @Input() agent = '';
  @Input() agents: { key: string; label: string }[] = [];
  @Input() columns: { key: string; label: string; values: string[] }[] = [];
  /** Open straight on the new report form (from Share, Send on a schedule). */
  @Input() startNew = false;
  @Output() close = new EventEmitter<void>();

  readonly DAYS = DAYS; readonly FORMATS = FORMATS;
  list = signal<any[]>([]);
  form = signal<any>(null);
  error = signal(''); busy = signal(false); sent = signal(''); removing = signal<any>(null);
  typing = '';

  preview = computed(() => { const f = this.form(); return f ? `Goes out ${this.when(f).toLowerCase()}` : ''; });

  @HostListener('document:keydown.escape') onEsc(): void { if (this.removing()) return; if (this.form()) this.form.set(null); else this.close.emit(); }

  async ngOnInit(): Promise<void> { await this.load(); if (this.startNew) this.add(); }
  private async load(): Promise<void> { try { this.list.set((await this.api.reportSchedules()).schedules || []); this.error.set(''); } catch (e: any) { this.error.set(e.message); } }

  add(): void { this.error.set(''); this.typing = ''; this.form.set({ name: '', every: 'day', weekdays: [1, 2, 3, 4, 5], time: '18:30', days: 1, by: this.by, value: this.value, agent: this.agent, recipients: [], formats: ['image', 'excel'], include_follow_ups: true, on: true }); }
  edit(s: any): void { this.error.set(''); this.typing = ''; this.form.set({ ...s, weekdays: [...s.weekdays], recipients: [...s.recipients], formats: [...s.formats] }); }
  setEvery(v: 'day' | 'week'): void { const f = this.form(); f.every = v; f.days = v === 'week' ? 7 : 1; f.weekdays = v === 'week' ? [1] : [1, 2, 3, 4, 5]; this.form.set({ ...f }); }
  toggleDay(i: number): void { const f = this.form(); f.weekdays = f.every === 'week' ? [i] : f.weekdays.includes(i) ? f.weekdays.filter((d: number) => d !== i) : [...f.weekdays, i].sort(); this.form.set({ ...f }); }
  toggleFormat(k: string): void { const f = this.form(); f.formats = f.formats.includes(k) ? f.formats.filter((x: string) => x !== k) : [...f.formats, k]; this.form.set({ ...f }); }
  addRecipient(ev?: Event): void {
    ev?.preventDefault(); const f = this.form(); if (!f) return;
    const found = this.typing.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (found.length) { f.recipients = [...new Set([...f.recipients, ...found])].slice(0, 25); this.typing = ''; this.form.set({ ...f }); }
  }
  dropRecipient(e: string): void { const f = this.form(); f.recipients = f.recipients.filter((x: string) => x !== e); this.form.set({ ...f }); }
  valuesFor(by: string): string[] { return this.columns.find((c) => c.key === by)?.values || []; }

  async save(): Promise<void> {
    this.addRecipient(); const f = this.form(); this.busy.set(true);
    try { if (f.id) await this.api.updateReportSchedule(f.id, f); else await this.api.createReportSchedule(f); this.form.set(null); await this.load(); }
    catch (e: any) { this.error.set(e.message); }
    this.busy.set(false);
  }
  async toggle(s: any): Promise<void> { try { await this.api.updateReportSchedule(s.id, { on: !s.on }); await this.load(); } catch (e: any) { this.error.set(e.message); } }
  async sendNow(s: any): Promise<void> { try { await this.api.sendReportNow(s.id); this.sent.set(s.id); await this.load(); setTimeout(() => this.sent.set(''), 4000); } catch (e: any) { this.error.set(e.message); } }
  async remove(s: any): Promise<void> { try { await this.api.deleteReportSchedule(s.id); } catch (e: any) { this.error.set(e.message); } this.removing.set(null); await this.load(); }

  when(s: any): string {
    const days = (s.weekdays || []).slice().sort();
    const which = s.every === 'week' ? `Every ${DAYS[days[0]] ?? 'Mon'}` : days.length === 7 ? 'Every day' : days.join() === '1,2,3,4,5' ? 'Weekdays' : days.map((d: number) => DAYS[d]).join(', ');
    return `${which} at ${s.time}`;
  }
  agentLabel(s: any): string { return s.agent ? this.agents.find((a) => a.key === s.agent)?.label || s.agent : 'All agents'; }
  formatsLabel(s: any): string { return FORMATS.filter((f) => s.formats.includes(f.key)).map((f) => f.label.toLowerCase()).join(', '); }
  ago(iso: string): string { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
}
