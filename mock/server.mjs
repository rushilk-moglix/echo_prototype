// Local stand-in for the two Echo backends, so the live frontend runs unchanged:
//   dataload  on :8090  (API_BASE in environment.ts)
//   backend   on :8080  (WEBRTC_BASE: /webrtc/*, /api/live, webrtc start_call)
// One process serves both ports from the same in-memory state, built from the
// synthetic scenario.json. Dates are shifted so the sample reads as "today".
// It copies live behaviour on purpose, including the gaps found in Phase 0:
// rows that never connect stay "dialled", so their campaign stays "running".
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID, randomInt } from 'node:crypto';
import { writeXlsx, readXlsx, zip } from './xlsx.mjs';
import { PI_ORG, PI_ROUTE, PI_USERS, piAgent, piCampaign } from './pi-seed.mjs';
import { simulate, record, reOutcome, planAttempts, rowTiming, RETRY } from './ozonetel.mjs';
import { INTEGRATION_CATALOG } from './integrations.mjs';
import { OUTCOMES, DEFAULT_RETRY, retryAgain, contactOutcome, setNoReplyUnder } from './outcome.mjs';

const DATALOAD_PORT = Number(process.env.ECHO_API_PORT || 8090);
const BACKEND_PORT = Number(process.env.ECHO_WEBRTC_PORT || 8080);
const CLARIX_URL = process.env.CLARIX_URL || 'http://localhost:8081';

// ── Scenario, shifted to now ─────────────────────────────────────────────────
const raw = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
// Whole days only, so the Echo and Clarix mocks agree whenever each was started.
const SHIFT = Math.floor((Date.now() - Date.parse(raw.anchor)) / 86400000) * 86400000;
const DAY_SHIFT = Math.round(SHIFT / 86400000);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
function shift(v) {
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
  if (typeof v === 'string' && ISO.test(v)) return new Date(Date.parse(v) + SHIFT).toISOString();
  if (typeof v === 'string' && DAY_SHIFT && DMY.test(v)) {
    const [, d, m, y] = v.match(DMY);
    return dmy(new Date(Date.UTC(+y, +m - 1, +d) + DAY_SHIFT * 86400000));
  }
  return v;
}
const S = shift(raw);
// target: behave like the fixed backend in PRD-ECHO-11 (every row gets a final status).
// live: reproduce today's live gaps (unanswered rows stay "dialled" for ever).
const MODE = process.env.MOCK_BEHAVIOUR === 'live' ? 'live' : 'target';
if (MODE === 'target') {
  const callsById = Object.fromEntries(S.calls.map((c) => [c.call_id, c]));
  for (const c of S.campaigns) for (const r of c.contacts) {
    const f = r.final; if (!f) continue;
    // Every dial gets the Ozonetel callback it would really have produced, mapped by Echo's rules.
    r.attempts_detail = planAttempts({ seed: `${c.campaign_id}:${r.primary_id}`, final: f, dispatchedAt: r.dispatched_at || c.created_at });
    const call = r.call_id && callsById[r.call_id];
    const last = r.attempts_detail[r.attempts_detail.length - 1];
    if (call && last?.stream) alignToCall(last, call);
    const m = last?.mapped;
    const status = f.status === 'completed' ? 'completed' : f.status;
    Object.assign(r, { status, call_result: f.status === 'completed' ? (m?.result || f.result || 'conversation') : null,
      reason: f.status === 'completed' ? (m?.reason || null) : (f.status === 'retry_exhausted' || f.status === 'retry_scheduled' ? m?.reason || f.reason : m?.reason || f.reason || null),
      attempts: r.attempts_detail.length || (f.attempts ?? 0) });
    if (f.status === 'retry_exhausted' && m) Object.assign(r, { last_attempt_status: m.status, last_attempt_reason: m.reason });
    if (f.status === 'retry_scheduled') r.next_attempt_at = new Date(Date.now() + f.next_attempt_in_min * 60000).toISOString();
  }
}
// Talk time for a connected attempt comes from Echo's own stream, i.e. the call record.
function alignToCall(att, call) {
  const talk = Math.round(call.duration_seconds || att.talk_seconds);
  const hms = (x) => [Math.floor(x / 3600), Math.floor((x % 3600) / 60), x % 60].map((v) => String(v).padStart(2, '0')).join(':');
  att.talk_seconds = talk;
  att.stream.caller_turns = (call.events || []).filter((e) => e.kind === 'USER_TURN').length;
  att.stream.agent_turns = (call.events || []).filter((e) => e.kind === 'AGENT_TURN').length;
  Object.assign(att.provider, { TalkTime: hms(talk), CallDuration: hms(talk), Duration: hms(talk + att.ring_seconds) });
  att.call_id = call.call_id;
  att.stream.agent_finished = (call.events || []).some((e) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
  reOutcome(att);
}

const agents = S.agents;
// Workspaces: Moglix (existing data) and the PI Industries pilot (ECHO-206: PI buyers sign in to their own workspace).
for (const x of [...S.agents, ...S.campaigns, ...S.calls]) x.org_id ||= 'org_moglix';
{
  const pi = piCampaign(new Date().toISOString(), randomUUID().slice(0, 8));
  S.agents.push(piAgent(new Date(Date.now() - 2 * 86400000).toISOString()));
  S.campaigns.push(pi.campaign); S.calls.push(...pi.calls);
}
// Target backend fields: who changed an agent last and when it last reached Clarix.
for (const a of agents) {
  agentDefaults(a);
  a.updated_at ||= a.created_at;
  a.updated_by ||= S.operators[0];
  if (a.sync_status === 'synced') a.synced_at ||= a.updated_at;
}
const campaigns = S.campaigns;
const calls = S.calls;
const analyses = {};
let liveCall = null;

const ORG = { org_id: 'org_moglix', org_name: 'Moglix', role: 'org_admin' };
const ORGS = [ORG, PI_ORG];
const users = [
  { user_id: 'u_admin', email: 'admin@example.com', role: 'org_admin', agent_admin: true, platform_admin: true, org_id: '*' },
  ...S.operators.map((email, i) => ({ user_id: `u_op${i + 1}`, email, role: i < 2 ? 'campaign_manager' : 'user', agent_admin: false, platform_admin: false, org_id: 'org_moglix' })),
  ...PI_USERS,
];
const groups = [
  { group_id: 'g_proc', org_id: ORG.org_id, name: 'Procurement ops', created_by: 'u_admin', member_ids: ['u_op1', 'u_op2', 'u_op3'] },
  { group_id: 'g_rfx', org_id: ORG.org_id, name: 'RFX desk', created_by: 'u_admin', member_ids: ['u_op4'] },
];
let signedInEmail = 'admin@example.com';

// ── Agent settings added by PRD-ECHO-19 ──────────────────────────────────────
// input_plan: how rows of a file become calls. retry: tries, gap and which outcomes to retry.
// sync_target: where results go. references, lookups: data the agent can use.
function agentDefaults(a) {
  a.input_plan ||= { mode: 'row', group_by: '', call_columns: [], row_columns: [], order_by: '', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: '' };
  a.retry ||= structuredClone(DEFAULT_RETRY);
  a.sync_target ||= a.synced_platform ? { type: a.synced_platform, url: '' } : { type: 'none', url: '' };
  a.references ||= [];
  a.lookups ||= [];
  if (!a.engine || !String(a.engine.s2s || a.engine.stt || '').includes('-')) a.engine = { preset: 'balanced', mode: 'pipeline', stt: 'saaras-v4', stt_fallback: 'scribe-v2-realtime', llm: 'claude-haiku-4.5', fallback: 'gpt-6-luna', tts: 'bulbul-v3', tts_fallback: 'sonic-3.6', realtime_alt: 'gemini-3.8-live', turn_detector: 'livekit', voice: 'anushka (female)' };
  return a;
}
const planOf = (a) => ({ mode: 'row', max_rows: 8, overflow: 'split', order_dir: 'asc', call_columns: [], row_columns: [], ...(a?.input_plan || {}) });

// ── Reference data ───────────────────────────────────────────────────────────
const PROVIDERS = [{ key: 'gemini', label: 'Gemini' }, { key: 'grok', label: 'Grok' }];
const VOICES = {
  gemini: [['Kore', 'female'], ['Aoede', 'female'], ['Leda', 'female'], ['Zephyr', 'female'], ['Puck', 'male'], ['Charon', 'male'], ['Fenrir', 'male'], ['Orus', 'male']],
  grok: [['Ara', 'female'], ['Eve', 'female'], ['Leo', 'male'], ['Rex', 'male'], ['Sal', 'neutral']],
};
// Telephony routes belong to a workspace (ECHO-217): an agent can only use its own workspace's lines.
const OZN_CAMPAIGNS = [
  { name: 'PAAS_postpo', type: 'IVR', did: '08000000101', org_id: 'org_moglix' },
  { name: 'RFX_reminder', type: 'IVR', did: '08000000102', org_id: 'org_moglix' },
  { name: 'PAAS_followup', type: 'Progressive', did: '08000000103', org_id: 'org_moglix' },
  PI_ROUTE,
];
const PLACEHOLDERS = [
  { token: '{{current_date}}', name: 'current_date', label: 'Today', description: 'Date of the call, filled in when the call starts' },
  { token: '{{current_time}}', name: 'current_time', label: 'Time now', description: 'Local time when the call starts' },
  { token: '{{current_day}}', name: 'current_day', label: 'Weekday', description: 'Day of the week when the call starts' },
];

// Models Echo can run (speech to speech, or listen, think, speak), each with its own voices.
const ENGINES = {
  // Four presets from the voice preset sheet (Echo-Technical-Analysis, Voice_Presets). Each stage has a
  // primary and a fallback; metrics are the verified figures only (checked 1 Oct 2026), estimates say so.
  presets: [
    { key: 'balanced', label: 'Balanced', sub: 'Default for new agents', meta: 'Best accuracy and a natural Indian voice at a sensible cost',
      engine: { mode: 'pipeline', stt: 'saaras-v4', stt_fallback: 'scribe-v2-realtime', llm: 'claude-haiku-4.5', fallback: 'gpt-6-luna', tts: 'bulbul-v3', tts_fallback: 'sonic-3.6', realtime_alt: 'gemini-3.8-live', turn_detector: 'livekit' },
      metrics: { latency: '1.0 to 1.2 s (estimate)', humanness: 'Bulbul v3 ranked first in a blind telephony test across 11 Indian languages', accuracy: 'Saaras V4: lowest average WER on 7 English benchmarks; Indic tested on Vistaar', cost: '$0.032 per call min (Rs 2.77)' } },
    { key: 'intelligence', label: 'High intelligence', sub: 'Hard conversations', meta: 'Disputes, negotiation, many orders or lines on one call',
      engine: { mode: 'pipeline', stt: 'saaras-v4', stt_fallback: 'amazon-transcribe', llm: 'claude-sonnet-5', fallback: 'gpt-6-sol', tts: 'sonic-3.6', tts_fallback: 'eleven-v3-conversational', realtime_alt: 'gemini-3.8-live-thinking', turn_detector: 'livekit' },
      metrics: { latency: '1.4 to 1.8 s (estimate); use a short acknowledgement', humanness: 'Sonic 3.5 Elo 1203, ElevenLabs v3 Elo 1177 (Artificial Analysis Speech Arena)', accuracy: 'Saaras V4 as Balanced', cost: '$0.045 per call min (Rs 3.99)' } },
    { key: 'fast', label: 'Ultra fast', sub: 'Lowest delay', meta: 'Feels like a person on the line',
      engine: { mode: 'pipeline', stt: 'scribe-v2-realtime', stt_fallback: 'flux-multilingual', llm: 'gpt-oss-120b-groq', fallback: 'mercury-voice', tts: 'falcon-2', tts_fallback: 'eleven-flash-v2.5', realtime_alt: 'grok-voice-think-fast-2', turn_detector: 'krisp-v3' },
      metrics: { latency: 'Falcon 130 ms to first audio; Mercury Voice about 170 ms; 0.6 to 0.8 s end to end (estimate)', humanness: 'No independent score for Falcon yet', accuracy: 'Flux Multilingual for Hindi and English; Indic WER not independently tested', cost: '$0.013 per call min (Rs 1.17)' } },
    { key: 'saver', label: 'Cost saver', sub: 'High volume, simple calls', meta: 'Reminders, notifications, surveys',
      engine: { mode: 'pipeline', stt: 'soniox-stt-rt-v5', stt_fallback: 'saaras-v4', llm: 'gpt-6-luna', fallback: 'gpt-5.6-luna', tts: 'falcon-2', tts_fallback: 'gemini-3.8-flash-lite-tts', realtime_alt: '', turn_detector: 'off' },
      metrics: { latency: '1.0 to 1.3 s (estimate)', humanness: 'Falcon as Ultra fast', accuracy: 'Soniox Indic accuracy not independently tested; A/B 500 calls first', cost: '$0.008 per call min (Rs 0.73)' } },
    { key: 'custom', label: 'Custom', sub: 'Pick each model', meta: 'For teams comparing models', engine: {} },
  ],
  turn_detectors: [
    { id: 'livekit', label: 'LiveKit turn detector', note: 'Open source, supports Hindi, about 25 ms per check' },
    { id: 'krisp-v3', label: 'Krisp Turn v3', note: 'Multilingual, from audio alone; under 200 ms for most turns' },
    { id: 'off', label: 'Off: use the model', note: "Relies on the voice model's own end of turn detection" },
  ],
  s2s: [
    { id: 'gemini-live-2.5-flash', label: 'Gemini 2.5 Flash Live (native audio)', vendor: 'Google', voices: ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'] },
    { id: 'gpt-realtime', label: 'GPT Realtime', vendor: 'OpenAI', voices: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'sage', 'shimmer', 'verse'] },
    { id: 'grok-voice', label: 'Grok Voice', vendor: 'xAI', voices: ['Ara', 'Eve', 'Leo', 'Rex', 'Sal'] },
    { id: 'gpt-realtime-mini', label: 'GPT Realtime mini', vendor: 'OpenAI', voices: ['marin', 'cedar', 'alloy', 'coral', 'sage'] },
    { id: 'nova-sonic', label: 'Nova Sonic', vendor: 'Amazon', voices: ['tiffany', 'matthew', 'amy'] },
    { id: 'ultravox-v0.5', label: 'Ultravox 0.5', vendor: 'Fixie', voices: ['Model default'] },
    { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live', vendor: 'Google', voices: ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon'] },
    { id: 'gemini-3.8-live-thinking', label: 'Gemini 3.8 Live, extended thinking', vendor: 'Google', voices: ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon'] },
    { id: 'grok-voice-think-fast-2', label: 'Grok Voice Think Fast 2.0', vendor: 'xAI', voices: ['Ara', 'Eve', 'Leo', 'Rex', 'Sal'] },
  ],
  stt: [
    { id: 'saarika-v2.5', label: 'Saarika v2.5', vendor: 'Sarvam' },
    { id: 'nova-3', label: 'Nova-3', vendor: 'Deepgram' },
    { id: 'chirp-3', label: 'Chirp 3', vendor: 'Google' },
    { id: 'scribe-v1', label: 'Scribe v1', vendor: 'ElevenLabs' },
    { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', vendor: 'OpenAI' },
    { id: 'nova-2', label: 'Nova-2', vendor: 'Deepgram' },
    { id: 'universal-streaming', label: 'Universal Streaming', vendor: 'AssemblyAI' },
    { id: 'azure-stt', label: 'Speech to Text', vendor: 'Microsoft Azure' },
    { id: 'gladia-solaria', label: 'Solaria', vendor: 'Gladia' },
    { id: 'saaras-v4', label: 'Saaras V4 (key terms on)', vendor: 'Sarvam' },
    { id: 'scribe-v2-realtime', label: 'Scribe v2 Realtime', vendor: 'ElevenLabs' },
    { id: 'soniox-stt-rt-v5', label: 'stt-rt-v5', vendor: 'Soniox' },
    { id: 'flux-multilingual', label: 'Flux Multilingual', vendor: 'Deepgram' },
    { id: 'amazon-transcribe', label: 'Transcribe', vendor: 'Amazon' },
  ],
  llm: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vendor: 'Google' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', vendor: 'Google' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', vendor: 'OpenAI' },
    { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', vendor: 'Anthropic' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', vendor: 'Anthropic' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', vendor: 'Google' },
    { id: 'gpt-4.1', label: 'GPT-4.1', vendor: 'OpenAI' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', vendor: 'OpenAI' },
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', vendor: 'Groq' },
    { id: 'sarvam-m', label: 'Sarvam-M', vendor: 'Sarvam' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (low effort)', vendor: 'Anthropic' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna (no reasoning)', vendor: 'OpenAI' },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol (low effort)', vendor: 'OpenAI' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', vendor: 'OpenAI' },
    { id: 'gpt-oss-120b-groq', label: 'gpt-oss-120b', vendor: 'Groq' },
    { id: 'mercury-voice', label: 'Mercury Voice (preview)', vendor: 'Inception' },
  ],
  tts: [
    { id: 'bulbul-v2', label: 'Bulbul v2', vendor: 'Sarvam', voices: ['anushka', 'manisha', 'vidya', 'arya', 'abhilash', 'karun', 'hitesh'] },
    { id: 'eleven-flash-v2.5', label: 'Flash v2.5', vendor: 'ElevenLabs', voices: ['Voice from your ElevenLabs library'] },
    { id: 'sonic-2', label: 'Sonic 2', vendor: 'Cartesia', voices: ['Voice from your Cartesia library'] },
    { id: 'chirp-3-hd', label: 'Chirp 3 HD', vendor: 'Google', voices: ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'] },
    { id: 'eleven-turbo-v2.5', label: 'Turbo v2.5', vendor: 'ElevenLabs', voices: ['Voice from your ElevenLabs library'] },
    { id: 'aura-2', label: 'Aura-2', vendor: 'Deepgram', voices: ['thalia', 'andromeda', 'helena', 'apollo', 'arcas'] },
    { id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS', vendor: 'OpenAI', voices: ['marin', 'cedar', 'alloy', 'coral', 'sage'] },
    { id: 'azure-neural', label: 'Neural voices', vendor: 'Microsoft Azure', voices: ['en-IN-NeerjaNeural', 'en-IN-PrabhatNeural', 'hi-IN-SwaraNeural'] },
    { id: 'bulbul-v3', label: 'Bulbul v3', vendor: 'Sarvam', voices: ['anushka (female)', 'manisha (female)', 'vidya (female)', 'arya (female)', 'abhilash (male)', 'karun (male)', 'hitesh (male)'] },
    { id: 'sonic-3.6', label: 'Sonic 3.6', vendor: 'Cartesia', voices: ['Voice from your Cartesia library'] },
    { id: 'falcon-2', label: 'Falcon 2', vendor: 'Murf', voices: ['Voice from your Murf library'] },
    { id: 'eleven-v3-conversational', label: 'v3 Conversational', vendor: 'ElevenLabs', voices: ['Voice from your ElevenLabs library'] },
    { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS', vendor: 'Google', voices: ['Kore', 'Aoede', 'Leda'] },
  ],
};

// ── Workspace settings (Settings page) ───────────────────────────────────────
const orgSettings = {};
function settingsOf(org) {
  return (orgSettings[org] ||= {
    workspace: { timezone: 'Asia/Kolkata', language: 'en-IN', calling_hours: { from: '09:30', to: '19:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] }, max_parallel_calls: 10 },
    telephony: { record_calls: true, dnd_check: true, no_reply_under_seconds: 5 },
    calling_defaults: { tries: 3, gap_minutes: 60, on: ['no_answer', 'busy', 'unreachable', 'network_error', 'call_dropped', 'no_reply', 'voicemail', 'caller_hung_up'] },
    data: { recordings_days: 90, transcripts_days: 365, results_days: 180, reference_days: 7, mask_numbers_for_users: false },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const orgOf = (q) => q?.get?.('org_id') || 'org_moglix';
const inOrg = (q) => (x) => (x.org_id || 'org_moglix') === orgOf(q);
const me = () => users.find((u) => u.email === signedInEmail);
function memberships() {
  const u = me();
  if (!u || u.org_id === '*') return ORGS;
  return ORGS.filter((o) => o.org_id === u.org_id).map((o) => ({ ...o, role: u.role }));
}
const agentByKey = (k) => agents.find((a) => a.key === k);
const campaignById = (id) => campaigns.find((c) => c.campaign_id === id);
const callById = (id) => calls.find((c) => c.call_id === id) || (liveCall?.call_id === id ? liveCall : null);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const HAS_CALL = new Set(['captured', 'disconnected_early', 'no_outputs', 'completed']);
const hasOutputs = (x) => x.outputs && Object.keys(x.outputs).length > 0;
const NOT_REACHED = new Set(['no_answer', 'busy', 'rejected', 'unreachable', 'retry_exhausted', 'retry_scheduled']);
const ATTEMPTED = new Set(['dialled', 'calling', 'in_progress', 'failed', 'blocked', 'invalid_number', ...HAS_CALL, ...NOT_REACHED]);
const OPEN = new Set(['pending', 'queued', 'dialled', 'calling', 'in_progress', 'retry_scheduled']);

function campaignStatus(c) {
  // Campaign-level failure (system or setup), never because individual calls failed.
  if (c.failed) return 'failed';
  if (!c.contacts.length) return 'ready';
  if (c.contacts.every((x) => x.status === 'input_validation_failed' || x.reason === 'data_validation_failed')) return 'failed';
  if (c.stopped && !c.contacts.some((x) => x.attempts || HAS_CALL.has(x.status))) return 'cancelled';
  if (c.contacts.some((x) => OPEN.has(x.status))) return c.paused ? 'paused' : 'running';
  if (c.contacts.some((x) => x.status === 'cancelled')) return 'partially_completed';
  return 'completed';
}
/** First dial to last dial end: how long the campaign took to place every call. */
function runTime(c) {
  const at = c.contacts.flatMap((x) => x.attempts_detail || []);
  if (!at.length) return { first_dial_at: null, last_call_end_at: null, run_seconds: null };
  const first = Math.min(...at.map((a) => Date.parse(a.started_at)));
  const last = Math.max(...at.map((a) => Date.parse(a.ended_at || a.started_at)));
  return { first_dial_at: new Date(first).toISOString(), last_call_end_at: new Date(last).toISOString(), run_seconds: Math.round((last - first) / 1000) };
}
function campaignSummary(c) {
  const a = agentByKey(c.agent);
  return {
    campaign_id: c.campaign_id, name: c.name, agent: c.agent, provider: c.provider, source: c.source,
    description: c.description, created_at: c.created_at, status: campaignStatus(c),
    contacts_count: c.contacts.length, file_rows: c.file_rows || c.contacts.reduce((n, x) => n + (x.items?.length || 1), 0),
    by_group: c.contacts.reduce((m, x) => { const k = OUTCOMES[contactOutcome(x)]?.group || 'failed'; m[k] = (m[k] || 0) + 1; return m; }, {}),
    ...runTime(c),
    responses_count: c.contacts.filter((x) => HAS_CALL.has(x.status)).length,
    dialled_count: c.contacts.filter((x) => ATTEMPTED.has(x.status)).length,
    counts: c.contacts.reduce((m, x) => { const k = x.status === 'captured' || x.status === 'disconnected_early' || x.status === 'completed' ? `completed:${x.call_result || (x.status === 'captured' ? 'conversation' : 'disconnected_early')}` : x.status; m[k] = (m[k] || 0) + 1; return m; }, {}),
    schema: { label: a?.label || c.agent },
  };
}
function callRow(c) {
  return {
    call_id: c.call_id, started_at: c.started_at, contact_name: c.contact_name,
    contact_name_matched_by: c.campaign_id ? 'campaign' : '', phone: c.phone, agent: c.agent,
    duration_seconds: c.duration_seconds, status: c.status, num_turns: c.num_turns,
    campaign_name: c.campaign_name || '', summary: c.summary, total_tokens: c.total_tokens, call_result: c.call_result || null,
  };
}
function filterCalls(q) {
  let list = [...calls, ...(liveCall ? [liveCall] : [])].filter(inOrg(q));
  if (q.get('hours')) { const t = Date.now() - Number(q.get('hours')) * 3600000; list = list.filter((c) => Date.parse(c.started_at) >= t); }
  if (q.get('campaign_id')) list = list.filter((c) => c.campaign_id === q.get('campaign_id'));
  if (q.get('min_duration')) list = list.filter((c) => (c.duration_seconds || 0) >= Number(q.get('min_duration')));
  if (q.get('max_duration')) list = list.filter((c) => (c.duration_seconds || 0) <= Number(q.get('max_duration')));
  const term = (q.get('q') || '').trim().toLowerCase();
  if (term) list = list.filter((c) => [c.contact_name, c.phone, c.campaign_name, c.call_id, c.agent, c.summary].some((v) => String(v || '').toLowerCase().includes(term)));
  return list.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}
const outputsOf = (call) => {
  const t = [...(call?.events || [])].reverse().find((e) => e.kind === 'TOOL_CALL' && e.tool === 'submit_call_outputs');
  return t?.args || null;
};
const summarise = (outputs, turns, userTurns) => {
  if (outputs && Object.keys(outputs).length) return Object.entries(outputs).map(([k, v]) => `${k}: ${v}`).join(' · ');
  if (!userTurns) return `Agent spoke, caller never did (${turns} turn${turns === 1 ? '' : 's'})`;
  return `Ended without a reported outcome (${turns} turns)`;
};

function metrics(days, org = 'org_moglix') {
  const from = Date.now() - days * 86400000;
  const inWindow = campaigns.filter((c) => (c.org_id || 'org_moglix') === org && Date.parse(c.created_at) >= from);
  const rows = inWindow.flatMap((c) => c.contacts.map((x) => ({ ...x, agent: c.agent })));
  const gatedRow = (r) => r.status === 'input_validation_failed' || r.reason === 'data_validation_failed' || r.reason === 'duplicate_row' || !agentByKey(r.agent)?.ozonetel_campaign;
  const gated = rows.filter(gatedRow).length;
  const dialled = rows.filter((r) => !gatedRow(r) && (r.attempts_detail?.length || ATTEMPTED.has(r.status)));
  const attempts = dialled.flatMap((r) => r.attempts_detail || []);
  const answeredAttempt = (a) => a.stream?.connected || a.mapped?.result === 'technical_drop';
  const reached = dialled.filter((r) => (r.attempts_detail || []).some(answeredAttempt) || HAS_CALL.has(r.status)).length;
  const completed = rows.filter((r) => r.status === 'completed' || r.status === 'captured' || r.status === 'disconnected_early');
  const conversation = completed.filter((r) => (r.call_result || (r.status === 'captured' ? 'conversation' : '')) === 'conversation');
  const achieved = conversation.filter(hasOutputs).length;
  const open = rows.filter((r) => OPEN.has(r.status)).length;
  const callbacks = rows.filter((r) => hasOutputs(r) && (r.outputs?.callback_time || r.outputs?.callback_date)).length;
  const talk = attempts.reduce((n, a) => n + (answeredAttempt(a) ? a.talk_seconds || 0 : 0), 0);
  const byStatus = rows.reduce((m, r) => { const k = r.status === 'captured' || r.status === 'disconnected_early' ? 'completed' : r.status; m[k] = (m[k] || 0) + 1; return m; }, {});
  const byResult = completed.reduce((m, r) => { const k = r.call_result || 'conversation'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const cs = calls.filter((c) => (c.org_id || 'org_moglix') === org && Date.parse(c.started_at) >= from);
  const sum = (f) => cs.reduce((n, c) => n + (Number(f(c)) || 0), 0);
  const rate = (a, b) => (b ? a / b : 0);
  return {
    funnel: {
      planned: rows.length, campaigns: inWindow.length, will_dial: rows.length - gated, gated,
      attempted: dialled.length, connected: reached, connected_rate: rate(reached, dialled.length),
      achieved, achieved_rate: rate(achieved, conversation.length),
      inconclusive: conversation.length - achieved, inconclusive_rate: rate(conversation.length - achieved, conversation.length),
      callbacks_open: callbacks, tech_failures: byResult.technical_drop || 0,
      attempts: attempts.length, answer_rate: rate(attempts.filter(answeredAttempt).length, attempts.length),
      attempts_per_call: dialled.length ? Math.round((attempts.length / dialled.length) * 10) / 10 : 0,
      reach_rate: rate(reached, dialled.length), conversation: conversation.length, conversation_rate: rate(conversation.length, dialled.length),
      outcome_rate: rate(achieved, conversation.length), open, talk_seconds: talk, by_status: byStatus, by_result: byResult,
      by_outcome: rows.reduce((m, r) => { const k = contactOutcome(r); m[k] = (m[k] || 0) + 1; return m; }, {}),
      by_group: rows.reduce((m, r) => { const k = OUTCOMES[contactOutcome(r)]?.group || 'failed'; m[k] = (m[k] || 0) + 1; return m; }, {}),
    },
    active_calls: (liveCall ? 1 : 0) + rows.filter((r) => r.status === 'in_progress').length,
    avg_duration_seconds: cs.length ? Math.round((sum((c) => c.duration_seconds) / cs.length) * 10) / 10 : 0,
    avg_turns_per_call: cs.length ? Math.round((sum((c) => c.num_turns) / cs.length) * 10) / 10 : 0,
    total_tokens: sum((c) => c.total_tokens), total_turns: sum((c) => c.num_turns), total_calls: cs.length,
    storage_connected: true,
  };
}

function analyse(call) {
  const o = outputsOf(call) || {};
  const status = String(o.status || '');
  const callback = o.callback_time || o.callback_date;
  const accepted = /accept/i.test(status) || o.po_acceptance_intent === 'ACCEPTED' || o.aligned === true;
  const priority = o.escalate_to || /not received|issue|wrong/i.test(status) ? 'High' : callback ? 'Medium' : 'Low';
  const actions = [];
  if (callback) actions.push(`Call back at ${callback}`);
  if (/not received|copy/i.test(status)) actions.push('Resend the PO copy to the supplier by email');
  if (o.escalate_to) actions.push(`Escalate to ${o.escalate_to}`);
  if (!Object.keys(o).length) actions.push('Retry the call; no outcome was reported');
  return {
    priority, issue_resolved: Object.keys(o).length ? accepted : false,
    executive_summary: call.summary,
    call_purpose: agentByKey(call.agent)?.description || `Outbound call by ${agentByKey(call.agent)?.label || call.agent}`,
    issue_category: status || 'No outcome', suggested_issue: accepted ? '' : status || 'Caller did not engage',
    action_items: actions, analyzed_at: nowIso(),
  };
}

// A few seconds of quiet tone so the audio player has something real to play.
function wav(seconds) {
  const rate = 8000, n = Math.round(rate * Math.min(Math.max(seconds || 6, 3), 600));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, on = Math.floor(t / 1.6) % 2 === 0 ? 1 : 0.15;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (on > 0.5 ? 220 : 180) * t) * 1800 * on * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t))), 44 + i * 2);
  }
  return buf;
}

// ── Agent sync to Clarix (target behaviour: every save pushes) ───────────────
function touch(a) {
  a.updated_at = nowIso();
  a.updated_by = signedInEmail;
  if (a.synced_platform) pushAgent(a);
}
async function pushAgent(a) {
  if (a.synced_platform && a.synced_platform !== 'clarix') {
    // Webhook: nothing to push for the agent itself; results are posted per row. Others are not connected in the mock.
    const t = syncTargets(a.org_id).find((x) => x.platform_key === a.synced_platform);
    return Object.assign(a, t?.connected ? { sync_status: 'synced', sync_last_error: null, synced_at: nowIso() } : { sync_status: 'failed', sync_last_error: `${t?.label || a.synced_platform} is not connected for this workspace` });
  }
  a.sync_status = 'pending';
  const body = {
    id: a.key, name: a.label, description: a.description || '', ozonetel_campaign: a.ozonetel_campaign || '', voice: a.voice || 'Aoede',
    provider: a.providers?.[0] || 'gemini', direction: 'outbound', version: Date.parse(a.updated_at),
    input_fields: a.input_variables.map((v) => ({ key: v.key, type: v.type, required: true, label: v.key, share_on_call: v.share_on_call !== false })),
    // Clarix keeps one row per sheet row, so answers for each row arrive as plain fields next to the call's own answers.
    output_fields: a.output_variables.flatMap((v) => v.type === 'list'
      ? (v.fields || []).filter((f) => f.key !== 'row').map((f) => ({ key: f.key, type: f.type, required: false, label: f.label || f.key, description: f.description, options: f.options }))
      : [{ key: v.key, type: v.type, required: !!v.required, label: v.label, description: v.description, options: v.options }]),
  };
  try {
    const r = await fetch(`${CLARIX_URL}/public/webhooks/exchange/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Clarix answered ${r.status}`);
    Object.assign(a, { sync_status: 'synced', sync_last_error: null, synced_at: nowIso() });
  } catch (e) {
    // Clarix not running: keep the state honest instead of pretending.
    Object.assign(a, { sync_status: 'failed', sync_last_error: `Could not reach Clarix (${e.message})` });
  }
}

// ── Agent views ──────────────────────────────────────────────────────────────
function testerAgent(a) {
  return {
    key: a.key, label: a.label,
    providers: a.providers.map((p) => ({
      key: p, label: PROVIDERS.find((x) => x.key === p)?.label || p,
      default_voice: a.voice || VOICES[p]?.[0]?.[0] || '',
      voices: (VOICES[p] || []).map(([name, gender]) => ({ name, gender })),
    })),
    input_variables: a.input_variables, output_variables: a.output_variables,
    input_columns: a.input_variables.map((v) => v.key), ozonetel_campaign: a.ozonetel_campaign || '',
  };
}
function generated(a) {
  const plan = planOf(a);
  const grouped = plan.mode === 'group';
  const rowCols = grouped ? rowColumns(a) : [];
  const input = ['## Call details', '', ...a.input_variables.filter((v) => v.share_on_call !== false && !rowCols.includes(v.key)).map((v) => `- ${v.key}: {{${v.key}}}`),
    ...(grouped ? ['', '## Rows to cover on this call ({{row_count}})', '', 'Each row is numbered and has: ' + rowCols.join(', ') + '.', '{{rows}}', '',
      `Go through the rows in the order given. Cover at most ${plan.max_rows} rows. When you report, send one entry per row with its row number, including rows you could not cover.`] : [])].join('\n');
  const output = ['## Outcome reporting', '', 'Before you end the call, call submit_call_outputs once with these fields:', '',
    ...a.output_variables.flatMap((v) => v.type === 'list'
      ? [`- ${v.key} (list, one entry per item)${v.required ? ', required' : ''}: ${v.description || v.label || ''}. Each entry has:`,
         ...(v.fields || []).map((f) => `    - ${f.key} (${f.type}${f.options?.length ? `: one of ${f.options.join(' | ')}` : ''})`)]
      : [`- ${v.key} (${v.type}${v.options?.length ? `: one of ${v.options.join(' | ')}` : ''})${v.required ? ', required' : ''}: ${v.description || v.label || ''}`])].join('\n');
  return { input, output, derived: [] };
}
function promptFrom(a, sections) {
  const g = generated(a);
  return sections.filter((s) => s.enabled !== false)
    .map((s) => (s.kind === 'input' || s.kind === 'output') && !(s.body || '').trim() ? g[s.kind] : s.body || '')
    .join('\n\n');
}

// ── Rows and grouping (PRD-ECHO-19 section 4) ────────────────────────────────
const phoneKeyOf = (a) => a?.input_variables.find((v) => v.type === 'phone')?.key;
function rowColumns(a) {
  const plan = planOf(a);
  if (plan.mode !== 'group') return [];
  if (plan.row_columns?.length) return plan.row_columns;
  return a.input_variables.map((v) => v.key).filter((k) => !plan.call_columns.includes(k) && k !== plan.group_by && k !== phoneKeyOf(a));
}
function answerFields(a) {
  const key = planOf(a).answers_key;
  const v = a?.output_variables.find((x) => x.key === key && x.type === 'list') || a?.output_variables.find((x) => x.type === 'list');
  return v ? (v.fields || []).map((f) => f.key) : [];
}
const answersKey = (a) => planOf(a).answers_key || a?.output_variables.find((x) => x.type === 'list')?.key || '';
/** Call level answers only (the per row list removed). */
function callOutputs(a, o) { const k = answersKey(a); return Object.fromEntries(Object.entries(o || {}).filter(([x, v]) => x !== k && !Array.isArray(v))); }
function fileRow(a, ctx, n) {
  const pk = phoneKeyOf(a);
  const phone = String(ctx[pk] || '').replace(/\D/g, '').slice(-10);
  const bad = phone.length !== 10 ? `${pk || 'phone'} "${ctx[pk] || ''}" is not a valid number` : null;
  return { row: n, ctx, phone, bad };
}
const toSortable = (v) => { const s = String(v ?? '').trim(); const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); if (d) return `${d[3]}-${d[2]}-${d[1]}`; return s !== '' && !isNaN(Number(s)) ? Number(s) : s; };
function groupRows(a, rows) {
  const plan = planOf(a);
  if (plan.mode !== 'group') return rows.map((r) => ({ key: r.ctx[a.primary_id_key] || `row-${r.row}`, rows: [r], part: 1, parts: 1, skipped: [] }));
  const by = plan.group_by || phoneKeyOf(a);
  const groups = new Map();
  for (const r of rows) { const k = String(r.ctx[by] ?? '').trim() || `row-${r.row}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const out = [];
  const cap = Math.max(1, Number(plan.max_rows) || 8);
  for (const [k, list] of groups) {
    if (plan.order_by) list.sort((p, q) => { const x = toSortable(p.ctx[plan.order_by]), y = toSortable(q.ctx[plan.order_by]); return (x < y ? -1 : x > y ? 1 : 0) * (plan.order_dir === 'desc' ? -1 : 1); });
    const chunks = plan.overflow === 'cap' ? [list.slice(0, cap)] : Array.from({ length: Math.ceil(list.length / cap) }, (_, i) => list.slice(i * cap, i * cap + cap));
    chunks.forEach((ch, i) => out.push({ key: chunks.length > 1 ? `${k} (${i + 1} of ${chunks.length})` : k, rows: ch, part: i + 1, parts: chunks.length, skipped: plan.overflow === 'cap' && i === 0 ? list.slice(cap) : [] }));
  }
  return out;
}
/** Second and later rows with the same phone (row by row agents): kept, not dialled, shown as Repeated number. */
function markRepeats(a, contacts) {
  if (planOf(a).mode === 'group') return contacts;
  const seen = new Set();
  for (const x of contacts) {
    if (x.status !== 'pending' || !x.phone) continue;
    if (seen.has(x.phone)) Object.assign(x, { status: 'input_validation_failed', reason: 'duplicate_row', validation_error: 'Same phone number as an earlier row' });
    else seen.add(x.phone);
  }
  return contacts;
}
function contactFrom(a, g) {
  const first = g.rows[0];
  const plan = planOf(a);
  const grouped = plan.mode === 'group';
  const rowCols = rowColumns(a);
  const ctx = grouped ? Object.fromEntries(Object.entries(first.ctx).filter(([k]) => !rowCols.includes(k))) : first.ctx;
  const items = grouped ? g.rows.map((r, i) => ({ n: i + 1, row: r.row, ref: r.ref || null, values: Object.fromEntries(rowCols.map((k) => [k, r.ctx[k] ?? ''])) })) : null;
  if (grouped) Object.assign(ctx, { row_count: String(items.length), rows: items.map((it) => `${it.n}. ${rowCols.map((k) => `${k}: ${it.values[k]}`).join(' · ')}`).join('\n') });
  const name = first.name || ctx.contact_name || ctx.supplier_name || ctx.name || `Row ${first.row}`;
  return { primary_id: grouped ? g.key : first.ref || g.key, name, phone: first.phone, context: ctx, row: first.row, items, part: g.part, parts: g.parts,
    not_covered_rows: g.skipped.map((r) => r.row), status: first.bad ? 'input_validation_failed' : 'pending', validation_error: first.bad, outputs: {} };
}
/** Each row of a grouped call with the answer the agent gave for it (matched by row number). */
function rowsOf(a, x) {
  const list = Array.isArray(x.outputs?.[answersKey(a)]) ? x.outputs[answersKey(a)] : [];
  return (x.items || []).map((it) => ({ ...it, answer: list.find((e) => Number(e.row) === it.n) || null }));
}
function templateRows(a) {
  const keys = a.input_variables.map((v) => v.key);
  const sample = a.input_variables.map((v) => v.sample ?? '');
  if (planOf(a).mode !== 'group') return [keys, sample];
  const rowCols = rowColumns(a);
  return [keys, ...[1, 2, 3].map((n) => a.input_variables.map((v) => (rowCols.includes(v.key) ? (n === 1 ? v.sample ?? '' : `${v.sample ?? ''} (${n})`) : v.sample ?? '')))];
}
/** Mock answers for a grouped call: one entry per row, the last rows left uncovered when the call ran long. */
function fakeGroupAnswers(a, x, seed) {
  const key = answersKey(a);
  const v = a.output_variables.find((o) => o.key === key);
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = (arr) => arr[(h = (h * 1103515245 + 12345) >>> 0) % arr.length];
  const covered = Math.max(1, x.items.length - (x.items.length > 3 ? 1 : 0));
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const entries = x.items.map((it) => {
    if (it.n > covered) return { row: it.n, ...Object.fromEntries((v.fields || []).filter((f) => f.type === 'enum' && f.options?.includes('not_covered')).map((f) => [f.key, 'not_covered'])) };
    const e = { row: it.n };
    for (const f of v.fields || []) {
      if (f.key === 'row') continue;
      if (f.type === 'enum') e[f.key] = pick((f.options || []).filter((o) => o !== 'not_covered').slice(0, 4)) || '';
      else if (f.type === 'date') e[f.key] = pick([day(3), day(5), day(9), '']);
      else if (f.type === 'number') e[f.key] = pick([0, Number(it.values.pending_qty || it.values.quantity || 0) || '', '']);
      else e[f.key] = '';
    }
    return e;
  });
  const callOut = Object.fromEntries(a.output_variables.filter((o) => o.type !== 'list' && o.required).map((o) => [o.key, o.type === 'enum' ? (o.options || [])[0] : o.type === 'number' ? covered : '']));
  return { ...callOut, [key]: entries };
}

// ── Dialling simulation ──────────────────────────────────────────────────────
// Mirrors live: about half the rows connect; the rest stay "dialled" because the
// no-answer / busy result never comes back.
function settleRow(camp, row, status, extra = {}) {
  Object.assign(row, { status, call_result: null, next_attempt_at: null, ...extra });
  notifyClarix(camp, row);
}
// What happens on one dial in target mode, weighted like real supplier lists.
function rollKind(roll) {
  if (roll < 0.10) return ['ring_out', null];
  if (roll < 0.15) return ['no_response', null];
  if (roll < 0.18) return ['normal_unspecified', null];
  if (roll < 0.26) return ['busy', null];
  if (roll < 0.30) return ['subscriber_absent', null];
  if (roll < 0.31) return ['no_route', null];
  if (roll < 0.33) return ['congestion', null];
  if (roll < 0.34) return ['invalid_number', null];
  if (roll < 0.36) return ['answered', 'technical_drop'];
  if (roll < 0.38) return ['answered', 'voicemail'];
  if (roll < 0.50) return ['answered', 'no_response'];
  if (roll < 0.62) return ['answered', 'disconnected_early'];
  return ['answered', 'conversation'];
}
let RETRY_DEMO_MS = 20000; // PRD default is 60 minutes; 20 s so a demo sees it move
// Test hook (mock only): exact Ozonetel results queued per phone number, and short timers, so end to end
// checks (mock/e2e-status.mjs) are repeatable. Each entry is [kind, result] as in ozonetel.mjs simulate().
const DIAL_SCRIPT = new Map();
let WAIT_SCALE = 1;
function placeCampaignCall(camp, row) {
  if (row.status === 'cancelled' || camp.stopped || camp.paused) return;
  const roll = Math.random();
  if (MODE === 'live') { if (roll < 0.45) return; return connectCall(camp, row, roll > 0.7 ? 'conversation' : 'no_response', null); }
  const [kind, result] = DIAL_SCRIPT.get(row.phone)?.shift() || rollKind(roll);
  Object.assign(row, { status: 'calling', reason: null, call_result: null, next_attempt_at: null }); notifyClarix(camp, row);
  const n = (row.attempts_detail ||= []).length + 1;
  const sim = simulate({ kind, result, seed: `${camp.campaign_id}:${row.primary_id}:live${n}:${roll}`, startedAt: nowIso(), did: OZN_CAMPAIGNS[0].did });
  const att = record(n, sim);
  row.attempts_detail.push(att);
  row.attempts = n;
  if (kind === 'answered' && att.stream) {
    row.status = 'in_progress'; notifyClarix(camp, row);
    // The callback and the stream end arrive after the talk time; shortened for the demo.
    return setTimeout(() => { connectCall(camp, row, result, att); finishAttempt(camp, row, att); }, Math.min(att.talk_seconds, 12) * 1000 * WAIT_SCALE);
  }
  setTimeout(() => finishAttempt(camp, row, att), Math.min(att.ring_seconds, 8) * 1000 * WAIT_SCALE);
}
function finishAttempt(camp, row, att) {
  if (row.status === 'cancelled') return;
  const m = att.mapped;
  const cfg = agentByKey(camp.agent)?.retry || DEFAULT_RETRY;
  const answerRule = cfg.answer_field && (cfg.answer_values || []).map(String).includes(String(row.outputs?.[cfg.answer_field] ?? ''));
  // PRD-ECHO-11 section 10: never tried again for these reasons, whatever the outcome word says.
  const neverRetry = RETRY.never_reasons.includes(m.reason);
  if (!camp.stopped && !neverRetry && (retryAgain(att.outcome, att.attempt, cfg) || (answerRule && att.attempt < (cfg.tries || 1)))) {
    const next = new Date(Date.now() + RETRY_DEMO_MS).toISOString();
    settleRow(camp, row, 'retry_scheduled', { reason: m.reason || m.result, call_result: m.result || null, next_attempt_at: next });
    return setTimeout(() => placeCampaignCall(camp, row), RETRY_DEMO_MS);
  }
  // PRD-ECHO-11 section 10: every allowed try used and the line never settled it -> Retry Exhausted,
  // keeping what the last try was ("Retry exhausted: no answer 3 times"). Answered calls keep Completed.
  if (!neverRetry && m.status !== 'completed' && retryAgain(att.outcome, 0, cfg) && att.attempt >= (cfg.tries || 1)) {
    return settleRow(camp, row, 'retry_exhausted', { reason: m.reason || null, last_attempt_status: m.status, last_attempt_reason: m.reason || null, call_result: null });
  }
  settleRow(camp, row, m.status, { call_result: m.result || null, reason: m.reason || null, outputs: row.outputs || {}, call_id: row.call_id, recording_call_id: row.recording_call_id, captured_at: row.captured_at });
}
function connectCall(camp, row, result, att) {
  const donor = scriptFor(camp.agent);
  const started = new Date(Date.now() - (att ? att.talk_seconds * 1000 : 0));
  const id = `40715900${randomInt(10000000, 99999999)}`;
  const captured = result === 'conversation' && donor;
  const opening = { kind: 'AGENT_TURN', text: `Namaste, main ${agentByKey(camp.agent)?.label?.split(' ')[0] || 'Echo'} bol rahi hoon. Kya aap mujhe sun pa rahe hain?`, ts: new Date(started.getTime() + 2000).toISOString() };
  const events = captured
    ? donor.events.filter((e) => e.kind !== 'CALL_CONTEXT').map((e, i) => ({ ...e, ts: new Date(started.getTime() + (i + 1) * 4000).toISOString() }))
    : result === 'disconnected_early' ? [opening, { kind: 'USER_TURN', text: 'Haan... abhi baat nahi kar sakta.', ts: new Date(started.getTime() + 6000).toISOString() }]
    : result === 'voicemail' ? [opening, { kind: 'USER_TURN', text: 'The number you have dialled is not available. Please leave a message after the tone.', ts: new Date(started.getTime() + 5000).toISOString() }]
    : result === 'technical_drop' ? [] : [opening];
  let outputs = captured ? outputsOf({ events }) : null;
  const ag = agentByKey(camp.agent);
  if (captured && planOf(ag).mode === 'group' && row.items?.length) outputs = fakeGroupAnswers(ag, row, `${camp.campaign_id}:${row.primary_id}`);
  if (att?.stream) { att.stream.agent_finished = !!outputs; reOutcome(att); }
  const turns = events.filter((e) => e.kind.endsWith('_TURN')).length;
  const dur = att ? att.talk_seconds : captured ? turns * 4 + 3 : 8 + randomInt(10);
  const call = {
    call_id: id, called_number: OZN_CAMPAIGNS[0].did, agent: camp.agent, agent_key: `ozonetel/${camp.agent}/${camp.provider}`,
    campaign_id: camp.campaign_id, contact_name: row.name, phone: row.phone, duration_seconds: dur,
    started_at: started.toISOString(), ended_at: new Date(started.getTime() + dur * 1000).toISOString(),
    mode: 'telephony', num_turns: turns, provider: camp.provider, source: 'campaign', status: 'completed',
    summary: result === 'voicemail' ? 'Voicemail answered; no message left' : summarise(outputs, turns, events.some((e) => e.kind === 'USER_TURN')),
    telephony_provider: 'ozonetel', tools_called: captured ? ['submit_call_outputs'] : [], total_tokens: turns * 13000,
    turn_shape: captured ? 'au' : 'a', variant: 'full', recording_source: 'ozonetel', recording_url: '',
    disconnect_reason: att?.provider?.HangupBy || (captured ? 'agent_end_call' : 'caller_hangup'), campaign_name: camp.name,
    context: { ...row.context, contact_name: row.name, contact_phone: row.phone },
    events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context: row.context }, ...events], outputs, call_result: result,
  };
  if (att) att.call_id = id;
  calls.push(call);
  Object.assign(row, { call_id: id, recording_call_id: id, captured_at: captured ? call.ended_at : null, outputs: outputs || {} });
  if (MODE === 'live') { Object.assign(row, { status: captured ? 'captured' : 'disconnected_early', call_result: captured ? 'conversation' : 'no_response' }); notifyClarix(camp, row, call); }
}
function scriptFor(agentKey) {
  const donor = calls.filter((c) => c.agent === agentKey && outputsOf(c));
  return donor.length ? donor[randomInt(donor.length)] : calls.find((c) => outputsOf(c));
}
// live: only connected calls, two fields. target: every change, with the PRD-ECHO-11 fields.
function notifyClarix(camp, row, call = null) {
  if (camp.source !== 'clarix') return;
  const ag = agentByKey(camp.agent);
  // Grouped call: one update per sheet row, each with the call's outcome and its own answers.
  if (row.items?.length && MODE === 'target') {
    for (const it of rowsOf(ag, row)) notifyOne(camp, row, call, { referenceId: it.ref || `${row.primary_id}:${it.n}`, outputs: { ...callOutputs(ag, row.outputs), ...(it.answer || {}) } });
    return;
  }
  notifyOne(camp, row, call, {});
}
function notifyOne(camp, row, call, over) {
  const connected = row.status === 'captured' || row.status === 'disconnected_early' || row.status === 'completed';
  if (MODE === 'live' && !connected) return;
  const body = MODE === 'live' ? { referenceId: row.primary_id, status: 'COMPLETED' } : {
    referenceId: row.primary_id, version: Date.now(), campaign_status: campaignStatus(camp).toUpperCase(),
    call_status: (connected ? 'completed' : row.status).toUpperCase(), call_result: row.call_result ? row.call_result.toUpperCase() : null,
    call_reason: row.reason ? row.reason.toUpperCase() : null, attempt_number: row.attempts || 1, max_attempts: 3,
    next_attempt_at: row.next_attempt_at || null, outputs: row.outputs || {}, talk_seconds: call ? Math.round(call.duration_seconds) : null,
    call_id: row.call_id || null, updated_at: nowIso(),
    outcome: contactOutcome(row), outcome_group: OUTCOMES[contactOutcome(row)]?.group || null,
    ...(() => { const t = rowTiming(row.attempts_detail || []); const last = (row.attempts_detail || []).slice(-1)[0]; return { attempt_number: t.attempts || 1, talk_seconds: t.talk_seconds, ring_seconds: t.ring_seconds, hangup_by: t.hangup_by, last_attempt_at: t.last_attempt_at, anomalies: last?.mapped?.anomalies || [], provider: last ? { Status: last.provider.Status, DialStatus: last.provider.DialStatus, CustomerStatus: last.provider.CustomerStatus, HangupBy: last.provider.HangupBy, monitorUCID: last.provider.monitorUCID } : null }; })(),
    last_attempt_status: row.last_attempt_status || null, last_attempt_reason: row.last_attempt_reason || null,
    attempt_log: (row.attempts_detail || []).map((a) => ({ attempt: a.attempt, startedAt: a.started_at, ringSeconds: a.ring_seconds, talkSeconds: a.stream?.connected ? a.talk_seconds : 0,
      callStatus: a.mapped.status.toUpperCase(), callResult: a.mapped.result ? a.mapped.result.toUpperCase() : null, callReason: a.mapped.reason ? a.mapped.reason.toUpperCase() : null,
      outcome: a.outcome, anomalies: a.mapped.anomalies, provider: { Status: a.provider.Status, DialStatus: a.provider.DialStatus, CustomerStatus: a.provider.CustomerStatus, HangupBy: a.provider.HangupBy } })),
    ...over,
  };
  fetch(`${CLARIX_URL}/__mock/exchange-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
function dialCampaign(camp) {
  const a = agentByKey(camp.agent);
  const flow = OZN_CAMPAIGNS.find((f) => f.name === a?.ozonetel_campaign);
  const providerOff = flow && integrationsOf(camp.org_id || flow.org_id)?.[flow.provider || 'ozonetel']?.status !== 'connected';
  if (camp.contacts.length && (!flow || !flow.enabled || providerOff)) {
    camp.failed = !flow ? 'calling_flow_missing' : !flow.enabled ? 'calling_flow_turned_off' : 'telephony_provider_disconnected';
    camp.contacts.filter((r) => r.status === 'pending').forEach((r) => settleRow(camp, r, 'cancelled', { reason: 'not_dialled_campaign_failed' }));
    return 0;
  }
  const rows = camp.contacts.filter((r) => r.status === 'pending' || r.status === 'dialled');
  rows.forEach((row, i) => {
    row.status = MODE === 'target' ? 'queued' : 'dialled';
    row.dispatched_at = nowIso();
    setTimeout(() => placeCampaignCall(camp, row), (6000 + i * 2500) * WAIT_SCALE);
  });
  return rows.length;
}

// Console phone call: a scripted conversation revealed a turn at a time on /api/live.
function startConsoleCall(body) {
  const a = agentByKey(body.agent);
  const donor = scriptFor(body.agent);
  const context = { ...(body.context || {}) };
  // Swap the donor call's name and plant for what the operator typed in.
  const swaps = [[donor?.contact_name?.split(' ')[0], context.contact_name?.split(' ')[0]], [donor?.context?.plant_name, context.plant_name]]
    .filter(([from, to]) => from && to && from !== to);
  const swap = (t) => swaps.reduce((s, [from, to]) => s.split(from).join(to), t || '');
  const script = (donor?.events || []).filter((e) => e.kind !== 'CALL_CONTEXT').map((e) => (e.text ? { ...e, text: swap(e.text) } : e));
  const started = new Date(Date.now() + 4000);
  const id = `40715900${randomInt(10000000, 99999999)}`;
  const phone = String(body.to || '').replace(/^\+91/, '');
  liveCall = {
    call_id: id, started_at: started.toISOString(), agent: body.agent, agent_key: `ozonetel/${body.agent}/${body.provider}`,
    contact_name: context.contact_name || '', phone, provider: body.provider, mode: 'telephony', source: 'console',
    status: 'in_progress', num_turns: 0, duration_seconds: 0, campaign_id: '', campaign_name: '', summary: '',
    total_tokens: 0, context, events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context }],
  };
  const live = liveCall;
  script.forEach((e, i) => setTimeout(() => {
    if (liveCall !== live) return;
    live.events.push({ ...e, ts: nowIso() });
    live.num_turns = live.events.filter((x) => x.kind.endsWith('_TURN')).length;
    live.duration_seconds = Math.round((Date.now() - started.getTime()) / 1000);
  }, 4000 + (i + 1) * 3000));
  setTimeout(() => {
    if (liveCall !== live) return;
    const outputs = outputsOf(live);
    Object.assign(live, {
      status: 'completed', ended_at: nowIso(), duration_seconds: Math.round((Date.now() - started.getTime()) / 1000),
      summary: summarise(outputs, live.num_turns, live.events.some((x) => x.kind === 'USER_TURN')),
      outputs, tools_called: outputs ? ['submit_call_outputs'] : [], total_tokens: live.num_turns * 13000,
      telephony_provider: 'ozonetel', recording_source: 'ozonetel', recording_url: '', disconnect_reason: 'agent_end_call',
      contact_name: live.contact_name || a?.label || '',
    });
    calls.push(live);
    liveCall = null;
  }, 4000 + (script.length + 1) * 3000 + 1500);
  return id;
}

// ── Upload parsing ───────────────────────────────────────────────────────────
function multipart(req, buf) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] || '');
  if (!m) return {};
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const out = {};
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.slice(start + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString('utf8');
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const content = part.slice(sep + 4);
    if (name) out[name] = filename !== undefined ? { filename, content } : content.toString('utf8');
    start = next;
  }
  return out;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function proposeMapping(agent, headers) {
  return agent.input_variables.map((v, i) => {
    let index = headers.findIndex((h) => norm(h) === norm(v.key));
    let matched_by = index >= 0 ? 'name' : '';
    if (index < 0 && i < headers.length && !headers[i]) { index = i; matched_by = 'position'; }
    return {
      column: v.key, index: index >= 0 ? index : null, header: index >= 0 ? headers[index] : null, matched_by: matched_by || null,
      required: v.type === 'phone' || v.key === agent.primary_id_key,
      role: v.type === 'phone' ? 'dial' : v.key === agent.primary_id_key ? 'primary_id' : null,
    };
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const json = (res, status, body) => { res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const file = (res, buf, type, name, inline = false) => {
  res.writeHead(200, { ...CORS, 'Content-Type': type, 'Content-Length': buf.length, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"` });
  res.end(buf);
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fail = (res, status, error) => json(res, status, { error });

const routes = [];
const on = (method, pattern, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn, ...opts });

on('POST', '/api/auth/login', ({ res, body }) => {
  if (!body?.email || !body?.password) return fail(res, 401, 'Wrong email or password');
  signedInEmail = String(body.email);
  json(res, 200, { access_token: `local-${randomUUID()}`, user_id: 'u_admin' });
}, { open: true });
on('GET', '/api/me', ({ res }) => { const u = me(); json(res, 200, { user_id: u?.user_id || 'u_admin', email: signedInEmail, platform_admin: u ? u.platform_admin : true, agent_admin: u ? u.agent_admin : true, memberships: u ? memberships() : ORGS }); });

// Team
on('GET', '/api/orgs/:org/users', ({ res, p }) => json(res, 200, users.filter((u) => u.org_id === p.org || u.org_id === '*')));
on('POST', '/api/orgs/:org/users', ({ res, body, req }) => {
  if (users.some((u) => u.email === body.email)) return fail(res, 409, 'That email is already a member');
  const u = { user_id: `u_${randomUUID().slice(0, 8)}`, email: body.email, role: body.role || 'user', agent_admin: false, platform_admin: false, org_id: req.url.split('/')[3] };
  users.push(u); json(res, 201, u);
});
on('PATCH', '/api/orgs/:org/users/:user/role', ({ res, p, body }) => {
  const u = users.find((x) => x.user_id === p.user); if (!u) return fail(res, 404, 'User not found');
  u.role = body.role; json(res, 200, u);
});
on('DELETE', '/api/orgs/:org/users/:user', ({ res, p }) => {
  const i = users.findIndex((x) => x.user_id === p.user); if (i < 0) return fail(res, 404, 'User not found');
  users.splice(i, 1); groups.forEach((g) => { g.member_ids = g.member_ids.filter((m) => m !== p.user); }); json(res, 200, {});
});
on('PATCH', '/api/admin/users/:user/agent-admin', ({ res, p, body }) => {
  const u = users.find((x) => x.user_id === p.user); if (!u) return fail(res, 404, 'User not found');
  u.agent_admin = !!body.agent_admin; json(res, 200, u);
});
on('GET', '/api/orgs/:org/groups', ({ res, p }) => json(res, 200, groups.filter((g) => g.org_id === p.org)));
on('POST', '/api/orgs/:org/groups', ({ res, body, req }) => {
  const g = { group_id: `g_${randomUUID().slice(0, 8)}`, org_id: req.url.split('/')[3], name: body.name, created_by: 'u_admin', member_ids: [] };
  groups.push(g); json(res, 201, g);
});
on('PATCH', '/api/orgs/:org/groups/:g', ({ res, p, body }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); g.name = body.name; json(res, 200, g); });
on('DELETE', '/api/orgs/:org/groups/:g', ({ res, p }) => { const i = groups.findIndex((x) => x.group_id === p.g); if (i >= 0) groups.splice(i, 1); json(res, 200, {}); });
on('POST', '/api/orgs/:org/groups/:g/members', ({ res, p, body }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); if (!g.member_ids.includes(body.userId)) g.member_ids.push(body.userId); json(res, 200, g); });
on('DELETE', '/api/orgs/:org/groups/:g/members/:user', ({ res, p }) => { const g = groups.find((x) => x.group_id === p.g); if (!g) return fail(res, 404, 'Group not found'); g.member_ids = g.member_ids.filter((m) => m !== p.user); json(res, 200, g); });
// ── Integrations: telephony providers and result destinations (Settings) ────
// One setup flow for every integration: fill in its fields, Echo runs checks
// against the real service, and only a fully passing check can be saved.
// Saved integrations can be turned off (kept) or removed (needs confirming).
const integrationsByOrg = {};
function integrationsOf(org) {
  return (integrationsByOrg[org] ||= {
    ozonetel: { status: 'connected', config: { account: 'echo_ops', api_key: '••••••••3f2a' }, checked_at: nowIso(), connected_at: '2026-08-12T05:30:00Z' },
    clarix: { status: 'connected', config: { workspace: 'Main' }, checked_at: nowIso(), connected_at: '2026-08-20T05:30:00Z' },
    webhook: { status: 'connected', config: { url: 'https://your-system.example.com/echo-results', secret: '' }, checked_at: nowIso(), connected_at: '2026-09-02T05:30:00Z' },
  });
}
const integrationView = (org) => INTEGRATION_CATALOG.map((c) => ({ ...c, status: 'not_set', ...(integrationsOf(org)[c.key] || {}) }));
const syncTargets = (org) => integrationView(org || 'org_moglix').filter((i) => i.kind === 'destination')
  .map((i) => ({ platform_key: i.key, label: i.label, connected: i.status === 'connected', needs_url: !!i.needs_url, url: i.config?.url || '' }));
const checkTokens = new Map();
const mask = (v) => (v ? `••••••••${String(v).slice(-4)}` : '');

on('GET', '/api/orgs/:org/integrations', ({ res, p }) => json(res, 200, integrationView(p.org)));
// Runs the integration's checks one by one; the first failure stops the rest.
on('POST', '/api/orgs/:org/integrations/:key/check', ({ res, p, body }) => {
  const cat = INTEGRATION_CATALOG.find((c) => c.key === p.key); if (!cat) return fail(res, 404, 'Unknown integration');
  const saved = integrationsOf(p.org)[p.key]?.config || {};
  const cfg = { ...saved, ...Object.fromEntries(Object.entries(body.config || {}).filter(([, v]) => v !== '' && !String(v).startsWith('••'))) };
  const missing = cat.fields.find((f) => !f.optional && !String(cfg[f.key] || '').trim());
  const bad = Object.values(cfg).some((v) => /fail|wrong/i.test(String(v)));
  const httpsBad = cat.fields.some((f) => f.type === 'url' && cfg[f.key] && !/^https:\/\//.test(cfg[f.key]));
  let stop = false;
  const flows = OZN_CAMPAIGNS.filter((f) => f.org_id === p.org && f.provider === p.key).length || 0;
  const checks = cat.checks.map((label, i) => {
    if (stop) return { label, ok: null, detail: 'Not run' };
    let ok = true; let detail = 'Passed';
    if (i === 0 && missing) { ok = false; detail = missing.type === 'oauth' ? 'Sign in first' : `${missing.label} is empty`; }
    else if (i === 0 && httpsBad) { ok = false; detail = 'Use an https:// address'; }
    else if (i === 1 && bad) { ok = false; detail = 'The service refused these details (401). Check them in the provider console.'; }
    else if (/Models listed/.test(label)) detail = `${(ENGINES.s2s.length + ENGINES.stt.length + ENGINES.llm.length + ENGINES.tts.length)} models available`;
    else if (/flows|numbers/.test(label)) detail = `${flows || 'Some'} found`;
    else if (/callbacks/.test(label)) detail = 'Test callback received in 0.4 s';
    else if (/2xx/.test(label)) detail = 'Answered 200 in 180 ms';
    if (!ok) stop = true;
    return { label, ok, detail };
  });
  const ok = checks.every((c) => c.ok);
  const token = ok ? `chk_${Math.random().toString(36).slice(2, 10)}` : null;
  if (token) checkTokens.set(token, { org: p.org, key: p.key, cfg });
  json(res, 200, { ok, checks, token, checked_at: nowIso() });
});
// Saving needs the token from a passing check made with these same details.
on('PUT', '/api/orgs/:org/integrations/:key', ({ res, p, body }) => {
  const t = checkTokens.get(body.token);
  if (!t || t.org !== p.org || t.key !== p.key) return fail(res, 409, 'Run the checks and pass them before saving');
  checkTokens.delete(body.token);
  const cat = INTEGRATION_CATALOG.find((c) => c.key === p.key);
  const config = Object.fromEntries(cat.fields.map((f) => [f.key, f.type === 'secret' ? mask(t.cfg[f.key]) : t.cfg[f.key] || '']));
  const cur = integrationsOf(p.org)[p.key];
  integrationsOf(p.org)[p.key] = { status: 'connected', config, checked_at: nowIso(), connected_at: cur?.connected_at || nowIso() };
  if (cat.kind === 'telephony' && !OZN_CAMPAIGNS.some((f) => f.org_id === p.org && f.provider === p.key)) fetchFlows(p.org, p.key);
  json(res, 200, integrationView(p.org).find((i) => i.key === p.key));
});
// Turn on or off without losing the setup.
on('PATCH', '/api/orgs/:org/integrations/:key', ({ res, p, body }) => {
  const cur = integrationsOf(p.org)[p.key]; if (!cur) return fail(res, 404, 'Not set up');
  cur.status = body.enabled ? 'connected' : 'disabled';
  json(res, 200, integrationView(p.org).find((i) => i.key === p.key));
});
on('DELETE', '/api/orgs/:org/integrations/:key', ({ res, p }) => {
  const cat = INTEGRATION_CATALOG.find((c) => c.key === p.key);
  delete integrationsOf(p.org)[p.key];
  let cleared = 0;
  for (const a of agents.filter((x) => (x.org_id || 'org_moglix') === p.org)) {
    if (cat?.kind === 'destination' && a.synced_platform === p.key) { a.synced_platform = null; a.sync_status = null; cleared++; }
    if (cat?.kind === 'telephony' && OZN_CAMPAIGNS.some((f) => f.provider === p.key && f.name === a.ozonetel_campaign)) { a.ozonetel_campaign = ''; cleared++; }
  }
  if (cat?.kind === 'telephony') for (let i = OZN_CAMPAIGNS.length - 1; i >= 0; i--) if (OZN_CAMPAIGNS[i].org_id === p.org && OZN_CAMPAIGNS[i].provider === p.key) OZN_CAMPAIGNS.splice(i, 1);
  json(res, 200, { removed: p.key, agents_cleared: cleared });
});
// Old agent dropdown feed: destinations that are set up and turned on.
on('GET', '/api/orgs/:org/sync-platforms', ({ res, p }) => json(res, 200, syncTargets(p.org)));

// ── Calling flows: fetched from each telephony provider, picked per workspace ──
// A provider account can hold hundreds of flows; only the ones turned on here
// show in an agent's "Calls go out on" list.
const FLOW_WORDS = ['sales', 'support', 'collections', 'renewals', 'feedback', 'onboarding', 'reminder', 'survey', 'dispatch', 'kyc', 'billing', 'service', 'leads', 'winback', 'escalation', 'delivery', 'payments', 'verification'];
const FLOW_TAILS = ['north', 'south', 'east', 'west', 'hindi', 'english', 'inbound', 'outbound', 'night', 'weekend', 'v2', 'test'];
const flowFetchedAt = {};
function fetchFlows(org, provider) {
  const have = new Set(OZN_CAMPAIGNS.filter((f) => f.org_id === org).map((f) => f.name));
  const n = provider === 'ozonetel' ? 164 : 38;
  let added = 0;
  for (let i = 0; i < n; i++) {
    const name = `${provider === 'ozonetel' ? '' : provider + '_'}${FLOW_WORDS[i % FLOW_WORDS.length]}_${FLOW_TAILS[(i * 7) % FLOW_TAILS.length]}_${String(i + 1).padStart(3, '0')}`;
    if (have.has(name)) continue;
    OZN_CAMPAIGNS.push({ name, type: ['IVR', 'Progressive', 'Preview', 'Predictive'][i % 4], did: `0800000${String(3000 + i).padStart(4, '0')}`, org_id: org, provider, enabled: false, direction: i % 5 === 3 ? 'inbound' : 'outbound' });
    added++;
  }
  flowFetchedAt[`${org}:${provider}`] = nowIso();
  return added;
}
for (const f of OZN_CAMPAIGNS) Object.assign(f, { provider: f.provider || 'ozonetel', enabled: f.enabled ?? true, direction: f.direction || 'outbound' });
for (const org of ['org_moglix', 'org_pi']) fetchFlows(org, 'ozonetel');

const flowRow = (f) => ({ ...f, used_by: agents.filter((a) => a.ozonetel_campaign === f.name).map((a) => a.label) });
on('GET', '/api/orgs/:org/telephony/flows', ({ res, p }) => {
  const list = OZN_CAMPAIGNS.filter((f) => f.org_id === p.org).map(flowRow);
  json(res, 200, { flows: list, fetched_at: Object.fromEntries(Object.entries(flowFetchedAt).filter(([k]) => k.startsWith(p.org + ':')).map(([k, v]) => [k.split(':')[1], v])) });
});
on('POST', '/api/orgs/:org/telephony/:provider/fetch', ({ res, p }) => {
  if (integrationsOf(p.org)[p.provider]?.status !== 'connected') return fail(res, 409, 'Turn the provider on first');
  const added = fetchFlows(p.org, p.provider);
  json(res, 200, { added, total: OZN_CAMPAIGNS.filter((f) => f.org_id === p.org && f.provider === p.provider).length, fetched_at: flowFetchedAt[`${p.org}:${p.provider}`] });
});
on('PUT', '/api/orgs/:org/telephony/flows/:name', ({ res, p, body }) => {
  const f = OZN_CAMPAIGNS.find((x) => x.org_id === p.org && x.name === p.name); if (!f) return fail(res, 404, 'Flow not found');
  const used = agents.filter((a) => a.ozonetel_campaign === f.name);
  if (!body.enabled && used.length) return fail(res, 409, `${used.length} agent(s) call through this flow. Move them to another flow first.`);
  f.enabled = !!body.enabled; json(res, 200, flowRow(f));
});

// ── Data: what is kept, where, and which outside rules limit it ─────────────
// Echo's own setting is clamped by every rule it cannot change: a storage
// lock sets the shortest time, a lifecycle rule the longest. In production
// these are read from the bucket (GetObjectLockConfiguration,
// GetBucketLifecycleConfiguration) and from the provider account.
function dataPolicy(org) {
  const tp = integrationView(org).find((i) => i.kind === 'telephony' && i.status === 'connected');
  return [
    { key: 'recordings', setting: 'recordings_days', label: 'Call recordings', where: `Amazon S3 bucket echo-recordings-${org.replace('org_', '')} (ap-south-1)`,
      rules: [
        { source: 'S3 Object Lock', kind: 'min', days: 30, detail: 'Governance mode, 30 days. A recording cannot be deleted sooner.' },
        { source: 'S3 lifecycle rule "expire-recordings"', kind: 'max', days: 180, detail: 'S3 deletes recordings 180 days after upload, whatever is set here.' },
        ...(tp ? [{ source: `${tp.label} account`, kind: 'copy', days: null, detail: `${tp.label} keeps its own copy under your account plan. Delete it in the ${tp.label} console.` }] : []),
      ] },
    { key: 'transcripts', setting: 'transcripts_days', label: 'Transcripts and answers', where: 'Echo database',
      rules: [{ source: 'Database backups', kind: 'copy', days: 35, detail: 'Daily backups are kept 35 days, so deleted text leaves backups 35 days later.' }] },
    { key: 'results', setting: 'results_days', label: 'Uploaded files and results files', where: `Amazon S3 bucket echo-files-${org.replace('org_', '')} (ap-south-1)`,
      rules: [{ source: 'S3 lifecycle rule "expire-files"', kind: 'max', days: 365, detail: 'S3 deletes files 365 days after upload.' }] },
    { key: 'reference', setting: 'reference_days', label: 'Reference files', where: 'Echo temporary storage',
      rules: [{ source: 'Echo limit for temporary files', kind: 'max', days: 30, detail: 'Reference files are never kept longer than 30 days.' }] },
    { key: 'call_log', setting: null, label: 'Call log (who, when, call status, cost)', where: 'Echo database',
      rules: [{ source: 'Billing and audit', kind: 'min', days: 730, detail: 'Kept 2 years for billing and disputes. No recording or words are in it.' }] },
  ].map((d) => {
    const min = Math.max(1, ...d.rules.filter((r) => r.kind === 'min').map((r) => r.days));
    const max = Math.min(3650, ...d.rules.filter((r) => r.kind === 'max').map((r) => r.days));
    return { ...d, min, max, checked_at: nowIso() };
  });
}
on('GET', '/api/orgs/:org/data-policy', ({ res, p }) => json(res, 200, dataPolicy(p.org)));

on('GET', '/api/orgs/:org/settings', ({ res, p }) => json(res, 200, settingsOf(p.org)));
on('PUT', '/api/orgs/:org/settings', ({ res, p, body }) => {
  const cur = settingsOf(p.org);
  for (const k of ['workspace', 'telephony', 'calling_defaults', 'data']) if (body[k]) cur[k] = { ...cur[k], ...body[k] };
  if (cur.telephony.no_reply_under_seconds) setNoReplyUnder(cur.telephony.no_reply_under_seconds);
  json(res, 200, cur);
});

// Metrics and calls
on('GET', '/api/metrics', ({ res, q }) => json(res, 200, metrics(Number(q.get('days') || 30), orgOf(q))));
on('GET', '/api/calls', ({ res, q }) => {
  const list = filterCalls(q);
  json(res, 200, { calls: list.slice(0, Number(q.get('limit') || 50)).map(callRow), total: list.length, storage_connected: true });
});
on('GET', '/api/calls/report.xlsx', ({ res, q }) => {
  const rows = [['Call ID', 'Started', 'Contact', 'Phone', 'Agent', 'Campaign', 'Duration (s)', 'Turns', 'Summary'],
    ...filterCalls(q).map((c) => [c.call_id, c.started_at, c.contact_name, c.phone, c.agent, c.campaign_name, c.duration_seconds, c.num_turns, c.summary])];
  file(res, writeXlsx(rows, 'Calls'), XLSX, 'calls-report.xlsx');
});
on('GET', '/api/calls/:id', ({ res, p }) => {
  const c = callById(p.id); if (!c) return fail(res, 404, 'Call not found');
  // Analysis runs on its own the first time a call with talk is read (no button needed).
  if (!analyses[c.call_id] && c.num_turns && c.status === 'completed') analyses[c.call_id] = analyse(c);
  // Which campaign contact this call belongs to, so the page can show its rows, dials and neighbours.
  const camp = c.campaign_id && campaignById(c.campaign_id);
  const owner = camp?.contacts.find((x) => x.call_id === c.call_id || (x.attempts_detail || []).some((t) => t.call_id === c.call_id));
  json(res, 200, { ...c, analysis: analyses[c.call_id] || null, contact_ref: owner ? { campaign_id: camp.campaign_id, primary_id: owner.primary_id } : null });
});
on('GET', '/api/calls/:id/transcript.txt', ({ res, p }) => {
  const c = callById(p.id); if (!c) return fail(res, 404, 'Call not found');
  const t0 = Date.parse(c.started_at);
  const at = (ts) => { const x = Math.max(0, Math.round((Date.parse(ts) - t0) / 1000)); return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const who = agentByKey(c.agent)?.label?.split(' ')[0] || 'Agent';
  const lines = [`Call ${c.call_id}`, `${c.contact_name || ''} ${c.phone || ''}`.trim(), `Started ${c.started_at}`, '',
    ...(c.events || []).filter((e) => e.kind.endsWith('_TURN')).map((e) => `[${at(e.ts)}] ${e.kind === 'AGENT_TURN' ? who : 'Caller'}: ${e.text}`)];
  file(res, Buffer.from(lines.join('\r\n'), 'utf8'), 'text/plain; charset=utf-8', `transcript-${c.call_id}.txt`);
}, { open: true });
on('POST', '/api/calls/:id/analyze', ({ res, p }) => {
  const c = callById(p.id); if (!c) return fail(res, 404, 'Call not found');
  setTimeout(() => json(res, 200, (analyses[c.call_id] = analyse(c))), 1200);
});
on('GET', '/api/live', ({ res }) => json(res, 200, { call: liveCall }));

// Agents
on('GET', '/webrtc/agents', ({ res, q }) => json(res, 200, agents.filter(inOrg(q)).map(testerAgent)));
on('GET', '/api/agents', ({ res, q }) => json(res, 200, {
  agents: agents.filter(inOrg(q)).map((a) => ({ key: a.key, label: a.label, description: a.description || '', providers: a.providers, input_count: a.input_variables.length, output_count: a.output_variables.length, primary_id_key: a.primary_id_key, ozonetel_campaign: a.ozonetel_campaign || '', synced_platform: a.synced_platform, sync_status: a.sync_status, sync_last_error: a.sync_last_error, synced_at: a.synced_at || null, created_at: a.created_at, updated_at: a.updated_at, updated_by: a.updated_by })),
  storage_connected: true,
}));
on('GET', '/api/agents/meta', ({ res }) => json(res, 200, {
  providers: PROVIDERS,
  voices: Object.entries(VOICES).flatMap(([p, vs]) => vs.map(([name, gender]) => ({ name, provider: p, provider_label: PROVIDERS.find((x) => x.key === p).label, gender }))),
  section_kinds: ['text', 'input', 'output'],
  output_types: ['string', 'number', 'boolean', 'enum', 'date', 'list'],
  input_types: ['string', 'phone', 'number', 'date', 'email'],
  input_transforms: ['', 'phonetic'],
  placeholders: PLACEHOLDERS, runtime_tokens: PLACEHOLDERS.map((x) => x.name),
  channels: [{ key: 'webrtc', label: 'Browser mic', configured: true }, { key: 'ozonetel', label: 'Ozonetel phone', configured: true }],
  // Voice and brain. Presets fill the models; Custom lets a team pick each one.
  engines: ENGINES,
}));
on('GET', '/api/agents/schema', ({ res, q }) => json(res, 200, { agents: agents.filter(inOrg(q)).map(testerAgent) }));
on('POST', '/api/agents/refresh', ({ res }) => json(res, 200, { count: agents.length }));
on('POST', '/api/agents', ({ res, body, q }) => {
  const key = slug(body.label);
  if (!key) return fail(res, 400, 'Give the agent a name');
  if (agentByKey(key)) return fail(res, 409, `An agent called "${body.label}" already exists`);
  const from = body.copy_from ? agentByKey(body.copy_from) : null;
  const a = {
    key, label: body.label, org_id: orgOf(q), description: body.description || '', voice: from?.voice || '',
    ozonetel_campaign: body.ozonetel_campaign || '', ozonetel_type: body.ozonetel_type || '',
    primary_id_key: from?.primary_id_key || 'contact_phone', primary_id_label: from?.primary_id_label || 'contact_phone',
    providers: from?.providers || ['gemini'],
    input_variables: structuredClone(from?.input_variables || [{ key: 'contact_name', type: 'string', transform: '', sample: 'Test Supplier', share_on_call: true }, { key: 'contact_phone', type: 'phone', transform: '', sample: '9000000000', share_on_call: true }]),
    output_variables: structuredClone(from?.output_variables || []),
    sections: structuredClone(from?.sections || [{ id: 'sec_1', enabled: true, title: 'IDENTITY', kind: 'text', body: '' }, { id: 'sec_2', enabled: true, title: 'Call details', kind: 'input', body: '' }, { id: 'sec_3', enabled: true, title: 'Outcome reporting', kind: 'output', body: '' }]),
    synced_platform: null, sync_status: null, sync_last_error: null, synced_at: null, created_at: nowIso(), updated_at: nowIso(), updated_by: signedInEmail,
  };
  agentDefaults(a);
  if (from) for (const k of ['input_plan', 'retry', 'references', 'lookups', 'engine']) a[k] = structuredClone(from[k]);
  agents.unshift(a); json(res, 201, { agent: a });
});
on('GET', '/api/agents/:key', ({ res, p }) => { const a = agentByKey(p.key); a ? json(res, 200, { agent: a }) : fail(res, 404, 'Agent not found'); });
on('PUT', '/api/agents/:key', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  for (const k of ['label', 'description', 'voice', 'ozonetel_campaign', 'ozonetel_type', 'primary_id_key', 'primary_id_label', 'input_plan', 'retry', 'references', 'lookups', 'engine']) if (k in body) a[k] = body[k];
  if ('sync_target' in body) {
    a.sync_target = body.sync_target || { type: 'none', url: '' };
    a.synced_platform = a.sync_target.type === 'none' ? null : a.sync_target.type;
    if (!a.synced_platform) Object.assign(a, { sync_status: null, sync_last_error: null });
  }
  touch(a);
  json(res, 200, { agent: a });
});
on('DELETE', '/api/agents/:key', ({ res, p }) => {
  const i = agents.findIndex((a) => a.key === p.key); if (i < 0) return fail(res, 404, 'Agent not found');
  const used = campaigns.filter((c) => c.agent === p.key).length;
  const [gone] = agents.splice(i, 1);
  // A synced agent tells Clarix it is gone, so Clarix archives its setup instead of showing a dead agent.
  if (gone.synced_platform === 'clarix') fetch(`${CLARIX_URL}/public/webhooks/exchange/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gone.key, name: gone.label, deleted: true }) }).catch(() => {});
  json(res, 200, used ? { note: `${used} campaign(s) still reference this agent; their history is kept.` } : {});
});
on('PUT', '/api/agents/:key/sections', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.sections = body.sections || []; touch(a); json(res, 200, { agent: a }); });
on('PUT', '/api/agents/:key/inputs', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.input_variables = body.variables || []; touch(a); json(res, 200, { agent: a }); });
on('PUT', '/api/agents/:key/outputs', ({ res, p, body }) => { const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found'); a.output_variables = body.variables || []; touch(a); json(res, 200, { agent: a }); });
on('GET', '/api/agents/:key/generated', ({ res, p }) => { const a = agentByKey(p.key); a ? json(res, 200, generated(a)) : fail(res, 404, 'Agent not found'); });
on('POST', '/api/agents/:key/preview', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  json(res, 200, { prompt: promptFrom(a, body?.sections || a.sections), draft: Boolean(body?.sections) });
});
on('POST', '/api/agents/:key/sync', ({ res, p, body }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  // Target behaviour: sync can be repeated at any time; it pushes the current agent.
  a.synced_platform = body.platform_key || a.synced_platform || 'clarix';
  pushAgent(a);
  json(res, 200, { agent: a });
});
// Try a file against draft Input file settings: what it would become (PRD-ECHO-19 section 4.1).
on('POST', '/api/agents/:key/check-file', ({ res, p, req, raw: buf }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  const form = multipart(req, buf);
  if (!form.file?.content) return fail(res, 400, 'No file received');
  let rows; try { rows = readXlsx(form.file.content); } catch { return fail(res, 400, 'Could not read that spreadsheet'); }
  const [headers, ...data] = rows;
  const draft = { ...a, input_plan: form.plan ? JSON.parse(form.plan) : a.input_plan };
  const prop = proposeMapping(draft, headers);
  const fileRows = data.map((r, i) => fileRow(draft, Object.fromEntries(prop.filter((m) => m.index !== null).map((m) => [m.column, String(r[m.index] ?? '').trim()])), i + 1));
  const groups = groupRows(draft, fileRows);
  const missing = prop.filter((m) => m.index === null).map((m) => m.column);
  // Columns whose value never changes inside a group: good "whole call" candidates.
  const keys = draft.input_variables.map((v) => v.key);
  const steady = keys.filter((k) => groups.every((g) => new Set(g.rows.map((r) => r.ctx[k])).size <= 1));
  json(res, 200, { rows: fileRows.length, calls: groups.length, biggest: Math.max(0, ...groups.map((g) => g.rows.length)), split: groups.filter((g) => g.parts > 1 && g.part === 1).length,
    bad: fileRows.filter((r) => r.bad).length, missing_columns: missing, steady_columns: steady,
    sample: groups.slice(0, 4).map((g) => ({ key: g.key, rows: g.rows.length, first: g.rows.slice(0, 3).map((r) => r.row) })) });
});
on('POST', '/api/agents/:key/references', ({ res, p, req, raw: buf }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  const form = multipart(req, buf);
  if (!form.file?.content) return fail(res, 400, 'No file received');
  if (form.file.content.length > 50 * 1024 * 1024) return fail(res, 413, 'Reference files can be up to 50 MB');
  const scope = form.scope === 'agent' ? 'agent' : 'campaign';
  const ref = { id: randomUUID().slice(0, 8), name: form.file.filename, size_kb: Math.round(form.file.content.length / 1024), scope, status: 'ready', added_at: nowIso(),
    // Campaign scope: deleted 7 days after the campaign that uses it ends. Agent scope: kept until removed.
    keep: scope === 'campaign' ? 'Deleted 7 days after each campaign ends' : 'Kept until removed' };
  a.references.push(ref); touch(a);
  json(res, 201, { reference: ref, agent: a });
});
on('DELETE', '/api/agents/:key/references/:id', ({ res, p }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  a.references = a.references.filter((r) => r.id !== p.id); touch(a); json(res, 200, { agent: a });
});
on('GET', '/api/agents/:key/template.xlsx', ({ res, p }) => {
  const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
  file(res, writeXlsx(templateRows(a), 'Contacts'), XLSX, `${a.key}_template.xlsx`);
});

// Campaigns
on('GET', '/api/campaigns', ({ res, q }) => json(res, 200, {
  campaigns: campaigns.filter(inOrg(q)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(campaignSummary), storage_connected: true,
}));
on('POST', '/api/campaigns', ({ res, body, q }) => {
  const a = agentByKey(body.agent); if (!a) return fail(res, 400, 'Pick an agent');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const c = {
    campaign_id: `${slug(a.label).replace(/_/g, '-')}-${randomUUID().slice(0, 8)}`, name: uniqueName(`${a.label} - ${stamp}`),
    agent: a.key, org_id: orgOf(q), provider: body.provider || a.providers[0], source: 'internal', direction: body.direction || 'outbound',
    description: body.description || '', created_at: nowIso(), contacts: [], clarix_batch_id: null,
  };
  campaigns.push(c); json(res, 201, { campaign_id: c.campaign_id });
});
/** Campaign names are unique: a second campaign in the same minute gets (2), (3)... */
function uniqueName(base) {
  const taken = new Set(campaigns.map((x) => x.name));
  if (!taken.has(base)) return base;
  let n = 2; while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
on('GET', '/api/campaigns/:id', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const a = agentByKey(c.agent);
  json(res, 200, { ...campaignSummary(c), direction: c.direction, schema: {
    label: a?.label || c.agent, output_variables: a?.output_variables || [], primary_id_label: a?.primary_id_label || 'Primary id',
    ozonetel_campaign: a?.ozonetel_campaign || '', input_columns: a?.input_variables.map((v) => v.key) || [],
  } });
});
on('DELETE', '/api/campaigns/:id', ({ res, p }) => { const i = campaigns.findIndex((c) => c.campaign_id === p.id); if (i >= 0) campaigns.splice(i, 1); json(res, 200, {}); });
on('GET', '/api/campaigns/:id/contacts', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { contacts: c.contacts.map((x) => ({ primary_id: x.primary_id, phone: x.phone, name: x.name, status: x.status, outcome: contactOutcome(x), outcome_group: OUTCOMES[contactOutcome(x)]?.group, rows_count: x.items?.length || 1, last_provider: (() => { const l = (x.attempts_detail || []).slice(-1)[0]; return l ? { name: l.provider_name || 'ozonetel', Status: l.provider.Status, CustomerStatus: l.provider.CustomerStatus, DialStatus: l.provider.DialStatus, HangupBy: l.provider.HangupBy } : null; })(), part: x.part || 1, parts: x.parts || 1, call_id: x.call_id || null, call_result: x.call_result || null, reason: x.reason || null, attempts: x.attempts ?? null, next_attempt_at: x.next_attempt_at || null, validation_error: x.validation_error || null, recording_call_id: x.recording_call_id || null, last_attempt_status: x.last_attempt_status || null, last_attempt_reason: x.last_attempt_reason || null, ...rowTiming(x.attempts_detail || []), attempts: (x.attempts_detail || []).length || x.attempts || 0, anomalies: [...new Set((x.attempts_detail || []).flatMap((a) => a.mapped.anomalies))] })) });
});
on('GET', '/api/campaigns/:id/responses', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { responses: c.contacts.filter((x) => HAS_CALL.has(x.status) || (MODE === 'live' && x.status === 'dialled')).map((x) => ({ primary_id: x.primary_id, name: x.name, phone: x.phone, status: x.status, outcome: contactOutcome(x), call_result: x.call_result || null, talk_seconds: rowTiming(x.attempts_detail || []).talk_seconds, captured_at: x.captured_at || null, call_id: x.call_id || null, outputs: x.outputs || {} })) });
});
on('GET', '/api/campaigns/:id/contacts/:pid', ({ res, p }) => {
  const c = campaignById(p.id); const x = c?.contacts.find((r) => r.primary_id === p.pid);
  if (!x) return fail(res, 404, 'Contact not found');
  const call = x.call_id ? callById(x.call_id) : null;
  const transcript = (call?.events || []).filter((e) => e.kind !== 'CALL_CONTEXT').map((e) =>
    e.kind === 'TOOL_CALL' ? { role: 'tool', text: '', ts: e.ts, tool: e.tool, args: e.args } : { role: e.kind === 'USER_TURN' ? 'user' : 'agent', text: e.text || '', ts: e.ts });
  const ag = agentByKey(c.agent);
  const order = c.contacts.map((r) => r.primary_id);
  const at = order.indexOf(x.primary_id);
  json(res, 200, {
    campaign: { campaign_id: c.campaign_id, name: c.name, agent: c.agent, agent_label: ag?.label || c.agent },
    prev: at > 0 ? order[at - 1] : null, next: at < order.length - 1 ? order[at + 1] : null, position: at + 1, total: order.length,
    outcome: contactOutcome(x), outcome_group: OUTCOMES[contactOutcome(x)]?.group, context: x.context || {},
    rows: x.items?.length ? rowsOf(ag, x).map((it) => ({ n: it.n, row: it.row, values: it.values, answer: it.answer })) : null,
    row_columns: x.items?.length ? rowColumns(ag) : [], answer_fields: answerFields(ag), part: x.part || 1, parts: x.parts || 1, call_id: x.call_id || null,
    contact: { name: x.name, phone: x.phone }, status: x.status, call_result: x.call_result || null, reason: x.reason || null, attempts: (x.attempts_detail || []).length || x.attempts || 0,
    next_attempt_at: x.next_attempt_at || null, last_attempt_status: x.last_attempt_status || null, last_attempt_reason: x.last_attempt_reason || null,
    timing: rowTiming(x.attempts_detail || []), attempt_log: (x.attempts_detail || []).map((a) => ({ attempt: a.attempt, started_at: a.started_at, ended_at: a.ended_at, ring_seconds: a.ring_seconds, talk_seconds: a.stream?.connected ? a.talk_seconds : 0, status: a.mapped.status, result: a.mapped.result, reason: a.mapped.reason, outcome: a.outcome, facts: a.facts, anomalies: a.mapped.anomalies, stream: a.stream, provider_name: a.provider_name || 'ozonetel', provider: a.provider, call_id: a.call_id || null })),
    response: { validation_error: x.validation_error || null },
    call: call ? { duration_seconds: call.duration_seconds, num_turns: call.num_turns, matched_by: 'campaign' } : null,
    audio: { available: Boolean(call), call_id: call?.call_id || null },
    outputs: x.outputs || {}, transcript,
  });
});
on('POST', '/api/campaigns/:id/upload', ({ res, p, q, req, raw: buf }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const a = agentByKey(c.agent); if (!a?.ozonetel_campaign) return fail(res, 400, 'This agent is not mapped to an Ozonetel campaign');
  if (c.contacts.length) return fail(res, 409, 'This campaign already has its contact list');
  const form = multipart(req, buf);
  if (!form.file?.content) return fail(res, 400, 'No file received');
  let rows;
  try { rows = readXlsx(form.file.content); } catch { return fail(res, 400, 'Could not read that spreadsheet'); }
  if (!rows.length) return fail(res, 400, 'The sheet is empty');
  const [headers, ...data] = rows;
  const proposal = proposeMapping(a, headers);
  if (q.get('dry_run') === 'true') {
    // What the file becomes: rows grouped into calls by the agent's Input file settings.
    const rows = data.map((r, i) => fileRow(a, Object.fromEntries(proposal.filter((m) => m.index !== null).map((m) => [m.column, String(r[m.index] ?? '').trim()])), i + 1));
    const groups = groupRows(a, rows);
    return json(res, 200, { mapping: proposal, sheet_headers: headers, sample_rows: data.slice(0, 5), parsed_rows: data.length,
      grouping: { mode: planOf(a).mode, group_by: planOf(a).group_by, calls: groups.length, biggest: Math.max(0, ...groups.map((g) => g.rows.length)), split: groups.filter((g) => g.parts > 1 && g.part === 1).length } });
  }
  const map = form.mapping ? JSON.parse(form.mapping) : Object.fromEntries(proposal.map((m) => [m.column, m.index]));
  const fileRows = data.map((r, i) => fileRow(a, Object.fromEntries(Object.entries(map).filter(([, idx]) => idx !== null && idx !== undefined).map(([k, idx]) => [k, String(r[idx] ?? '').trim()])), i + 1));
  c.file_rows = fileRows.length;
  c.contacts = markRepeats(a, groupRows(a, fileRows).map((g) => contactFrom(a, g)));
  const dialled = dialCampaign(c);
  json(res, 200, { stored: c.contacts.length, dial: { dialled, ozonetel_campaign: a.ozonetel_campaign } });
});
on('POST', '/api/campaigns/:id/dial', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  json(res, 200, { dialled: dialCampaign(c), ozonetel_campaign: agentByKey(c.agent)?.ozonetel_campaign || '' });
});
// Pause holds every call not yet placed; resume places them again (and any retry that came due while paused).
on('POST', '/api/campaigns/:id/pause', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  if (campaignStatus(c) !== 'running') return fail(res, 409, 'Only a running campaign can be paused');
  c.paused = true; c.contacts.forEach((r) => notifyClarix(c, r));
  json(res, 200, { status: campaignStatus(c) });
});
on('POST', '/api/campaigns/:id/resume', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  if (!c.paused) return fail(res, 409, 'This campaign is not paused');
  c.paused = false;
  const waiting = c.contacts.filter((r) => ['pending', 'queued', 'dialled', 'scheduled'].includes(r.status) || (r.status === 'retry_scheduled' && Date.parse(r.next_attempt_at || 0) <= Date.now()));
  waiting.forEach((r, i) => setTimeout(() => placeCampaignCall(c, r), (800 + i * 400) * WAIT_SCALE));
  json(res, 200, { status: campaignStatus(c), resumed: waiting.length });
});
// Target backend: Stop ends a campaign. Rows not yet dialled become Cancelled (not dialled).
on('POST', '/api/campaigns/:id/stop', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  c.stopped = true;
  let n = 0;
  for (const r of c.contacts) if (OPEN.has(r.status) && r.status !== 'calling' && r.status !== 'in_progress') { settleRow(c, r, 'cancelled', { reason: 'not_dialled_stopped' }); n++; }
  json(res, 200, { stopped: n, status: campaignStatus(c) });
});
// Your file with answers: every uploaded row once, in file order, with its call's outcome and its own answers.
const PLATFORM_COLS = new Set(['call_status', 'dials', 'talk_seconds', 'call_id']);
function fileWithAnswers(c) {
  const a = agentByKey(c.agent);
  const inputs = a?.input_variables.map((v) => v.key) || [];
  const flat = (o) => Object.entries(o || {}).filter(([, v]) => !Array.isArray(v));
  const callKeys = [...new Set(c.contacts.flatMap((x) => flat(callOutputs(a, x.outputs)).map(([k]) => k)))];
  const ansKeys = answerFields(a).filter((k) => k !== 'row');
  const out = [];
  for (const x of c.contacts) {
    const t = rowTiming(x.attempts_detail || []);
    const base = { call_status: OUTCOMES[contactOutcome(x)]?.label || '', dials: t.attempts || 0, talk_seconds: t.talk_seconds || 0, call_id: x.call_id || '' };
    const items = x.items?.length ? rowsOf(a, x) : [{ row: x.row, values: {}, answer: null }];
    // A reached call that ended before the agent covered a row (caller hung up early): the row says not covered, never blank.
    const reached = OUTCOMES[contactOutcome(x)]?.group === 'reached';
    const notCovered = Object.fromEntries((a?.output_variables.find((o) => o.key === answersKey(a))?.fields || []).filter((f) => f.type === 'enum' && f.options?.includes('not_covered')).map((f) => [f.key, 'not_covered']));
    for (const it of items) {
      const rowAnswer = it.answer && Object.keys(it.answer).length ? it.answer : x.items?.length && reached ? notCovered : it.answer;
      // Agent answers that share a name with a platform column are prefixed, so the platform call status always wins.
      const answers = Object.fromEntries([...flat(callOutputs(a, x.outputs)), ...Object.entries(rowAnswer || {})].map(([k, v]) => [PLATFORM_COLS.has(k) ? `answer_${k}` : k, v]));
      out.push({ _row: it.row, ...x.context, ...it.values, ...answers, ...base });
    }
  }
  out.sort((p, q) => p._row - q._row);
  const ren = (k) => (PLATFORM_COLS.has(k) ? `answer_${k}` : k);
  const head = [...inputs, 'call_status', 'dials', 'talk_seconds', ...[...new Set([...callKeys, ...ansKeys].map(ren))], 'call_id'];
  return { head, rows: out };
}
on('GET', '/api/campaigns/:id/results.xlsx', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const { head, rows } = fileWithAnswers(c);
  file(res, writeXlsx([head, ...rows.map((r) => head.map((k) => r[k] ?? ''))], 'Results'), XLSX, `${c.campaign_id}_results.xlsx`);
});
on('GET', '/api/campaigns/:id/template.xlsx', ({ res, p }) => {
  const c = campaignById(p.id); const a = agentByKey(c?.agent); if (!a) return fail(res, 404, 'Campaign not found');
  file(res, writeXlsx(templateRows(a), 'Contacts'), XLSX, `${c.campaign_id}_template.xlsx`);
});
on('GET', '/api/campaigns/:id/responses.xlsx', ({ res, p }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const { head, rows } = fileWithAnswers(c);
  file(res, writeXlsx([head, ...rows.map((r) => head.map((k) => r[k] ?? ''))], 'Results'), XLSX, `${c.campaign_id}_results.xlsx`);
});
on('GET', '/api/campaigns/:id/export.zip', ({ res, p, q }) => {
  const c = campaignById(p.id); if (!c) return fail(res, 404, 'Campaign not found');
  const include = (q.get('include') || 'transcripts,audio').split(',');
  const files = {};
  for (const x of c.contacts) {
    const call = x.call_id && callById(x.call_id); if (!call) continue;
    if (include.includes('transcripts')) files[`transcripts/${x.primary_id}.txt`] = call.events.filter((e) => e.kind.endsWith('_TURN')).map((e) => `${e.kind === 'AGENT_TURN' ? 'Agent' : 'Caller'}: ${e.text}`).join('\n');
    if (include.includes('audio')) files[`audio/${x.primary_id}.wav`] = wav(call.duration_seconds);
  }
  if (!Object.keys(files).length) files['README.txt'] = 'No calls connected yet.';
  file(res, zip(files), 'application/zip', `${c.campaign_id}.zip`);
});

// Clarix mock pairing: a sheet uploaded in the local Clarix becomes a Clarix-sourced
// campaign here and is dialled at once, as live.
// Clarix Stop on a sheet stops the Echo campaign made from it (ECHO-162); Echo's updates then flow back.
on('POST', '/__mock/clarix-stop', ({ res, body }) => {
  const c = campaigns.find((x) => x.clarix_batch_id === body.batchId); if (!c) return fail(res, 404, 'No Echo campaign for that sheet');
  c.stopped = true;
  let n = 0;
  for (const r of c.contacts) if (OPEN.has(r.status) && r.status !== 'calling' && r.status !== 'in_progress') { settleRow(c, r, 'cancelled', { reason: 'not_dialled_stopped' }); n++; }
  json(res, 200, { stopped: n, status: campaignStatus(c) });
}, { open: true });
on('POST', '/__mock/dial-script', ({ res, body }) => {
  for (const [phone, plan] of Object.entries(body.plan || {})) DIAL_SCRIPT.set(String(phone), plan.map((x) => [...x]));
  if (body.fast) { RETRY_DEMO_MS = 1500; WAIT_SCALE = 0.05; }
  json(res, 200, { queued: DIAL_SCRIPT.size, retry_ms: RETRY_DEMO_MS });
}, { open: true });
on('POST', '/__mock/clarix-batch', ({ res, body }) => {
  const a = agentByKey(body.agent);
  if (!a) return fail(res, 400, `Unknown agent ${body.agent}`);
  const c = {
    campaign_id: `${slug(a.label).replace(/_/g, '-')}-${body.batchId}-${randomUUID().slice(0, 8)}`, name: body.name,
    agent: a.key, org_id: a.org_id || 'org_moglix', provider: a.providers[0], source: 'clarix', direction: 'outbound', description: 'Submitted via clarix',
    created_at: nowIso(), clarix_batch_id: body.batchId,
    contacts: [],
  };
  const rows = (body.rows || []).map((r, i) => ({ ...fileRow(a, { ...(r.context || {}) }, i + 1), ref: r.primary_id, name: r.name, phone: String(r.phone || '').replace(/\D/g, '').slice(-10), bad: null }));
  c.file_rows = rows.length;
  c.contacts = markRepeats(a, groupRows(a, rows).map((g) => contactFrom(a, g)));
  // Rows that will never be dialled (bad data, repeated number) are final now: tell Clarix at once.
  for (const x of c.contacts) if (x.status === 'input_validation_failed') notifyClarix(c, x);
  campaigns.push(c);
  json(res, 200, { campaign_id: c.campaign_id, dialled: dialCampaign(c) });
}, { open: true });

// Telephony, recordings, console calls
// Agents only see flows turned on in Settings, from providers that are turned on.
on('GET', '/ozonetel/campaigns', ({ res, q }) => json(res, 200, { campaigns: OZN_CAMPAIGNS.filter(inOrg(q)).filter((f) => f.enabled && f.direction !== 'inbound' && integrationsOf(orgOf(q))[f.provider]?.status === 'connected').map((f) => ({ ...f, provider_label: INTEGRATION_CATALOG.find((c) => c.key === f.provider)?.label || f.provider })) }));
on('POST', '/ozonetel/start_call', ({ res, body }) => {
  if (!agentByKey(body.agent)) return fail(res, 400, 'Unknown agent');
  if (liveCall) return fail(res, 409, 'A call is already running');
  const id = startConsoleCall(body);
  json(res, 200, { status: 'success', custom_sid: id });
});
on('POST', '/webrtc/start_call', ({ res }) => fail(res, 501, 'Browser calls need the real voice backend; the local mock only simulates phone calls'));
on('GET', '/webrtc/recording/:sid/status', ({ res }) => json(res, 200, { ready: true }));
on('GET', '/webrtc/recording/:sid', ({ res, p, q }) => file(res, wav(callById(p.sid)?.duration_seconds), 'audio/wav', `${p.sid}.wav`, q.get('download') !== '1'), { open: true });

// ── Server ───────────────────────────────────────────────────────────────────
function handler(port) {
  return (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/health') {
      return json(res, 200, port === BACKEND_PORT
        ? { status: 'ok', telephony: { ozonetel_configured: true } }
        : { status: 'ok', version: 'local-mock', base_url: `http://localhost:${port}` });
    }
    const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) return fail(res, 404, `No mock for ${req.method} ${url.pathname}`);
    if (!route.open && !url.searchParams.get('token')) return fail(res, 401, 'Not signed in');
    const wantOrg = url.searchParams.get('org_id');
    if (!route.open && wantOrg && !memberships().some((o) => o.org_id === wantOrg)) return fail(res, 403, 'You do not have access to this workspace');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      let body = {};
      if ((req.headers['content-type'] || '').includes('application/json') && buf.length) {
        try { body = JSON.parse(buf.toString('utf8')); } catch { return fail(res, 400, 'Bad JSON'); }
      }
      const p = Object.fromEntries(Object.entries(route.re.exec(url.pathname).groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      try { route.fn({ req, res, url, q: url.searchParams, p, body, raw: buf }); }
      catch (e) { console.error(e); fail(res, 500, e.message); }
    });
  };
}

// The public demo runs this file in a service worker (mock/browser) and calls handler() directly.
if (!globalThis.__ECHO_DEMO__) {
  for (const port of [DATALOAD_PORT, BACKEND_PORT]) {
    http.createServer(handler(port)).listen(port, () => console.log(`[echo-mock] listening on http://localhost:${port}`));
  }
  console.log(`[echo-mock] ${agents.length} agents, ${campaigns.length} campaigns, ${calls.length} calls. Sign in with any email and password.`);
}
export { handler };
