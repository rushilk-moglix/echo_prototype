import { Injectable, signal } from '@angular/core';
import { ulawToLin, linToUlaw } from '../utils/ulaw-codec';

export interface TranscriptEntry {
  role: 'user' | 'agent';
  text: string;
}

export interface SessionEvent {
  time: string;
  name: string;
  detail: string;
  tone: string;
}

@Injectable({ providedIn: 'root' })
export class AudioService {
  readonly isLive = signal(false);
  readonly status = signal('Idle');
  readonly streamSid = signal<string | null>(null);
  readonly elapsed = signal(0);
  readonly turns = signal<TranscriptEntry[]>([]);
  readonly events = signal<SessionEvent[]>([]);

  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private playCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private procNode: ScriptProcessorNode | null = null;
  private srcNode: MediaStreamAudioSourceNode | null = null;
  private nextPlayTime = 0;
  private scheduled: AudioBufferSourceNode[] = [];
  private pending = new Float32Array(0);
  private framesUp = 0;
  private framesDown = 0;
  private stopped = false;
  private timerInterval: any = null;

  async start(url: string): Promise<void> {
    this.reset();
    this.stopped = false;
    this.status.set('Requesting microphone…');

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.audioCtx = new AudioContext();
    this.playCtx = new AudioContext();
    this.srcNode = this.audioCtx.createMediaStreamSource(this.micStream);
    this.procNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.srcNode.connect(this.procNode);
    this.procNode.connect(this.audioCtx.destination);

    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.status.set('connected — say something after the greeting');
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onclose = () => {
      // The ONLY end-of-call signal the page gets when the AGENT hangs up. It
      // used to update the label and nothing else, leaving the mic open, both
      // AudioContexts alive, and nextPlayTime holding a stale timestamp for the
      // next call.
      this.isLive.set(false);
      this.status.set('Call ended');
      this.stopTimer();
      // Mic off at once — the call is over, keep no open capture.
      this.procNode?.disconnect();
      this.srcNode?.disconnect();
      this.micStream?.getTracks().forEach((t) => t.stop());
      // But do NOT tear down playback yet: the agent's closing line is still in
      // the scheduler (audio is delivered faster than it plays), and closing the
      // context here would swallow the goodbye. Wait out what is queued, capped
      // so a bad playhead can't defer cleanup forever. stop() is idempotent.
      const tail = this.playCtx
        ? Math.max(0, this.nextPlayTime - this.playCtx.currentTime)
        : 0;
      setTimeout(() => this.stop(false), Math.min(tail, 15) * 1000 + 300);
    };
    this.ws.onerror = () => this.logEvent('error', 'websocket error', 'warn');

    this.procNode.onaudioprocess = (e) =>
      this.sendMic(e.inputBuffer.getChannelData(0), this.audioCtx!.sampleRate);

    this.isLive.set(true);
    this.startTimer();
  }

  stop(sendStop = true): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTimer();

    if (this.ws && this.ws.readyState === 1 && sendStop) {
      try { this.ws.send(JSON.stringify({ event: 'stop' })); } catch { /* closing */ }
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* already closed */ }
      this.ws = null;
    }
    this.procNode?.disconnect();
    this.srcNode?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.clearPlayback();
    this.audioCtx?.close().catch(() => {});
    this.playCtx?.close().catch(() => {});
    this.procNode = null;
    this.srcNode = null;
    this.micStream = null;
    this.audioCtx = null;
    this.playCtx = null;
    this.pending = new Float32Array(0);

    this.isLive.set(false);
    this.status.set('Call ended');
  }

  logEvent(name: string, detail: string, tone = 'ok'): void {
    const time = `${String(Math.floor(this.elapsed() / 60)).padStart(2, '0')}:${String(this.elapsed() % 60).padStart(2, '0')}`;
    this.events.update((e) => [{ time, name, detail, tone }, ...e].slice(0, 40));
  }

  private reset(): void {
    this.turns.set([]);
    this.events.set([]);
    this.elapsed.set(0);
    this.streamSid.set(null);
    this.framesUp = 0;
    this.framesDown = 0;
    // nextPlayTime is an absolute timestamp in the PREVIOUS AudioContext's clock,
    // and start() is about to build a new context whose currentTime restarts at
    // ~0. Carrying the old value over schedules the whole call that far into the
    // future — a call after a several-minute session played its audio five
    // minutes late, in order, long after the socket had closed. A call that ends
    // via ws.onclose never runs stop(), so this is the only place it gets reset.
    this.clearPlayback();
  }

  private startTimer(): void {
    this.timerInterval = setInterval(() => this.elapsed.update((s) => s + 1), 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  private onMessage(ev: MessageEvent): void {
    let d: any;
    try { d = JSON.parse(ev.data); } catch { return; }

    if (d.event === 'session') {
      this.streamSid.set(d.stream_sid);
      this.logEvent('session.connected', d.stream_sid);
    } else if (d.event === 'media' && d.media?.payload) {
      this.framesDown++;
      this.play(d.media.payload);
    } else if (d.event === 'clear') {
      this.clearPlayback();
    } else if (d.event === 'transcript') {
      const role: 'user' | 'agent' = d.role === 'agent' ? 'agent' : 'user';
      this.turns.update((t) => [...t, { role, text: d.text }]);
    } else if (d.event === 'error') {
      this.logEvent('error', d.message || 'unknown error', 'warn');
    }
  }

  private play(b64: string): void {
    if (!this.playCtx) return;
    const bin = atob(b64);
    const n = bin.length;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = ulawToLin(bin.charCodeAt(i)) / 32768;
    const buf = this.playCtx.createBuffer(1, n, 8000);
    buf.copyToChannel(f, 0);
    const src = this.playCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.playCtx.destination);
    const t = Math.max(this.playCtx.currentTime + 0.02, this.nextPlayTime);
    src.start(t);
    this.nextPlayTime = t + buf.duration;
    this.scheduled.push(src);
    src.onended = () => {
      this.scheduled = this.scheduled.filter((x) => x !== src);
    };
  }

  private clearPlayback(): void {
    this.scheduled.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
    this.scheduled = [];
    this.nextPlayTime = 0;
  }

  private sendMic(f32: Float32Array, inRate: number): void {
    const ratio = inRate / 8000;
    const outLen = Math.floor(f32.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = f32[Math.floor(i * ratio)];

    const merged = new Float32Array(this.pending.length + outLen);
    merged.set(this.pending);
    merged.set(out, this.pending.length);

    let off = 0;
    while (merged.length - off >= 160) {
      let bin = '';
      for (let i = 0; i < 160; i++) {
        const s = (Math.max(-1, Math.min(1, merged[off + i])) * 32767) | 0;
        bin += String.fromCharCode(linToUlaw(s));
      }
      off += 160;
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ event: 'media', media: { payload: btoa(bin) } }));
        this.framesUp++;
        if (this.framesUp % 250 === 0) {
          this.status.set(
            `live — ${(this.framesUp / 50).toFixed(0)}s mic / ${(this.framesDown / 50).toFixed(0)}s agent`,
          );
        }
      }
    }
    this.pending = merged.slice(off);
  }
}
