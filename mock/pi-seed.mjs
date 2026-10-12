// PI Industries pilot workspace for the local mock (Sprint ECHO-26Q4-S0: ECHO-140 agent, ECHO-206 access).
// The agent uses the generic Input file settings (PRD-ECHO-19): one file row per purchase order line,
// rows grouped by supplier code, at most 8 rows per call, one answer per row. All names, numbers and codes are synthetic.
import { groupedCampaign, day } from './rows-seed.mjs';

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
      row_columns: ['po_number', 'item', 'pending_qty', 'due_date'], order_by: 'due_date', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: 'rows',
      // Rows settings added with the rethink: how a row is said, a time limit, what makes a row the same row next time, and long lists.
      say_as: '{item}, {pending_qty} pending', max_minutes: 10, identity: ['po_number'], remember: true, list_style: 'one_by_one', check_in_after: 5,
      skip: [{ column: 'pending_qty', op: 'is', value: '0' }] },
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
  // The caller hung up after the third row. Each row was saved as it was answered, so three are kept and two are asked on the next try.
  { code: 'SUP-1007', name: 'Supplier G Labels', lines: [['Label 60x40', 5000, { last: 'scheduled, 5000 on the 9th' }], ['Label 100x70', 3000], ['Hologram seal', 12000], ['Sleeve 250ml', 8000], ['Sleeve 500ml', 6000],
      ['Tamper band', 9000, { skip: 'Settled on the last upload: dispatched in full' }]],
    calls: [{ final: { status: 'completed', result: 'disconnected_early', attempts: 1 }, dropped: { next_attempt_in_min: 35 },
      out: [{ dispatch_status: 'rescheduled', lots: '5000@+6', delay_reason: 'Plate change', date_change_count: 2 }, { dispatch_status: 'scheduled', lots: '3000@+2' }, { dispatch_status: 'dispatched', dispatched_qty: 12000, dispatch_date: '-2', lr_or_invoice: 'LR-90417' }] }] },
  { code: 'SUP-1006', name: 'Supplier F Films', lines: [['Laminate roll', 90], ['Pouch 1kg', 12000]], calls: [{ final: { status: 'retry_exhausted', reason: 'no_answer', attempts: 3 }, out: null }] },
];

export function piCampaign(now, uuid) {
  const po = (i, n) => `45000${String(1000 + i * 20 + n).padStart(5, '0')}/${(n + 1) * 10}`;
  return groupedCampaign(now, {
    id: `pi-packaging-follow-up-${uuid}`, name: 'PI packaging follow up - week 40', agent: 'pi_packaging_followup', org_id: 'org_pi', source: 'internal', description: 'Pilot batch 1',
    contacts: SUPPLIERS, phonePrefix: '90000002', did: PI_ROUTE.did, callPrefix: '40715920', statusKey: 'dispatch_status', dateKeys: ['lots', 'ready_date', 'estimate_date', 'dispatch_date'],
    rowValues: (i, n, item, qty, created) => ({ po_number: po(i, n), item, pending_qty: String(qty), due_date: day(created, n - 1).split('-').reverse().join('/') }),
    callValues: (s, i, phone) => ({ supplier_code: s.code, supplier_name: s.name, contact_person: 'Test Contact', phone_number: phone, plant: `Plant ${1 + (i % 2)}` }),
    callAnswers: (answers, covered) => ({ call_result: 'completed', rows: answers, rows_covered: covered, next_followup_date: answers.map((l) => l.estimate_date).filter(Boolean).sort()[0] || '',
      escalate_to: answers.some((l) => /quality|disputed/.test(l.dispatch_status)) ? 'quality' : answers.some((l) => l.dispatch_status === 'artwork_hold') ? 'buyer' : 'none',
      supplier_verbatim: answers.find((l) => l.supplier_says)?.supplier_says || '' }),
    say: (s, items) => [`Namaste, main Hetal, PI Industries packaging procurement se. Kya meri baat ${s.name} se ho rahi hai?`, `Aapke ${items.length} open rows hain. Pehla: ${items[0].values.item}, pending ${items[0].values.pending_qty}. Dispatch plan kya hai?`],
  });
}
