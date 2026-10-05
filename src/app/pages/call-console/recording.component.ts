import { Component, inject, signal, OnInit, OnDestroy, ElementRef, ViewChild, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AudioService } from '../../services/audio.service';
import { IconComponent } from '../../components/icon/icon.component';
import { toE164, isValidE164 } from '../../utils/phone';
import { clock } from '../../utils/format';

@Component({
  selector: 'app-recording',
  standalone: true,
  template: `
    @if (state() === 'waiting') {
      <span class="mono" style="font-size: 12px; color: var(--faint)">Saving recording…</span>
    } @else if (state() === 'unavailable') {
      <span class="mono" style="font-size: 12px; color: var(--faint)">No recording saved.</span>
    } @else {
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
        <audio controls [src]="audioUrl" style="height: 32px"></audio>
        <a class="btn btn-sm" [href]="downloadUrl" download>Download audio</a>
      </div>
    }
  `,
})
export class RecordingComponent implements OnInit, OnDestroy {
  @Input() streamSid = '';
  /** Already-known recording URL — a campaign call's Ozonetel S3 link, which
   * lives directly on the call document. When set, this skips voxlix-backend
   * entirely: it only ever knows about locally-saved console recordings, so
   * polling it for a campaign call just burns 18s finding nothing. */
  @Input() recordingUrl = '';
  private api = inject(ApiService);
  state = signal<'waiting' | 'ready' | 'unavailable'>('waiting');
  audioUrl = '';
  downloadUrl = '';
  private statusUrl = '';
  private alive = true;
  ngOnInit(): void {
    if (this.recordingUrl) {
      this.audioUrl = this.recordingUrl;
      this.downloadUrl = this.recordingUrl;
      this.state.set('ready');
      return;
    }
    const urls = this.api.recordingUrls(this.streamSid);
    this.audioUrl = urls.audio;
    this.downloadUrl = urls.download;
    this.statusUrl = urls.status;
    this.poll(0);
  }
  ngOnDestroy(): void { this.alive = false; }
  private async poll(tries: number): Promise<void> {
    if (!this.alive) return;
    try {
      const r = await fetch(this.statusUrl);
      const j = await r.json();
      if (j?.ready) { this.state.set('ready'); return; }
    } catch { /* */ }
    if (tries < 30) setTimeout(() => this.poll(tries + 1), 600);
    else this.state.set('unavailable');
  }
}
