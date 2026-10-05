// End to end status sanity check: Ozonetel -> Echo -> Clarix, on the paired local mocks.
//
// Part A: every Ozonetel value through Echo's two mapping layers (PRD-ECHO-11 call status and the
//         PRD-ECHO-19 outcome word the screens show), against the expected status.
// Part B: ten scenarios uploaded in Clarix, dialled by Echo with exact scripted Ozonetel results
//         (POST /__mock/dial-script), state transitions polled through the APIs, then every row and
//         campaign compared between Echo and Clarix.
// Part C: agent sync, names, validation, pagination, counts, export.
//
// Usage: node mock/e2e-status.mjs [outDir]   (Echo mock on ECHO_API, Clarix mock on CLARIX_API, both MOCK_BEHAVIOUR=target)
import { writeFileSync, mkdirSync } from 'node:fs';
import { simulate, mapAttempt, shouldRetry, RETRY } from './ozonetel.mjs';
import { dialFacts, outcomeOf, retryAgain, DEFAULT_RETRY } from './outcome.mjs';

const ECHO = process.env.ECHO_API || 'http://localhost:18090';
const CLARIX = process.env.CLARIX_API || 'http://localhost:18081';
const OUT = process.argv[2] || './e2e-status';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = []; // { area, severity, title, detail, evidence }
const finding = (area, severity, title, detail, evidence = '') => findings.push({ area, severity, title, detail, evidence });
const checks = [];
const check = (part, name, pass, detail = '') => { checks.push({ part, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${part}] ${name}${detail ? '  ' + detail : ''}`); };

// ── Part A: mapping matrix ───────────────────────────────────────────────────
// Expected PRD-ECHO-11 call status for each provider case (the spec this run checks against).
const B_TO_A = { rejected: 'rejected', completed: 'completed', caller_hung_up: 'completed', no_reply: 'completed', voicemail: 'completed', call_dropped: 'completed', no_answer: 'no_answer', busy: 'busy',
  unreachable: 'unreachable', wrong_number: 'invalid_number', blocked: 'blocked', network_error: 'failed' };
const sim = (kind, result, over = {}) => { const s = simulate({ kind, result, seed: `mx:${kind}:${result}`, startedAt: '2026-10-05T06:00:00Z' }); Object.assign(s.provider, over.provider || {}); if (over.stream !== undefined) s.stream = over.stream; if (over.talk !== undefined) { s.talk_seconds = over.talk; s.provider.TalkTime = s.provider.CallDuration = `00:00:${String(over.talk).padStart(2, '0')}`; } return s; };
const CASES = [
  ['Answered, full conversation', sim('answered', 'conversation'), 'completed', 'conversation'],
  ['Answered, caller silent (picked up, no speech)', sim('answered', 'no_response'), 'completed', 'no_response'],
  ['Answered, caller hung up before final confirmation', sim('answered', 'disconnected_early'), 'completed', 'disconnected_early'],
  ['Answered, voicemail', sim('answered', 'voicemail'), 'completed', 'voicemail'],
  ['Answered by Ozonetel, agent never joined', sim('answered', 'technical_drop'), 'completed', 'technical_drop'],
  ['Answered, short talk (3 s) but a real exchange', sim('answered', 'conversation', { talk: 3, stream: { connected: true, agent_turns: 3, caller_turns: 2, caller_speech_seconds: 2, voicemail_detected: false, agent_finished: true } }), 'completed', 'conversation'],
  ['Busy', sim('busy'), 'busy'],
  ['NoResponse', sim('no_response'), 'no_answer'],
  ['Rang out (ring)', sim('ring_out'), 'no_answer'],
  ['DialStatus not_answered only', sim('ring_out', null, { provider: { CustomerStatus: '' } }), 'no_answer'],
  ['NormalUnspecified', sim('normal_unspecified'), 'no_answer'],
  ['InvalidNumber', sim('invalid_number'), 'invalid_number'],
  ['InvalidNumberFormat', sim('invalid_format'), 'invalid_number'],
  ['SubscriberAbsent (Ozonetel spelling SubcriberAbsent)', sim('subscriber_absent'), 'unreachable'],
  ['NoRouteDestination', sim('no_route'), 'unreachable'],
  ['Congestion (provider error)', sim('congestion'), 'failed'],
  ['Exception (provider error)', sim('exception'), 'failed'],
  ['ISDDisabled (PRD-ECHO-11 rule 9: Failed)', sim('isd_disabled'), 'failed'],
  ['Explicit block (DND)', sim('ring_out', null, { provider: { DialStatus: 'not_answered', CustomerStatus: 'DND' } }), 'blocked'],
  ['Unknown provider value', sim('ring_out', null, { provider: { DialStatus: 'mystery', CustomerStatus: 'FooBar' } }), 'failed'],
  ['Conflict: NotAnswered with TalkTime > 0', sim('no_response', null, { provider: { TalkTime: '00:00:07' } }), 'no_answer'],
  ['Conflict: Ozonetel NotAnswered but Echo heard the caller', sim('answered', 'conversation', { provider: { Status: 'NotAnswered', DialStatus: 'not_answered', CustomerStatus: 'NoResponse' } }), 'completed', 'conversation'],
];
const matrix = [];
for (const [name, s, wantStatus, wantResult] of CASES) {
  const m = mapAttempt(s);
  const f = dialFacts('ozonetel', s.provider, s.stream);
  const word = outcomeOf(f);
  const aOk = m.status === wantStatus && (!wantResult || m.result === wantResult);
  const bOk = B_TO_A[word] === wantStatus;
  // Live dialling decides with the outcome word but never retries PRD never-reasons (unknown value, ISDDisabled).
  const retryA = shouldRetry(m, 1), retryB = retryAgain(word, 1, DEFAULT_RETRY) && !RETRY.never_reasons.includes(m.reason);
  matrix.push({ case: name, ozonetel_status: s.provider.Status, dial_status: s.provider.DialStatus, customer_status: s.provider.CustomerStatus, duration: s.provider.Duration, talk_time: s.provider.TalkTime,
    expected: wantStatus + (wantResult ? ` / ${wantResult}` : ''), echo_call_status: m.status, echo_reason_result: m.result || m.reason || '', anomalies: (m.anomalies || []).join(' '),
    screen_word: word, retry_status_layer: retryA, retry_screen_layer: retryB, status_ok: aOk, screen_ok: bOk, retry_consistent: retryA === retryB });
  check('A', `${name}: call status`, aOk, `${m.status}${m.result ? '/' + m.result : ''}${m.reason ? ' (' + m.reason + ')' : ''}`);
  check('A', `${name}: screen word matches status`, bOk, word);
  if (retryA !== retryB) check('A', `${name}: retry decision consistent`, false, `status layer ${retryA}, screen layer ${retryB}`);
}
const rejected = mapAttempt(sim('ring_out', null, { provider: { CustomerStatus: 'Rejected' } }));
check('A', 'Explicit rejection maps to Rejected (Ozonetel sends none today; other providers may)', rejected.status === 'rejected', `${rejected.status} (${rejected.reason})`);
const unk = mapAttempt(sim('ring_out', null, { provider: { CustomerStatus: 'FooBar' } }));
check('A', 'Unknown CustomerStatus with DialStatus not_answered is logged, not No Answer', unk.status === 'failed' && unk.anomalies.some((x) => /UNKNOWN_PROVIDER_VALUE/.test(x)), `${unk.status}; ${unk.anomalies.join(' ')}`);
for (const [cs, st, rs, an] of [['FooBar', unk.status, unk.reason, unk.anomalies.join(' ')], ['Rejected', rejected.status, rejected.reason, '']]) {
  matrix.push({ case: `CustomerStatus ${cs} with DialStatus not_answered`, ozonetel_status: 'NotAnswered', dial_status: 'not_answered', customer_status: cs, duration: '', talk_time: '', expected: cs === 'Rejected' ? 'rejected' : 'failed (logged)',
    echo_call_status: st, echo_reason_result: rs, anomalies: an, screen_word: outcomeOf(dialFacts('ozonetel', { Status: 'NotAnswered', DialStatus: 'not_answered', CustomerStatus: cs }, null)), status_ok: st === (cs === 'Rejected' ? 'rejected' : 'failed'), screen_ok: true, retry_consistent: true });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
let token = '';
const eurl = (p, q = {}) => `${ECHO}${p}?${new URLSearchParams({ token, ...q })}`;
const eget = async (p, q) => (await fetch(eurl(p, q))).json();
const epost = async (p, body, q) => { const r = await fetch(eurl(p, q), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); const t = await r.text(); return { status: r.status, body: t ? JSON.parse(t) : {} }; };
const CH = { Authorization: 'Bearer e2e', countryId: '356' };
const cget = async (p) => { const r = await fetch(CLARIX + p, { headers: CH }); return r.json(); };
const cpost = async (p, body, form) => { const r = await fetch(CLARIX + p, { method: 'POST', headers: form ? CH : { ...CH, 'Content-Type': 'application/json' }, body: form || JSON.stringify(body || {}) }); return r.json(); };

token = (await (await fetch(`${ECHO}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'local-test' }) })).json()).access_token;
check('B', 'Echo sign in', !!token);

// ── Part B: scenarios through Clarix -> Echo -> Clarix ───────────────────────
const TEMPLATE = (await cget('/api/v1/workflow-templates?page=0&size=50')).data.find((t) => t.providerAgentId === 'priya_rfx_quote_agent');
check('B', 'Clarix template mapped to an Echo agent', !!TEMPLATE, TEMPLATE?.name);
const FIELDS = TEMPLATE.contextMappings.map((m) => m.fieldName);
let phoneN = 7000001000;
const SCEN = [
  { id: 'S1', name: 'Successful call', rows: [[['answered', 'conversation']]], expect: { rows: ['completed'], campaign: 'completed' } },
  { id: 'S2', name: 'No Answer + retry', rows: [[['ring_out'], ['ring_out'], ['ring_out']]], expect: { rows: ['retry_exhausted'], campaign: 'completed', retrySeen: true, attempts: [3] } },
  { id: 'S3', name: 'Busy + retry, then answered', rows: [[['busy'], ['busy'], ['answered', 'conversation']]], expect: { rows: ['completed'], campaign: 'completed', retrySeen: true, attempts: [3] } },
  { id: 'S4', name: 'Invalid Number, no retry', rows: [[['invalid_number']]], expect: { rows: ['invalid_number'], campaign: 'completed', attempts: [1] } },
  { id: 'S5', name: 'Unreachable', rows: [[['subscriber_absent'], ['no_route'], ['subscriber_absent']]], expect: { rows: ['retry_exhausted'], campaign: 'completed', attempts: [3] } },
  { id: 'S6', name: 'Technical failure (provider exception)', rows: [[['exception'], ['congestion'], ['exception']]], expect: { rows: ['retry_exhausted'], campaign: 'completed', attempts: [3] } },
  { id: 'S7', name: 'Mixed results -> Completed', rows: [[['answered', 'conversation']], [['answered', 'disconnected_early'], ['answered', 'disconnected_early'], ['answered', 'disconnected_early']], [['invalid_format']], [['answered', 'voicemail'], ['answered', 'conversation']], [['busy'], ['answered', 'no_response'], ['answered', 'conversation']]],
    expect: { rows: ['completed', 'completed', 'invalid_number', 'completed', 'completed'], campaign: 'completed' } },
  { id: 'S8', name: 'Unprocessed calls -> Partially Completed (stopped in Echo)', rows: Array.from({ length: 14 }, () => [['answered', 'conversation']]), stopEchoAfterMs: 450, expect: { campaign: 'partially_completed' } },
  { id: 'S9', name: 'Campaign cancellation (stopped before any dial)', rows: Array.from({ length: 3 }, () => [['answered', 'conversation']]), stopEchoAfterMs: 0, expect: { campaign: 'cancelled', rows: ['cancelled', 'cancelled', 'cancelled'] } },
  { id: 'S10', name: 'Stop from Clarix reaches Echo (ECHO-162)', rows: Array.from({ length: 10 }, () => [['answered', 'conversation']]), stopClarixAfterMs: 450, expect: { campaign: 'partially_completed' } },
];
const plan = {};
for (const s of SCEN) s.phones = s.rows.map((script) => { const ph = String(phoneN++); plan[ph] = script; return ph; });
const pz = { id: 'S12', name: 'Pause and resume', rows: Array.from({ length: 6 }, () => [['answered', 'conversation']]), pauseAfterMs: 450, expect: { campaign: 'completed', paused: true } };
pz.phones = pz.rows.map(() => { const ph = String(phoneN++); plan[ph] = [['answered', 'conversation']]; return ph; });
SCEN.push(pz);
const dup = { id: 'S11', name: 'Repeated phone number in one sheet', rows: [[['answered', 'conversation']], [['answered', 'conversation']]], expect: { rows: ['completed', 'input_validation_failed'], outcomes: ['completed', 'repeated_number'] } };
dup.phones = ['7000009999', '7000009999']; plan['7000009999'] = [['answered', 'conversation'], ['answered', 'conversation']];
SCEN.push(dup);
const scripted = await epost('/__mock/dial-script', { plan, fast: true });
check('B', 'Scripted Ozonetel results queued (fast timers)', scripted.status === 200, JSON.stringify(scripted.body));

const csv = (phones) => [['name', 'phone', ...FIELDS].join(','), ...phones.map((ph, i) => [`E2E Row ${i + 1}`, ph, ...FIELDS.map((f) => (/date/.test(f) ? '05/11/2026' : /count/.test(f) ? '2' : `${f}-value`))].join(','))].join('\n');
async function upload(s) {
  const fd = new FormData();
  fd.append('templateId', TEMPLATE.id);
  fd.append('file', new Blob([csv(s.phones)], { type: 'text/csv' }), `${s.id}-${s.name.replace(/\W+/g, '-')}.csv`);
  fd.append('columnMapping', JSON.stringify({ contact: { phone: 'phone', name: 'name' }, fields: Object.fromEntries(FIELDS.map((f) => [f, f])) }));
  return cpost('/api/v1/workflows/trigger/bulk', null, fd);
}
const ORGS = ['org_moglix', 'org_pi'];
async function echoCampaignFor(sheetId) {
  for (let i = 0; i < 40; i++) {
    for (const org of ORGS) { const l = await eget('/api/campaigns', { org_id: org }); const c = (l.campaigns || []).find((x) => x.clarix_batch_id === sheetId || String(x.campaign_id).includes(sheetId)); if (c) return { ...c, org }; }
    await sleep(50);
  }
  return null;
}
const TERMINAL_CAMPAIGN = new Set(['completed', 'partially_completed', 'cancelled', 'failed']);
const evidence = [];
await Promise.all(SCEN.map(async (s) => {
  const up = await upload(s);
  s.sheetId = up.data?.sessionId;
  const camp = await echoCampaignFor(s.sheetId);
  s.campaignId = camp?.campaign_id; s.org = camp?.org;
  if (!camp) { check('B', `${s.id} Echo campaign created from the Clarix sheet`, false); return; }
  if (s.stopEchoAfterMs !== undefined) { await sleep(s.stopEchoAfterMs); await epost(`/api/campaigns/${s.campaignId}/stop`, {}, { org_id: s.org }); }
  if (s.stopClarixAfterMs !== undefined) { await sleep(s.stopClarixAfterMs); await cpost(`/api/v1/workflows/sheets/${s.sheetId}/stop`); }
  if (s.pauseAfterMs !== undefined) {
    await sleep(s.pauseAfterMs);
    const pr = await epost(`/api/campaigns/${s.campaignId}/pause`, {}, { org_id: s.org });
    await sleep(700);
    const mid = await eget(`/api/campaigns/${s.campaignId}`, { org_id: s.org });
    const dials = async () => ((await eget(`/api/campaigns/${s.campaignId}/contacts`, { org_id: s.org })).contacts || []).reduce((n, r) => n + (r.attempts || 0), 0);
    const dialsA = await dials(); await sleep(1500); const dialsB = await dials();
    const clarixMid = (await cget(`/api/v1/workflows/sheets/${s.sheetId}`)).data?.campaignStatus;
    s.pauseInfo = { pauseHttp: pr.status, statusWhilePaused: mid.status, dialsA, dialsB, clarixMid };
    await epost(`/api/campaigns/${s.campaignId}/resume`, {}, { org_id: s.org });
  }
  // Poll states until the campaign is terminal (or 40 s), recording every transition per row and for the campaign.
  s.seen = {}; s.campSeen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const c = await eget(`/api/campaigns/${s.campaignId}`, { org_id: s.org });
    const st = c.status || c.campaign?.status;
    if (s.campSeen.at(-1) !== st) s.campSeen.push(st);
    const rows = (await eget(`/api/campaigns/${s.campaignId}/contacts`, { org_id: s.org })).contacts || [];
    rows.forEach((r, i) => { const k = `${i}`; (s.seen[k] ||= []); if (s.seen[k].at(-1) !== r.status) s.seen[k].push(r.status); });
    if (TERMINAL_CAMPAIGN.has(st) && rows.every((r) => !['pending', 'queued', 'dialled', 'calling', 'in_progress', 'retry_scheduled'].includes(r.status))) break;
    await sleep(200);
  }
  await sleep(600); // let the last webhook reach Clarix
  s.campaignStatus = s.campSeen.at(-1);
  s.rowsFinal = (await eget(`/api/campaigns/${s.campaignId}/contacts`, { org_id: s.org })).contacts || [];
  s.details = await Promise.all(s.rowsFinal.map((r) => eget(`/api/campaigns/${s.campaignId}/contacts/${r.primary_id}`, { org_id: s.org })));
  s.clarix = ((await cget(`/api/v1/workflows?batchId=${s.sheetId}&page=0&size=200`)).data || []);
  s.sheet = (await cget(`/api/v1/workflows/sheets/${s.sheetId}`)).data;
}));

for (const s of SCEN) {
  if (!s.campaignId) continue;
  const label = `${s.id} ${s.name}`;
  if (s.expect.campaign) check('B', `${label}: Echo campaign status`, s.campaignStatus === s.expect.campaign, `${s.campSeen.join(' -> ')} (expected ${s.expect.campaign})`);
  (s.expect.rows || []).forEach((want, i) => {
    const r = s.rowsFinal[i];
    check('B', `${label}: row ${i + 1} call status`, r?.status === want, `${(s.seen[i] || []).join(' -> ')} (expected ${want}; screen: ${r?.outcome})`);
  });
  (s.expect.outcomes || []).forEach((want, i) => check('B', `${label}: row ${i + 1} shown as`, s.rowsFinal[i]?.outcome === want, `${s.rowsFinal[i]?.outcome}`));
  if (s.expect.paused) {
    const pi = s.pauseInfo || {};
    check('B', `${label}: Running -> Paused (no new dials while paused) -> Running -> Completed`, pi.statusWhilePaused === 'paused' && pi.dialsA === pi.dialsB && s.campaignStatus === 'completed', JSON.stringify(pi));
    check('B', `${label}: Clarix shows Paused while Echo is paused`, String(pi.clarixMid || '').toUpperCase() === 'PAUSED', String(pi.clarixMid));
  }
  if (s.expect.retrySeen) check('B', `${label}: Retry Scheduled seen between attempts`, Object.values(s.seen).some((l) => l.includes('retry_scheduled')), (s.seen[0] || []).join(' -> '));
  (s.expect.attempts || []).forEach((n, i) => check('B', `${label}: row ${i + 1} attempts`, s.details[i]?.attempts === n, `${s.details[i]?.attempts}`));
  // Echo <-> Clarix: every row and the campaign.
  const byId = new Map(s.clarix.map((e) => [e.id, e]));
  let mism = 0;
  s.rowsFinal.forEach((r, i) => {
    const d = s.details[i] || {};
    const e = byId.get(r.primary_id) || [...byId.values()].find((x) => x.resolvedContact?.phone === r.phone && !x._used);
    if (e) e._used = true;
    const echoStatus = String(r.status === 'captured' || r.status === 'disconnected_early' ? 'completed' : r.status).toUpperCase();
    const clarixCall = e?.callStatus || e?.conversation?.callStatus || null;
    const ok = clarixCall === echoStatus && (e?.outcome || null) === (r.outcome || null);
    if (!ok) mism++;
    const lastA = (d.attempt_log || []).slice(-1)[0] || {};
    evidence.push({ scenario: s.id, row: i + 1, phone: r.phone, ozonetel_status: lastA.provider?.Status || r.last_provider?.Status || '', dial_status: lastA.provider?.DialStatus || r.last_provider?.DialStatus || '', customer_status: lastA.provider?.CustomerStatus || r.last_provider?.CustomerStatus || '',
      duration_s: (lastA.ring_seconds ?? 0) + (lastA.talk_seconds ?? 0), talk_time_s: lastA.talk_seconds ?? 0, echo_call_status: r.status, echo_reason_outcome: [r.call_result, r.reason, r.outcome].filter(Boolean).join(' / '),
      retry: `${d.attempts ?? r.attempts ?? 0} dial(s)${(s.seen[i] || []).includes('retry_scheduled') ? ', retried' : ''}`, transitions: (s.seen[i] || []).join(' > '), echo_campaign_status: s.campaignStatus,
      clarix_call_status: clarixCall || '(none)', clarix_workflow_status: e?.status || '(none)', clarix_outcome: e?.outcome || '', match: ok ? 'yes' : 'NO' });
  });
  check('B', `${label}: every Clarix row equals Echo (call status and outcome)`, mism === 0, `${mism} of ${s.rowsFinal.length} differ`);
  check('B', `${label}: Clarix campaign status equals Echo's`, String(s.sheet?.campaignStatus || '').toLowerCase() === s.campaignStatus, `Echo ${s.campaignStatus}; Clarix ${s.sheet?.campaignStatus || 'not stored'}`);
  check('B', `${label}: no Clarix row left in progress after Echo finished`, !(TERMINAL_CAMPAIGN.has(s.campaignStatus) && (s.sheet?.inProgressCount || 0) > 0), `Clarix in progress ${s.sheet?.inProgressCount}`);
}

// ── Part C: sync, names, validation, pagination, counts, export ──────────────
const ORG = { org_id: 'org_moglix' };
const label = `E2E Sync Agent ${Date.now() % 100000}`;
const created = await epost('/api/agents', { label, copy_from: 'priya_rfx_quote_agent' }, ORG);
const key = created.body.agent?.key;
check('C', 'Copy an agent in Echo', created.status === 201, key);
check('C', 'Copied agent is not marked Synced before any push', !created.body.agent?.sync_status, String(created.body.agent?.sync_status));
await epost(`/api/agents/${key}/sync`, { platform_key: 'clarix' }, ORG); await sleep(500);
const a1 = (await eget(`/api/agents/${key}`, ORG)).agent;
let tpls = (await cget('/api/v1/workflow-templates?page=0&size=100')).data;
let t1 = tpls.find((t) => t.providerAgentId === key);
check('C', 'Sync creates the Clarix agent setup', !!t1 && a1.sync_status === 'synced', `${a1.sync_status}; Clarix setup ${t1?.id || 'missing'}`);
check('C', 'Clarix shows the correct agent name', t1?.name === label, `${t1?.name}`);
await fetch(eurl(`/api/agents/${key}`, ORG), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: label + ' renamed' }) }); await sleep(500);
tpls = (await cget('/api/v1/workflow-templates?page=0&size=100')).data; t1 = tpls.find((t) => t.providerAgentId === key);
const a2 = (await eget(`/api/agents/${key}`, ORG)).agent;
check('C', 'Rename in Echo reaches Clarix (no stale name)', t1?.name === label + ' renamed', `${t1?.name}`);
check('C', 'Sync state is fresh after the change (not stale Synced)', a2.sync_status === 'synced' && Date.parse(a2.synced_at) >= Date.parse(a2.updated_at) - 1000, `${a2.sync_status} synced_at ${a2.synced_at} updated_at ${a2.updated_at}`);
const providerList = (await cget('/api/v1/call-providers/exchange/campaigns')).data || [];
check('C', 'Clarix Provider Agent ID list includes the new Echo agent', providerList.some((x) => x.id === key), `${providerList.length} agents listed`);
await fetch(eurl(`/api/agents/${key}`, ORG), { method: 'DELETE' }); await sleep(400);
tpls = (await cget('/api/v1/workflow-templates?page=0&size=100')).data; t1 = tpls.find((t) => t.providerAgentId === key);
check('C', 'Delete in Echo reaches Clarix (setup archived or flagged)', !t1 || /archiv|inactive|deleted/i.test(t1.status || ''), t1 ? `Clarix setup still ${t1.status}` : 'removed');

const c1 = await epost('/api/campaigns', { agent: 'priya_rfx_quote_agent' }, ORG), c2 = await epost('/api/campaigns', { agent: 'priya_rfx_quote_agent' }, ORG);
const list = (await eget('/api/campaigns', ORG)).campaigns;
const n1 = list.find((x) => x.campaign_id === c1.body.campaign_id)?.name, n2 = list.find((x) => x.campaign_id === c2.body.campaign_id)?.name;
check('C', 'Two campaigns created together get different names', n1 !== n2, `${n1} | ${n2}`);
check('C', 'A new empty campaign is Ready', list.find((x) => x.campaign_id === c1.body.campaign_id)?.status === 'ready', list.find((x) => x.campaign_id === c1.body.campaign_id)?.status);

// Clarix validation
const bad = new FormData();
bad.append('templateId', TEMPLATE.id);
bad.append('file', new Blob([['name,phone,' + FIELDS.join(','), 'Bad phone,12345,' + FIELDS.map(() => 'x').join(','), 'Missing field,7000008888,' + FIELDS.map((f, i) => (i === 0 ? '' : 'x')).join(',')].join('\n')], { type: 'text/csv' }), 'bad.csv');
bad.append('columnMapping', JSON.stringify({ contact: { phone: 'phone', name: 'name' }, fields: Object.fromEntries(FIELDS.map((f) => [f, f])) }));
const vr = (await cpost('/api/v1/workflows/trigger/bulk', null, bad)).data;
check('C', 'Clarix rejects a bad phone and a missing required field before dialling', vr?.failed === 2 && vr?.triggered === 0, JSON.stringify(vr?.failedRows));
const sheetsAfter = (await cget('/api/v1/workflows/sheets?page=0&size=200')).data || [];
const emptyCampaign = sheetsAfter.find((x) => x.id === vr?.sessionId);
check('C', 'A sheet with no valid rows does not leave an empty campaign behind', !emptyCampaign || emptyCampaign.total === 0, emptyCampaign ? `campaign ${emptyCampaign.id} kept with 0 calls` : 'none');

// Pagination
const p0 = await cget('/api/v1/workflows/sheets?page=0&size=3'), p1 = await cget('/api/v1/workflows/sheets?page=1&size=3');
const ids0 = (p0.data || []).map((x) => x.id), ids1 = (p1.data || []).map((x) => x.id);
check('C', 'Clarix campaigns pagination: pages differ and total is reported', ids0.length === 3 && ids1.length > 0 && !ids0.some((x) => ids1.includes(x)) && p0.totalElements > 3, `page0 ${ids0.length}, page1 ${ids1.length}, total ${p0.totalElements}`);

// Counts: Calls placed and failed calls, Clarix vs Echo, for the sheets made in this run
const sum = (await cget('/api/v1/workflows/dashboard/org-summary')).data || {};
const runRows = SCEN.flatMap((s) => s.rowsFinal || []);
const dialled = runRows.filter((r) => (r.attempts || 0) > 0).length;
const runClarix = SCEN.flatMap((s) => s.clarix || []);
const clarixPlaced = runClarix.filter((e) => (e.attemptLog?.length || 0) > 0).length;
check('C', 'Clarix Calls placed counts only rows Echo dialled', clarixPlaced === dialled, `this run: Clarix placed ${clarixPlaced}, Echo dialled ${dialled}, rows ${runClarix.length}; org summary callsPlaced ${sum.callsPlaced}`);
const echoFailed = runRows.filter((r) => r.outcome_group === 'failed').length;
const clarixFailed = runClarix.filter((e) => e.outcomeGroup === 'failed').length;
check('C', 'Failed call count matches (Echo failed group vs Clarix)', echoFailed === clarixFailed, `Echo ${echoFailed}, Clarix ${clarixFailed}; Clarix workflow FAILED ${runClarix.filter((e) => e.status === 'FAILED').length} (includes no answer, busy, invalid)`);

// Export and campaign actions
const s1 = SCEN[0];
const ex = await fetch(eurl(`/api/campaigns/${s1.campaignId}/export.zip`, { org_id: s1.org }));
check('C', 'Export of a finished campaign downloads', ex.status === 200 && /zip/.test(ex.headers.get('content-type') || ''), `${ex.status} ${ex.headers.get('content-type')}`);
const rerun = await epost(`/api/campaigns/${s1.campaignId}/dial`, {}, { org_id: s1.org });
check('C', 'Run again on a completed campaign does not dial anyone', (rerun.body.dialled || 0) === 0, `dialled ${rerun.body.dialled}`);

// Campaign-level failure: the calling flow is turned off in Settings, then a sheet is uploaded.
// The UI refuses to turn off a flow an agent uses, so the failure is a flow that disappeared at the provider.
const agentNow = (await eget('/api/agents/priya_rfx_quote_agent', ORG)).agent;
const putAgent = (body) => fetch(eurl('/api/agents/priya_rfx_quote_agent', ORG), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
await putAgent({ ozonetel_campaign: 'FLOW_REMOVED_AT_PROVIDER' });
const sf = { id: 'S13', name: 'Campaign failure (calling flow gone at the provider)', phones: ['7000007001', '7000007002'] };
const upf = await upload(sf); const campF = await echoCampaignFor(upf.data?.sessionId); await sleep(800);
const cf = campF ? await eget(`/api/campaigns/${campF.campaign_id}`, { org_id: campF.org }) : {};
const sheetF = (await cget(`/api/v1/workflows/sheets/${upf.data?.sessionId}`)).data;
check('C', 'Running -> Failed is campaign level (calling flow off) and Clarix shows Failed', cf.status === 'failed' && String(sheetF?.campaignStatus || '').toUpperCase() === 'FAILED', `Echo ${cf.status}; Clarix ${sheetF?.campaignStatus}`);
await putAgent({ ozonetel_campaign: agentNow.ozonetel_campaign });
const callRow = (SCEN[0].rowsFinal || []).find((r) => r.call_id);
const an = callRow ? await epost(`/api/calls/${callRow.call_id}/analyze`, {}, { org_id: SCEN[0].org }) : { status: 0 };
check('C', 'Re-analyze a finished call works (no Not Found)', an.status === 200, `HTTP ${an.status}${callRow ? '' : ' (no call id on the row)'}`);

// ── Report ───────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.pass);
writeFileSync(`${OUT}/e2e-status-report.json`, JSON.stringify({ at: new Date().toISOString(), echo: ECHO, clarix: CLARIX, checks, matrix, evidence, scenarios: SCEN.map((s) => ({ id: s.id, name: s.name, sheet: s.sheetId, campaign: s.campaignId, campaign_transitions: s.campSeen, expected: s.expect })) }, null, 1));
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed; ${failed.length} failed`);
