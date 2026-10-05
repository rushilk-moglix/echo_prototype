import { HintComponent } from '../../components/hint/hint.component';
import { Component, inject, signal, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AudioService, TranscriptEntry, SessionEvent } from '../../services/audio.service';
import { IconComponent } from '../../components/icon/icon.component';
import { RecordingComponent } from './recording.component';
import { toE164, isValidE164 } from '../../utils/phone';
import { clock } from '../../utils/format';
import { EnginePanelComponent, EngineConfig, DEFAULT_ENGINE } from '../../components/engine-panel/engine-panel.component';

@Component({
  selector: 'app-call-console',
  standalone: true,
  imports: [HintComponent, FormsModule, IconComponent, RecordingComponent, EnginePanelComponent],
  templateUrl: './call-console.component.html',
})
export class CallConsoleComponent implements OnInit, OnDestroy {
  /** contact_name becomes Contact name; the raw key stays in the hover. */
  niceKey(k: string): string { return String(k).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); }
  audio = inject(AudioService);
  private api = inject(ApiService);
  @ViewChild('scrollRef') scrollRef!: ElementRef;

  meterBars = Array.from({ length: 11 });
  clockFn = clock;
  /** Shown in the hint; a literal in the template would be read as interpolation. */
  tokenExample = '{{tokens}}';

  agents = signal<any[]>([]);
  channels = signal<any[]>([{ key: 'webrtc', label: 'Browser mic', configured: true }]);
  telephony = signal<any>({});

  /**
   * The console dials an agent directly.
   *
   * It used to pick a campaign and take the agent from it, which meant a test
   * call needed a campaign to exist first, and made the Ozonetel route a property
   * of the campaign. Both now come from the agent.
   */
  agentKey = '';
  channelKey = 'webrtc';
  voiceKey = '';
  phoneRaw = '';
  /**
   * Console-only test knobs for the native bridge — not agent config. Sent on
   * both WebRTC (start) and Ozonetel (dial) calls placed from this page; a
   * bulk campaign dial never touches this component and keeps today's exact
   * behaviour. Empty modelKey means "whatever the agent is configured for";
   * a non-empty value overrides it for this call only, so a model can be
   * tried without touching the agent's own settings.
   */
  modelKey = '';
  models = [{ key: '', label: 'Default (agent-configured)' }, { key: 'gemini-3.8-live', label: 'Gemini 3.8 Live (API key)' }];
  useSilero = true;
  // Compact console: call data and voice and model open in modals.
  dataOpen = signal(false);
  engineOpen = signal(false);
  /** On: the engine settings below override the agent's for this test call only. */
  override = signal(false);
  engine = signal<EngineConfig>({ ...DEFAULT_ENGINE });
  catalog = signal<Record<string, any[]>>({});
  filledCount(): number { return this.inputVars().filter((v: any) => (this.inputValues[v.key] || '').trim()).length; }
  engineSummary(): string {
    const e = this.engine(); const name = (k: string, id: string) => (this.catalog()[k] || []).find((m: any) => m.id === id)?.label || id;
    return e.mode === 's2s' ? name('s2s', e.s2s) : `${name('stt', e.stt)} · ${name('llm', e.llm)} · ${name('tts', e.tts)}`;
  }
  resetEngine(): void { this.engine.set({ ...DEFAULT_ENGINE }); }
  /** What the override sends: the full engine, plus the older single fields the voice service already reads. */
  private applyEngine(body: any): void {
    if (!this.override()) return;
    const e = this.engine();
    body.engine_override = e;
    if (e.voice) body.voice = e.voice;
    if (e.mode === 's2s') body.model_override = e.s2s;
    body.use_silero_vad = e.turn.interruption !== 'off';
  }

  /** Operator-entered values for the agent's declared inputs, keyed by variable key. */
  inputValues: Record<string, string> = {};

  dialing = signal(false);
  dialed = signal<any>(null);
  error = signal('');
  /** Newest server-side in-flight call, polled on phone channels (null when none). */
  liveCall = signal<any>(null);
  /**
   * The last call seen on a phone channel, kept after it ends.
   *
   * liveCall goes null the moment the call finishes, and reading the transcript
   * from it alone made the whole conversation vanish at hangup — exactly when you
   * want to read it. This holds it until the next call is started.
   */
  lastCall = signal<any>(null);
  /** What the agent reported via submit_call_outputs, once it has. */
  outputs = signal<Record<string, any> | null>(null);
  private outputsCallId = signal<string | null>(null);
  private fetchedOutputsFor: string | null = null;
  private outputTries = 0;
  private scrollInterval: any = null;
  private pollInterval: any = null;

  ngOnInit(): void {
    // ?agent=<key> (the "Test call" action on Agents) preselects that agent.
    const wanted = new URLSearchParams(window.location.search).get('agent') || '';
    this.api.agents().then((a) => {
      this.agents.set(a);
      if (wanted && a.some((x: any) => x.key === wanted)) this.agentKey = wanted;
      if (a[0] && !this.agentKey) this.agentKey = a[0].key;
    }).catch((e) => this.error.set(`Could not load agents: ${e.message}`));
    this.api.webrtcHealth().then((h) => this.telephony.set(h.telephony || {})).catch(() => this.telephony.set({}));
    this.api.agentMeta().then((m) => { if (m.channels?.length) this.channels.set(m.channels); this.catalog.set(m.engines || {}); }).catch(() => {});
    this.scrollInterval = setInterval(() => {
      this.scrollRef?.nativeElement?.scrollTo({ top: this.scrollRef.nativeElement.scrollHeight });
    }, 500);
    // A phone call has no browser socket — the audio never touches this tab — so the
    // only way to watch it is to ask the server what is in flight. Runs whether or not
    // we placed the call, which also makes inbound calls visible here.
    this.pollInterval = setInterval(() => this.pollLive(), 2000);
  }

  ngOnDestroy(): void {
    this.audio.stop(true);
    if (this.scrollInterval) clearInterval(this.scrollInterval);
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private async pollLive(): Promise<void> {
    if (!this.isPhoneCall()) { this.liveCall.set(null); await this.syncOutputs(); return; }
    try {
      const r = await this.api.liveCall(this.channelKey);
      this.liveCall.set(r.call || null);
    } catch {
      // Poll failures are transient and self-correcting; surfacing one as a page
      // error would flash a banner every 2s over a call that is running fine.
      this.liveCall.set(null);
    }
    await this.syncOutputs();
  }

  /** The agent's reported variables, pulled from the submit_call_outputs tool call. */
  private extractOutputs(events: any[]): Record<string, any> | null {
    // Last one wins: an agent that corrects itself calls the tool twice.
    const calls = (events || []).filter(
      (e: any) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs',
    );
    if (!calls.length) return null;
    const { stream_sid, ...values } = calls[calls.length - 1].args || {};
    return values;
  }

  /**
   * Keep `outputs` in step with the call, on both transports.
   *
   * While a phone call runs its events are already being polled, so outputs appear
   * the moment the agent reports them. Once the call ends — or for a WebRTC call,
   * where the browser never sees tool traffic — the finished call is fetched once
   * from history, which is also where a call that ended before the page loaded
   * comes from.
   */
  private async syncOutputs(): Promise<void> {
    const running = this.liveCall();
    if (running) {
      this.lastCall.set(running);
      this.outputsCallId.set(running.call_id);
      const found = this.extractOutputs(running.events);
      if (found) this.outputs.set(found);
      return;
    }

    // Only once the call is actually over. Fetching mid-call would find no tool
    // call yet, and a single-shot guard would then never look again.
    if (this.live()) return;
    const finishedId = this.isPhoneCall() ? this.outputsCallId() : this.audio.streamSid();
    if (!finishedId || this.outputs()) return;

    // The call is flushed to Mongo asynchronously at hangup, so the first read can
    // land before the write. Retry a few ticks, then stop rather than poll forever
    // against a call that genuinely reported nothing.
    if (this.fetchedOutputsFor !== finishedId) {
      this.fetchedOutputsFor = finishedId;
      this.outputTries = 0;
    }
    if (this.outputTries >= 5) return;
    this.outputTries += 1;
    try {
      const doc = await this.api.call(finishedId);
      // Also the authoritative end-of-call transcript: turns spoken after the last
      // poll are in here but were never seen live.
      if (doc?.events) this.lastCall.set(doc);
      const found = this.extractOutputs(doc.events);
      if (found) this.outputs.set(found);
    } catch {
      // Not in history yet — the next tick tries again.
    }
  }

  /** True while a call is running on either transport. */
  live(): boolean { return this.isPhoneCall() ? Boolean(this.liveCall()) : this.audio.isLive(); }

  elapsedSec(): number {
    if (!this.isPhoneCall()) return this.audio.elapsed();
    const started = this.liveCall()?.started_at;
    return started ? Math.max(0, (Date.now() - new Date(started).getTime()) / 1000) : 0;
  }

  statusText(): string {
    if (!this.isPhoneCall()) return this.audio.status();
    if (this.liveCall()) return 'Live';
    if (this.dialing()) return 'Dialling…';
    // Says the transcript below belongs to a call that is over, rather than
    // leaving "Idle" above a full conversation.
    return this.lastCall() ? 'Ended' : 'Idle';
  }

  /** The call whose transcript is on screen: the running one, else the last one. */
  private shownCall(): any { return this.liveCall() || this.lastCall(); }

  /** Transcript from the browser socket (WebRTC) or the server buffer (phone). */
  turns(): TranscriptEntry[] {
    if (!this.isPhoneCall()) return this.audio.turns();
    return (this.shownCall()?.events || [])
      .filter((e: any) => e.kind === 'USER_TURN' || e.kind === 'AGENT_TURN')
      .map((e: any) => ({ role: e.kind === 'USER_TURN' ? 'user' : 'agent', text: e.text || '' }));
  }

  events(): SessionEvent[] {
    if (!this.isPhoneCall()) return this.audio.events();
    // Newest first, matching how AudioService builds its own list.
    return (this.shownCall()?.events || [])
      .filter((e: any) => e.kind !== 'USER_TURN' && e.kind !== 'AGENT_TURN')
      .slice(-40)
      .reverse()
      .map((e: any) => ({
        time: e.ts ? new Date(e.ts).toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5) : '--:--',
        name: (e.kind || 'event').toLowerCase().replace(/_/g, ' '),
        detail: e.tool || e.text || e.detail || (e.total_tokens ? `${e.total_tokens} tokens` : ''),
        tone: e.kind === 'TOOL_CALL' ? 'ok' : e.kind === 'ERROR' ? 'bad' : 'info',
      }));
  }

  isPhoneCall(): boolean { return this.channelKey !== 'webrtc'; }
  e164Phone(): string { return toE164(this.phoneRaw); }
  channelReady(): boolean { return this.channelKey === 'webrtc' || this.telephony()[`${this.channelKey}_configured`] === true; }
  agent(): string { return this.agentKey; }
  /** The agent's own Ozonetel route; without it an outbound call has nowhere to go. */
  oznCampaign(): string { return this.currentAgent()?.ozonetel_campaign || ''; }
  currentAgent(): any { return this.agents().find((a: any) => a.key === this.agentKey); }
  currentProviders(): any[] { return this.currentAgent()?.providers || []; }
  currentProvider(): any { return this.currentProviders().find((p: any) => p.key === this.provider()); }
  defaultVoice(): string { return this.currentProvider()?.default_voice || ''; }
  voices(): any[] { return (this.currentProvider()?.voices || []).map((v: any) => typeof v === 'string' ? { name: v, gender: '' } : v); }
  canDial(): boolean { return this.channelKey !== 'ozonetel' || Boolean(this.oznCampaign()); }
  /**
   * The model this call runs on. Not a console choice: an agent's prompt is written
   * and tuned per provider, so the console takes what the agent supports rather than
   * risking a prompt running on a model it was never written for.
   *
   * Gemini Live is the default wherever the agent supports it — it is what these
   * prompts are written against; the agent's first provider is only the fallback.
   */
  provider(): string {
    const supported = this.currentProviders().map((p: any) => p.key);
    return supported.includes('gemini') ? 'gemini' : supported[0] || '';
  }

  /** Declared inputs of the selected agent — one form field each. */
  inputVars(): any[] { return this.currentAgent()?.input_variables || []; }

  /**
   * Reported outputs as rows, in the agent's declared order.
   *
   * Declared-but-unreported variables are shown as "—" rather than omitted: a
   * missing answer is a result too, and a list that silently shrinks hides it.
   * Anything reported but undeclared is appended, so a prompt/schema mismatch is
   * visible here instead of being quietly dropped at the storage layer.
   */
  outputRows(): { label: string; value: string; missing: boolean }[] {
    const reported = this.outputs();
    if (!reported) return [];
    const declared = this.currentAgent()?.output_variables || [];
    const seen = new Set<string>();
    const fmt = (v: any) =>
      v === null || v === undefined || v === '' ? '' : Array.isArray(v) ? v.join(', ') : String(v);

    const rows = declared.map((v: any) => {
      seen.add(v.key);
      const value = fmt(reported[v.key]);
      return { label: v.label || v.key, value: value || '—', missing: !value };
    });
    for (const [key, value] of Object.entries(reported)) {
      if (!seen.has(key)) rows.push({ label: key, value: fmt(value) || '—', missing: false });
    }
    return rows;
  }

  /** Non-empty values only: a blank field must not mask the agent's own sample. */
  callContext(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of this.inputVars()) {
      const value = (this.inputValues[v.key] || '').trim();
      if (value) out[v.key] = value;
    }
    return out;
  }

  missingRequired(): string[] {
    return this.inputVars()
      .filter((v: any) => v.required !== false && !(this.inputValues[v.key] || '').trim())
      .map((v: any) => v.key);
  }

  fillSamples(): void {
    for (const v of this.inputVars()) if (v.sample) this.inputValues[v.key] = v.sample;
  }
  clearInputs(): void { this.inputValues = {}; }

  onChannelChange(): void { this.error.set(''); this.dialed.set(null); }

  /**
   * A different agent declares different inputs, and voices are provider-specific.
   * Carrying any of it over would send one agent's data under another agent's keys.
   */
  onAgentChange(): void {
    this.error.set(''); this.dialed.set(null);
    this.inputValues = {};
    this.voiceKey = '';
    this.resetOutputs();
  }

  async dial(): Promise<void> {
    const to = toE164(this.phoneRaw);
    if (!isValidE164(to)) { this.error.set(`"${this.phoneRaw}" isn't a valid phone number.`); return; }
    this.error.set(''); this.dialed.set(null); this.dialing.set(true);
    this.resetOutputs();
    try {
      const body: any = { to, agent: this.agent(), provider: this.provider() };
      if (this.voiceKey) body.voice = this.voiceKey;
      if (this.oznCampaign()) body.ozonetel_campaign = this.oznCampaign();
      const ctx = this.callContext();
      if (Object.keys(ctx).length) body.context = ctx;
      if (this.modelKey) body.model_override = this.modelKey;
      body.use_silero_vad = this.useSilero;
      this.applyEngine(body);
      const out = await this.api.startCall(this.channelKey, body);
      this.dialed.set({ to, ref: out.custom_sid || out.call_sid || '—' });
    } catch (e: any) { this.error.set(`Could not place the call: ${e.message}`); }
    finally { this.dialing.set(false); }
  }

  async start(): Promise<void> {
    this.error.set('');
    this.resetOutputs();
    try {
      await this.audio.start(this.api.streamUrl({
        agent: this.agent(),
        provider: this.provider(),
        voice: this.override() && this.engine().voice ? this.engine().voice : this.voiceKey,
        context: this.callContext(),
        model: this.override() && this.engine().mode === 's2s' ? this.engine().s2s : this.modelKey || undefined,
        silero: this.override() ? this.engine().turn.interruption !== 'off' : this.useSilero,
      }));
    } catch (e: any) {
      this.error.set((e as DOMException).name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser and try again.'
        : `Could not start the call: ${e.message}`);
      this.audio.stop(false);
    }
  }

  /** Clear the previous call's result so it can't be read as this call's. */
  private resetOutputs(): void {
    this.lastCall.set(null);
    this.outputs.set(null);
    this.outputsCallId.set(null);
    this.fetchedOutputsFor = null;
    this.outputTries = 0;
  }

  hangUp(): void { this.audio.stop(true); }
}
