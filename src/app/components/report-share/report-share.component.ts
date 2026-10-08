import { Component, ElementRef, HostListener, Input, inject, signal } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';
import { ReportSchedulesComponent } from '../report-schedules/report-schedules.component';
import { downloadReportCard } from '../../utils/report-card';

/**
 * Share: the report on screen as a picture, a PDF or a spreadsheet, or by email on a schedule.
 * One button and a short menu, so the page itself stays about the numbers.
 */
@Component({
  selector: 'app-report-share',
  standalone: true,
  imports: [IconComponent, ReportSchedulesComponent],
  template: `
    <span class="rp-share">
      <button class="btn btn-sm" (click)="open.set(!open())" aria-haspopup="menu" [attr.aria-expanded]="open()"><app-icon name="share" [size]="14"></app-icon> Share</button>
      @if (open()) {
        <div class="rp-menu" role="menu">
          <button role="menuitem" (click)="picture()"><app-icon name="image" [size]="15"></app-icon><span><b>Picture</b><small>For chat groups</small></span></button>
          <button role="menuitem" (click)="pdf()"><app-icon name="file" [size]="15"></app-icon><span><b>PDF</b><small>For reviews</small></span></button>
          <a role="menuitem" [href]="sheetUrl()" download (click)="open.set(false)"><app-icon name="table" [size]="15"></app-icon><span><b>Spreadsheet</b><small>Every number and contact</small></span></a>
          <hr />
          <button role="menuitem" (click)="schedule(true)"><app-icon name="mail" [size]="15"></app-icon><span><b>Send by email on a schedule</b><small>Daily or weekly</small></span></button>
          <button role="menuitem" (click)="schedule(false)"><app-icon name="calendar" [size]="15"></app-icon><span><b>Reports being sent</b></span></button>
        </div>
      }
    </span>
    @if (schedules()) { <app-report-schedules [by]="by" [value]="value" [columns]="summary?.columns || []" [startNew]="startNew" [agent]="agent" [agents]="agents" (close)="schedules.set(false)"></app-report-schedules> }
  `,
})
export class ReportShareComponent {
  private api = inject(ApiService);
  private host = inject(ElementRef);
  @Input() summary: any = null;
  @Input() days = 30;
  @Input() by = 'campaign';
  @Input() byLabel = 'Campaign';
  @Input() value = '';
  @Input() agent = '';
  @Input() agents: { key: string; label: string }[] = [];
  @Input() workspace = '';
  @Input() period = '';

  open = signal(false);
  schedules = signal(false);
  startNew = false;

  @HostListener('document:click', ['$event']) away(e: Event): void { if (this.open() && !this.host.nativeElement.contains(e.target)) this.open.set(false); }
  @HostListener('document:keydown.escape') esc(): void { this.open.set(false); }

  sheetUrl(): string { return this.api.reportExportUrl({ days: String(this.days), by: this.by, value: this.value, agent: this.agent }); }
  async picture(): Promise<void> {
    this.open.set(false); if (!this.summary) return;
    await downloadReportCard({ title: 'Calling report', workspace: this.workspace || 'Echo', period: this.period, byLabel: this.byLabel, summary: this.summary }, `calling-report-${new Date().toISOString().slice(0, 10)}.jpg`);
  }
  /** The browser's own print to PDF, on a layout made for paper (see .print-report in styles). */
  pdf(): void { this.open.set(false); setTimeout(() => window.print(), 50); }
  schedule(startNew: boolean): void { this.open.set(false); this.startNew = startNew; this.schedules.set(true); }
}
