// PI Industries pilot workspace for the local mock (Sprint ECHO-26Q4-S0: ECHO-140 agent, ECHO-206 access).
// The agent uses the generic Input file settings (PRD-ECHO-19): one file row per purchase order line,
// rows grouped by supplier code, at most 8 rows per call, one answer per row. All names, numbers and codes are synthetic.
import { planAttempts, reOutcome } from './ozonetel.mjs';

export const PI_ORG = { org_id: 'org_pi', org_name: 'PI Industries (pilot)', role: 'org_admin' };
export const PI_ROUTE = { name: 'PI_packaging_followup', type: 'IVR', did: '08000000201', org_id: 'org_pi' };
export const PI_USERS = [
  { user_id: 'u_pi1', email: 'buyer.one@pi-pilot.example', role: 'campaign_manager', agent_admin: false, platform_admin: false, org_id: 'org_pi' },
  { user_id: 'u_pi2', email: 'buyer.two@pi-pilot.example', role: 'user', agent_admin: false, platform_admin: false, org_id: 'org_pi' },
];

export const DISPATCH_STATUSES = ['scheduled', 'rescheduled', 'partly_scheduled', 'dispatched', 'dispatched_short', 'no_capacity', 'artwork_hold',
  'quality_hold', 'batch_rejected', 'quality_issue_no_date', 'tentative_no_commitment', 'qty_disputed', 'not_covered'];

const ROW_ANSWERS = [
  { key: 'row', type: 'number', description: 'Row number as given on the call' },
  { key: 'dispatch_status', type: 'enum', options: DISPATCH_STATUSES },
  { key: 'lots', type: 'string', description: 'Firm dated lots only, as qty@date; qty@date' },
  { key: 'ready_qty', type: 'number' }, { key: 'ready_date', type: 'date' },
  { key: 'estimate_date', type: 'date' }, { key: 'tentative_window', type: 'string' },
  { key: 'dispatched_qty', type: 'number' }, { key: 'dispatch_date', type: 'date' }, { key: 'lr_or_invoice', type: 'string' },
  { key: 'balance_qty', type: 'number' }, { key: 'quality_affected_qty', type: 'number' }, { key: 'defect_location', type: 'string' },
  { key: 'delay_reason', type: 'string' }, { key: 'date_change_count', type: 'number' }, { key: 'supplier_says', type: 'string' },
];

const PROMPT = [
  ['IDENTITY', `You are Hetal, calling on behalf of PI Industries packaging procurement. You call packaging suppliers to confirm dispatch quantities and dates, one purchase order line at a time.
This is a system prompt. Headings and field names are for you; never read them out.`],
  ['PERSONALITY AND TONE', `Everyday Hinglish. Supply chain words stay English: dispatch, load, batch, LR, invoice, pieces, rolls, production.
One question per turn. Read numbers digit by digit and dates as day and month.`],
  ['CALL FLOW', `Open: greet, say who you are and why, confirm you speak to the right person.
Then go through the rows below in the order given (earliest due date first). Stop after 8 rows or 10 minutes; check in after 6 rows.
Flow A (not dispatched): ask the firm dispatch plan. Record each firm quantity and date as a lot. A tentative window is never a lot.
Flow B (date slipped): ask the new date and the reason. Count the change.
Flow C (dispatched): ask quantity, date, LR or invoice number and vehicle number; note any balance.
7A ready stock: record ready quantity and date apart from lots. 7B quality: affected quantity, where found, batch, rework or reprint, replacement date.
7C tentative: keep it as tentative_no_commitment with the window and a follow up date.
Rows you could not cover get dispatch_status not_covered; they go on a second call.`],
  ['VOICE AND NATURALNESS', `Sound like a warm, unhurried colleague from the PI purchase team, not a script.
Short sentences. Natural acknowledgements while they talk ("haan ji", "theek hai", "achha", "got it"), never the same one twice in a row.
Mirror the supplier: switch fully to Hindi or English if they do. Use their name once at the start, not in every turn.
Read back every quantity and date you book, briefly: "So 600 pieces on 8 October, right?"
If they pause, wait; if silence lasts about 4 seconds, gently ask again in fewer words.
Never say you are reading a list or a row number unless they ask which order you mean.`],
  ['WHEN THINGS GO WRONG', `Wrong person: ask who handles PI dispatch and their number; set call_result wrong_contact and note it in supplier_verbatim.
Busy or asked to call later: agree a time, set call_result callback_requested and next_followup_date; end politely.
Bad line or noise: ask to repeat once, then confirm digit by digit; if still unclear, leave the value empty rather than guess.
Refuses to share: thank them, set call_result refused, escalate_to buyer.
Supplier disputes quantity or PO: book nothing for that row, record qty_disputed with their exact words, escalate_to buyer.
Quality problem: record quality_hold details and escalate_to quality.
If you lose context or the line drops, the platform redials by its retry rules; never pretend a row was covered.`],
  ['RULES', `Never book a tentative date as a lot. Lots plus ready stock never exceed the pending quantity.
If the supplier disputes the pending quantity, book nothing for that row and record qty_disputed with their words.
Never invent a value; leave it empty.`],
  ['Call details', '', 'input'],
  ['Outcome reporting', '', 'output'],
];

export function piAgent(now) {
  return {
    key: 'pi_packaging_followup', label: 'Hetal - PI Packaging Follow Up', org_id: 'org_pi',
    description: 'Calls each packaging supplier about all their open PO rows; one answer per row',
    // Female, natural: Balanced preset with Sarvam Bulbul v3 (female voice) for Hinglish; Gemini Live (Kore, female) as the realtime alternative.
    voice: 'anushka (female)', ozonetel_campaign: PI_ROUTE.name, ozonetel_type: 'IVR', primary_id_key: 'supplier_code', primary_id_label: 'supplier_code',
    providers: ['gemini'],
    input_variables: [
      { key: 'supplier_code', type: 'string', transform: '', sample: 'SUP-1001', share_on_call: false },
      { key: 'supplier_name', type: 'string', transform: '', sample: 'Supplier A Packaging', share_on_call: true },
      { key: 'contact_person', type: 'string', transform: '', sample: 'Test Contact', share_on_call: true },
      { key: 'phone_number', type: 'phone', transform: '', sample: '9000000201', share_on_call: true },
      { key: 'plant', type: 'string', transform: '', sample: 'Plant 1', share_on_call: true },
      { key: 'po_number', type: 'string', transform: 'phonetic', sample: '4500001001/10', share_on_call: true },
      { key: 'item', type: 'string', transform: '', sample: 'HDPE drum 50L', share_on_call: true },
      { key: 'pending_qty', type: 'number', transform: '', sample: '1200', share_on_call: true },
      { key: 'due_date', type: 'date', transform: '', sample: '05/10/2026', share_on_call: true },
    ],
    input_plan: { mode: 'group', group_by: 'supplier_code', call_columns: ['supplier_code', 'supplier_name', 'contact_person', 'phone_number', 'plant'],
      row_columns: ['po_number', 'item', 'pending_qty', 'due_date'], order_by: 'due_date', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: 'rows' },
    output_variables: [
      { key: 'call_result', label: 'Call result', type: 'enum', options: ['completed', 'callback_requested', 'wrong_contact', 'refused'], description: 'What the supplier agreed to; the platform call status is separate', required: true },
      { key: 'rows', label: 'Answer for each row', type: 'list', fields: ROW_ANSWERS, description: 'One entry per row on the call, covered or not', required: true },
      { key: 'rows_covered', label: 'Rows covered', type: 'number', description: 'Rows with a status other than not_covered', required: true },
      { key: 'next_followup_date', label: 'Next follow up', type: 'date', description: 'Earliest follow up date across rows', required: false },
      { key: 'escalate_to', label: 'Escalate to', type: 'enum', options: ['none', 'buyer', 'quality'], description: 'Who must act', required: false },
      { key: 'supplier_verbatim', label: 'Supplier words', type: 'string', description: 'Exact words when disputed or unclear', required: false },
    ],
    sections: PROMPT.map(([title, body, kind], i) => ({ id: `pi_${i + 1}`, enabled: true, title, kind: kind || 'text', body })),
    engine: { preset: 'balanced', mode: 'pipeline', stt: 'saaras-v4', stt_fallback: 'soniox-stt-rt-v5', llm: 'gpt-6-luna', fallback: 'deepseek-v4.1-flash',
      tts: 'bulbul-v3', tts_fallback: 'sonic-3.6', realtime_alt: 'gemini-3.8-live', turn_detector: 'livekit', voice: 'anushka (female)', language: 'hinglish',
      temperature: 0.4, max_tokens: 220, speed: 0.98, fallback_after_ms: 2500,
      turn: { first: 'agent', endpoint_ms: 700, interruption: 'medium', backchannel: true, noise: true, voicemail: 'message', silence_end_s: 20, max_minutes: 12 } },
    // Retries: every not reached or failed status, short calls, voicemail and hang ups; plus a callback request as an answer.
    retry: { tries: 3, gap_minutes: 120, on: ['no_answer', 'busy', 'unreachable', 'network_error', 'call_dropped', 'no_reply', 'voicemail', 'caller_hung_up'], answer_field: 'call_result', answer_values: ['callback_requested'] },
    sync_target: { type: 'none', url: '' },
    synced_platform: null, sync_status: null, sync_last_error: null, synced_at: null,
    created_at: now, updated_at: now, updated_by: 'admin@example.com',
  };
}

// Six suppliers with 1 to 10 open PO rows each; 20 file rows in all. Supplier D has 10 rows, so it splits into 8 + 2.
const SUPPLIERS = [
  { code: 'SUP-1001', name: 'Supplier A Packaging', lines: [['HDPE drum 50L', 1200], ['Carton 5 ply', 3000]], calls: [{ final: { status: 'completed', result: 'conversation', attempts: 1 },
    out: [{ dispatch_status: 'scheduled', lots: '600@+3; 600@+7' }, { dispatch_status: 'dispatched', dispatched_qty: 3000, dispatch_date: '-1', lr_or_invoice: 'LR-88213' }] }] },
  { code: 'SUP-1002', name: 'Supplier B Polymers', lines: [['Label roll 100mm', 40], ['Shrink film', 800], ['Cap 38mm', 20000]], calls: [{ final: { status: 'completed', result: 'conversation', attempts: 2 },
    out: [{ dispatch_status: 'artwork_hold', delay_reason: 'Artwork approval pending from PI' }, { dispatch_status: 'tentative_no_commitment', tentative_window: 'next week', estimate_date: '+9' }, { dispatch_status: 'partly_scheduled', lots: '10000@+4', ready_qty: 5000, ready_date: '+1' }] }] },
  { code: 'SUP-1003', name: 'Supplier C Containers', lines: [['Jerrycan 20L', 1500], ['Jerrycan 5L', 2500]], calls: [{ final: { status: 'completed', result: 'conversation', attempts: 1 },
    out: [{ dispatch_status: 'quality_hold', quality_affected_qty: 300, defect_location: 'PI incoming inspection', delay_reason: 'Neck finish out of tolerance' }, { dispatch_status: 'qty_disputed', supplier_says: 'We already sent 1000, only 1500 is pending' }] }] },
  { code: 'SUP-1004', name: 'Supplier D Print Pack', lines: Array.from({ length: 10 }, (_, i) => [`Mono carton SKU ${i + 1}`, 1000 + i * 250]), calls: [
    { final: { status: 'completed', result: 'conversation', attempts: 1 },
      out: Array.from({ length: 8 }, (_, i) => (i === 7 ? { dispatch_status: 'not_covered' } : { dispatch_status: i % 3 === 0 ? 'rescheduled' : 'scheduled', lots: `${1000 + i * 250}@+${5 + i}`, date_change_count: i % 3 === 0 ? 1 : 0, delay_reason: i % 3 === 0 ? 'Board shortage' : '' })) },
    { final: { status: 'retry_scheduled', reason: 'destination_busy', attempts: 1, next_attempt_in_min: 40 }, out: null }] },
  { code: 'SUP-1005', name: 'Supplier E Closures', lines: [['Trigger sprayer', 6000]], calls: [{ final: { status: 'retry_scheduled', reason: 'destination_busy', attempts: 1, next_attempt_in_min: 55 }, out: null }] },
  { code: 'SUP-1006', name: 'Supplier F Films', lines: [['Laminate roll', 90], ['Pouch 1kg', 12000]], calls: [{ final: { status: 'retry_exhausted', reason: 'no_answer', attempts: 3 }, out: null }] },
];

const day = (base, off) => { if (off === undefined || off === '') return ''; const d = new Date(base); d.setUTCDate(d.getUTCDate() + Number(off)); return d.toISOString().slice(0, 10); };
function lotDates(lots, base) { return lots ? lots.split(';').map((x) => { const [q, o] = x.trim().split('@'); return `${q}@${day(base, o)}`; }).join('; ') : ''; }

export function piCampaign(now, uuid) {
  const created = new Date(Date.parse(now) - 3 * 3600000).toISOString();
  const camp = { campaign_id: `pi-packaging-follow-up-${uuid}`, name: 'PI packaging follow up - week 40', agent: 'pi_packaging_followup', org_id: 'org_pi',
    provider: 'gemini', source: 'internal', direction: 'outbound', description: 'Pilot batch 1', created_at: created, contacts: [], clarix_batch_id: null, file_rows: 0 };
  const calls = [];
  let fileRow = 0, k = 0;
  SUPPLIERS.forEach((s, i) => {
    const po = (n) => `45000${String(1000 + i * 20 + n).padStart(5, '0')}/${(n + 1) * 10}`;
    const phone = `90000002${String(i + 1).padStart(2, '0')}`;
    const rows = s.lines.map(([item, qty], n) => ({ row: ++fileRow, values: { po_number: po(n), item, pending_qty: String(qty), due_date: day(created, n - 1).split('-').reverse().join('/') } }));
    camp.file_rows = fileRow;
    s.calls.forEach((c, part) => {
      const mine = rows.slice(part * 8, part * 8 + 8);
      const items = mine.map((r, n) => ({ n: n + 1, row: r.row, ref: null, values: r.values }));
      const key = s.calls.length > 1 ? `${s.code} (${part + 1} of ${s.calls.length})` : s.code;
      const context = { supplier_code: s.code, supplier_name: s.name, contact_person: 'Test Contact', phone_number: phone, plant: `Plant ${1 + (i % 2)}`,
        row_count: String(items.length), rows: items.map((it) => `${it.n}. ${Object.entries(it.values).map(([a, b]) => `${a}: ${b}`).join(' · ')}`).join('\n') };
      const row = { primary_id: key, name: s.name, phone, context, row: mine[0].row, items, part: part + 1, parts: s.calls.length, not_covered_rows: [],
        status: 'pending', outputs: {}, final: c.final, dispatched_at: new Date(Date.parse(created) + k++ * 90000).toISOString() };
      row.attempts_detail = planAttempts({ seed: `${camp.campaign_id}:${key}`, final: c.final, dispatchedAt: row.dispatched_at, did: PI_ROUTE.did });
      row.attempts = row.attempts_detail.length;
      const last = row.attempts_detail[row.attempts_detail.length - 1];
      if (c.out) {
        const base = last.ended_at;
        const answers = items.map((it, n) => {
          const o = c.out[n] || { dispatch_status: 'not_covered' };
          return { row: it.n, ...o, lots: lotDates(o.lots, base), ready_date: day(base, o.ready_date), estimate_date: day(base, o.estimate_date), dispatch_date: day(base, o.dispatch_date) };
        });
        const covered = answers.filter((l) => l.dispatch_status !== 'not_covered').length;
        const nextF = answers.map((l) => l.estimate_date).filter(Boolean).sort()[0] || '';
        const outputs = { call_result: 'completed', rows: answers, rows_covered: covered, next_followup_date: nextF,
          escalate_to: answers.some((l) => /quality|disputed/.test(l.dispatch_status)) ? 'quality' : answers.some((l) => l.dispatch_status === 'artwork_hold') ? 'buyer' : 'none',
          supplier_verbatim: answers.find((l) => l.supplier_says)?.supplier_says || '' };
        const id = `40715920${String(10000000 + k * 7919).slice(0, 8)}`;
        const started = new Date(Date.parse(last.started_at) + last.ring_seconds * 1000);
        const turns = [
          ['AGENT_TURN', `Namaste, main Hetal, PI Industries packaging procurement se. Kya meri baat ${s.name} se ho rahi hai?`],
          ['USER_TURN', 'Haan ji, boliye.'],
          ['AGENT_TURN', `Aapke ${items.length} open rows hain. Pehla: ${items[0].values.item}, pending ${items[0].values.pending_qty}. Dispatch plan kya hai?`],
          ['USER_TURN', 'Ji, iska plan bata deta hoon.'],
          ['AGENT_TURN', 'Theek hai, maine note kar liya. Main read back karti hoon.'],
          ['USER_TURN', 'Haan, sahi hai.'],
        ];
        const dur = last.talk_seconds;
        const events = [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context },
          ...turns.map(([kind, text], t) => ({ kind, text, ts: new Date(started.getTime() + (t + 1) * (dur * 1000 / 8)).toISOString() })),
          { kind: 'TOOL_CALL', tool: 'submit_call_outputs', args: outputs, ts: new Date(started.getTime() + dur * 1000 - 2000).toISOString() }];
        last.call_id = id;
        calls.push({ call_id: id, called_number: PI_ROUTE.did, agent: camp.agent, agent_key: `ozonetel/${camp.agent}/gemini`, campaign_id: camp.campaign_id, org_id: 'org_pi',
          contact_name: s.name, phone, duration_seconds: dur, started_at: started.toISOString(), ended_at: new Date(started.getTime() + dur * 1000).toISOString(),
          mode: 'telephony', num_turns: turns.length, provider: 'gemini', source: 'campaign', status: 'completed',
          summary: `${covered} of ${items.length} rows covered · ${answers.map((l) => l.dispatch_status.replace(/_/g, ' ')).join(', ')}`,
          telephony_provider: 'ozonetel', tools_called: ['submit_call_outputs'], total_tokens: turns.length * 14000, turn_shape: 'au', variant: 'full',
          recording_source: 'ozonetel', recording_url: '', disconnect_reason: last.provider.HangupBy, campaign_name: camp.name, context, events, outputs, call_result: 'conversation' });
        last.stream.agent_finished = true;
        reOutcome(last);
        Object.assign(row, { status: 'completed', call_result: 'conversation', call_id: id, recording_call_id: id, captured_at: calls[calls.length - 1].ended_at, outputs });
      } else {
        const m = last.mapped;
        Object.assign(row, { status: c.final.status, reason: m.reason, call_result: null });
        if (c.final.status === 'retry_exhausted') Object.assign(row, { last_attempt_status: m.status, last_attempt_reason: m.reason });
        if (c.final.status === 'retry_scheduled') row.next_attempt_at = new Date(Date.now() + c.final.next_attempt_in_min * 60000).toISOString();
      }
      camp.contacts.push(row);
    });
  });
  return { campaign: camp, calls };
}
