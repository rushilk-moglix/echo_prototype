// Builds mock/scenario.json: one set of invented sample data that both local mocks
// (Echo here, Clarix in its own repo) load, so a batch Clarix submits and the Echo
// campaign it becomes show the same rows, as they do live.
//
// Nothing here is real. Names, numbers, emails and ids are generated. The shape and
// the proportions follow what the live products showed on 29 Sep 2026: batches that
// stay running because unanswered calls never report back, completed calls where the
// supplier never spoke, repeated numbers, a malformed number, free text outcomes.
//
// Run: node mock/build-scenario.mjs   (then copy scenario.json to the Clarix repo)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let seed = 20260929;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
const oid = () => '6a' + hex(22);

const FIRST = ['Arun', 'Kavita', 'Deepak', 'Sunita', 'Rakesh', 'Meena', 'Vivek', 'Pooja', 'Sanjay', 'Neha', 'Manoj', 'Ritu', 'Ajay', 'Seema', 'Harish', 'Anjali', 'Naveen', 'Geeta', 'Rohit', 'Swati', 'Mahesh', 'Asha', 'Dinesh', 'Lata', 'Kiran', 'Prakash', 'Usha', 'Gaurav', 'Shalini', 'Vikas'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Mehta', 'Gupta', 'Reddy', 'Nair', 'Joshi', 'Iyer', 'Kulkarni', 'Agarwal', 'Chauhan', 'Desai', 'Rao', 'Bansal', 'Saxena', 'Pillai', 'Shah', 'Malhotra', 'Bhatt'];
const FIRM = ['Shree Ganesh Engineering', 'Om Sai Industrial Supplies', 'Precision Fasteners', 'Bharat Hydraulics', 'Surya Pumps and Valves', 'Kaveri Bearings', 'Apex Safety Gear', 'Vardhman Tools', 'Nandi Electricals', 'Sahyadri Castings', 'Trident Seals', 'Ganga Abrasives', 'Delta Fluid Systems', 'Everest Cables', 'Pioneer Gaskets', 'Sterling Motors', 'Lotus Lubricants', 'Metro Pipes and Fittings', 'Crown Instruments', 'Orbit Packaging'];
const ITEMS = ['Mechanical Items', 'Safety Gloves;Face Shield', 'Bearing 6205 ZZ', 'Gate Valve 2 inch;Flange Gasket', 'Hydraulic Hose Assembly', 'MCB 32A;Cable Lugs', 'Grinding Wheel 7 inch', 'Pump Mechanical Seal', 'V Belt B-52;Pulley', 'Hex Bolt M16 x 60'];
const PLANTS = ['North Smelter Plant', 'West Refinery Works', 'Central Cement Unit', 'Coastal Power Station'];
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const usedPhones = new Set();
const phone = () => { let p; do { p = String(pick([6, 7, 8, 9])) + String(int(100000000, 999999999)); } while (usedPhones.has(p)); usedPhones.add(p); return p; };
const email = (name, firm) => `${name.split(' ')[0].toLowerCase()}.${hex(3)}@${firm.split(' ')[0].toLowerCase()}-example.com`;
const poNumbers = (n) => Array.from({ length: n }, () => String(int(2010000, 2014999)));
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

// Operators who upload in Clarix (invented).
const OPERATORS = ['ops.buyer1@example.com', 'ops.buyer2@example.com', 'demo.admin@example.com', 'ops.lead@example.com', 'category.manager@example.com'];

// ── Agents, as Echo lists them ──────────────────────────────────────────────
const PO_INPUTS = [
  ['contact_name', 'string', '', 'Kavita Mehta', true], ['contact_phone', 'phone', '', '9000012345', true],
  ['contact_email', 'string', '', 'kavita@supplier-example.com', false], ['plant_name', 'string', '', 'North Smelter Plant', true],
  ['po_count', 'number', '', '1', true], ['po_numbers', 'string', 'phonetic', '2014147', true],
  ['item_count', 'number', '', '1', true], ['item_details', 'string', '', 'Mechanical Items', true],
  ['po_date', 'date', '', '26/09/2026', true], ['target_dispatch_date', 'date', '', '18/12/2026', true],
  ['current_date', 'date', '', '29/09/2026', true],
].map(([key, type, transform, sample, share]) => ({ key, type, transform, sample, share_on_call: share }));

const PO_STATUSES = ['Acknowledged for PO Acceptance', 'Call Back required by Ops', 'No Response', 'Not Aligned for Dialler Calling', 'PO Copy/ Mail Not Received', 'ETA Available/ Shared', 'Technical Clarification Required', 'Material Ready for Dispatch', 'PO Rejected', 'Voicemail'];
const PO_OUTPUTS = [
  { key: 'status', label: 'Outcome Status', type: 'enum', options: PO_STATUSES, description: 'Overall outcome of the call', required: true },
  { key: 'po_acceptance_intent', label: 'Supplier Intent', type: 'enum', options: ['ACCEPTED', 'WILL_ACCEPT', 'PENDING_QUERY', 'REJECTED', 'UNKNOWN'], description: 'What the supplier intends to do with the PO', required: true },
  { key: 'eta_confirmation_received', label: 'ETA confirmation', type: 'boolean', options: [], description: 'Did the supplier confirm a dispatch date', required: true },
  { key: 'callback_time', label: 'Callback Time', type: 'string', options: [], description: 'Time the supplier asked to be called back, HH:MM', required: false },
  { key: 'detailed_remarks', label: 'Detailed Remarks', type: 'string', options: [], description: 'Two to four sentences on what was said', required: true },
  { key: 'accepted_po_count', label: 'POs Accepted', type: 'number', options: [], description: 'How many POs were accepted', required: true },
  { key: 'accepted_po_numbers', label: 'POs Accepted (Numbers)', type: 'string', options: [], description: 'Comma separated PO numbers accepted', required: false },
  { key: 'dispatch_schedule', label: 'Dispatch Schedule', type: 'string', options: [], description: 'PO:YYYY-MM-DD pairs', required: false },
  { key: 'rejected_po_numbers', label: 'POs Rejected (numbers)', type: 'string', options: [], description: 'Comma separated PO numbers rejected', required: false },
  { key: 'escalate_to', label: 'Escalate To', type: 'string', options: [], description: 'Team to escalate to, if any', required: false },
  { key: 'callback_date', label: 'Callback Date', type: 'string', options: [], description: 'Date the supplier asked to be called back, YYYY-MM-DD', required: false },
];

const RFX_INPUTS = [
  ['contact_name', 'string', '', 'Deepak Rao', true], ['contact_phone', 'phone', '', '9000054321', true], ['contact_email', 'string', '', 'deepak@supplier-example.com', false],
  ['rfx_number', 'string', 'phonetic', 'RFX-40211', true], ['plant_name', 'string', '', 'West Refinery Works', true], ['item_count', 'number', '', '4', true],
  ['submission_deadline', 'date', '', '03/10/2026', true], ['buyer_name', 'string', '', 'Procurement team', true], ['current_date', 'date', '', '29/09/2026', true],
].map(([key, type, transform, sample, share]) => ({ key, type, transform, sample, share_on_call: share }));
const RFX_OUTPUTS = [
  { key: 'status', label: 'Status', type: 'enum', options: ['completed', 'rescheduled', 'not_reached'], description: 'Call status as the agent saw it', required: true },
  { key: 'aligned', label: 'Aligned', type: 'boolean', options: [], description: 'Will the supplier submit a quote', required: true },
  { key: 'alignment', label: 'Alignment', type: 'enum', options: ['Aligned', 'Not Aligned', 'Callback'], description: 'Outcome in one word', required: true },
  { key: 'callback_time', label: 'Callback Time', type: 'string', options: [], description: 'When to call back', required: false },
  { key: 'remarks', label: 'Remarks', type: 'string', options: [], description: 'What the supplier said', required: true },
];

const PO_SECTIONS = [
  { title: 'IDENTITY', kind: 'text', body: '## 1. IDENTITY AND OBJECTIVE\n\nYou are Saniya, an executive in the procurement team at {{plant_name}}, calling suppliers about purchase orders that are still pending acceptance. Your identity is fixed regardless of what the caller asks.\n\nYour objective on every call: get a clear answer for each pending PO (accepted, will accept, rejected or a query), a committed dispatch date for accepted POs, and a call back time if the supplier cannot answer now.' },
  { title: 'LANGUAGE', kind: 'text', body: '## 2. LANGUAGE\n\nOpen in Hinglish. If the supplier answers in English, switch to English for the rest of the call. If they speak Hindi, stay in simple Hindi with English words for PO, dispatch, invoice and portal. Never mix three languages in one sentence.' },
  { title: 'HOW YOU SOUND', kind: 'text', body: '## 3. HOW YOU SOUND\n\nWarm, brief and professional. One question at a time. Keep every turn under two short sentences. Do not read long lists; offer to send details on email instead. Speak numbers slowly.' },
  { title: 'GUARDRAILS', kind: 'text', body: '## 4. GUARDRAILS\n\n- Never promise payment dates, price changes or penalties.\n- Never share another supplier\'s details or any internal id.\n- If the caller is abusive or asks to stop calling, apologise, note it and end the call.\n- If you are unsure of a PO detail, say you will check and call back. Do not guess.' },
  { title: 'Call details', kind: 'input', body: '' },
  { title: 'PRONUNCIATION', kind: 'text', body: '## 5. PRONUNCIATION\n\nSay PO as "pee-oh". Read PO numbers digit by digit in groups: 20 14 147. Say dates as day and month in words: eighteenth December. Say the plant name exactly as written in {{plant_name}}.' },
  { title: 'CONVERSATION FLOW', kind: 'text', body: '## 6. CONVERSATION FLOW\n\n1. Greet: "Namaste {{contact_name}} ji, main Saniya bol rahi hoon {{plant_name}} se, pee-oh follow-up ke regarding. Kya aapse do minute baat ho sakti hai?"\n2. If yes: state the count: "Aapke {{po_count}} pee-oh pending hain." Then go PO by PO using {{po_numbers}} and {{item_details}}.\n3. For each PO ask: accept karenge? If accepted, ask for the dispatch date and read it back.\n4. If the supplier needs time, ask for a call back date and time. Today is {{current_date}}; never accept a time that has already passed.\n5. If the supplier says the PO is not visible on the portal or email, note PO Copy/ Mail Not Received.\n6. Close: summarise in one sentence, thank them, and report the outcome before ending.' },
  { title: 'INTERRUPTIONS AND SILENCE', kind: 'text', body: '## 7. INTERRUPTIONS AND SILENCE\n\nIf the supplier talks over you, stop and listen. Treat "haan", "ji", "hmm" as acknowledgements, not interruptions. After 6 seconds of silence ask once: "Kya aap mujhe sun pa rahe hain?" After 10 more seconds, end politely and report No Response.' },
  { title: 'EDGE CASES', kind: 'text', body: '## 8. EDGE CASES\n\n- Wrong person: ask for the right contact\'s name and number, report Not Aligned for Dialler Calling.\n- Voicemail or an automated message: do not leave details, end and report Voicemail.\n- Supplier asks you to hold: wait up to 30 seconds once, then offer a call back.\n- Rate or quantity dispute: note it in remarks and set escalate_to to purchase_team.' },
  { title: 'EXAMPLES', kind: 'text', body: '## 9. EXAMPLES\n\nSupplier: "Haan ji, pee-oh mil gaya, accept kar denge."\nYou: "Dhanyavaad. Dispatch kab tak ho payega?"\nSupplier: "Bees November tak."\nYou: "Theek hai, bees November. Main note kar rahi hoon."' },
  { title: 'Outcome reporting', kind: 'output', body: '' },
  { title: 'REMINDER', kind: 'text', body: '## 10. REMINDER\n\nAlways call submit_call_outputs exactly once before ending the call, even when nothing was agreed.' },
];
const RFX_SECTIONS = [
  { title: 'IDENTITY', kind: 'text', body: '## IDENTITY\n\nYou are Priya from the procurement team, calling suppliers who were invited to quote on {{rfx_number}} and have not submitted yet.' },
  { title: 'Call details', kind: 'input', body: '' },
  { title: 'FLOW', kind: 'text', body: '## FLOW\n\n1. Greet and confirm you are speaking to {{contact_name}}.\n2. Remind them of {{rfx_number}} for {{item_count}} items, due {{submission_deadline}}.\n3. Ask if they will submit. If not, ask why in one question.\n4. If they need time, agree a call back.' },
  { title: 'Outcome reporting', kind: 'output', body: '' },
];

const voices = (provider) => provider === 'gemini'
  ? [['Aoede', 'Female'], ['Charon', 'Male'], ['Fenrir', 'Male'], ['Kore', 'Female'], ['Leda', 'Female'], ['Orus', 'Male'], ['Puck', 'Male'], ['Zephyr', 'Female']]
  : [['Ara', 'Female'], ['Rex', 'Male'], ['Sal', 'Neutral'], ['Eve', 'Female'], ['Leo', 'Male']];

const mkAgent = (key, label, o) => ({
  key, label, description: o.description || '', voice: o.voice || '', ozonetel_campaign: o.ozn ?? 'PAAS_postpo', ozonetel_type: o.ozn === '' ? '' : 'IVR',
  primary_id_key: o.primary || 'contact_phone', primary_id_label: o.primary || 'contact_phone', providers: ['gemini', 'grok'],
  input_variables: o.inputs, output_variables: o.outputs,
  sections: o.sections.map((s, i) => ({ id: `sec_${i + 1}`, enabled: true, ...s })),
  synced_platform: o.synced ? 'clarix' : null, sync_status: o.synced ? 'synced' : null, sync_last_error: null,
  created_at: o.created,
});

const now = new Date('2026-09-29T07:30:00Z'); // anchor; the server shifts every date so "today" is today
const ago = (h) => new Date(now.getTime() - h * 3600e3).toISOString();

const agents = [
  mkAgent('23_september_copy_of_sanity_3_0', '23 September - Copy of Sanity 3.0', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, created: ago(150) }),
  mkAgent('hetal_pii_followup_agent', 'Hetal - PII Followup Agent', { inputs: [...PO_INPUTS, ...RFX_INPUTS.slice(3, 7)], outputs: [...PO_OUTPUTS, ...RFX_OUTPUTS, ...PO_OUTPUTS.slice(0, 8)].slice(0, 24).map((v, i) => ({ ...v, key: i < 11 ? v.key : `${v.key}_${i}` })), sections: PO_SECTIONS.slice(0, 6), primary: 'phone_number', created: ago(400) }),
  mkAgent('meera_2_0_rfx_quote_reminder', 'Meera 2.0 - RFX Quote Reminder', { inputs: RFX_INPUTS, outputs: RFX_OUTPUTS, sections: RFX_SECTIONS, created: ago(700) }),
  mkAgent('postpo_agent_saniya', 'PostPO Agent - Saniya', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, created: ago(500) }),
  mkAgent('priya_rfx_quote_agent', 'Priya - RFX Quote Agent', { inputs: RFX_INPUTS, outputs: RFX_OUTPUTS, sections: RFX_SECTIONS, synced: true, ozn: 'RFX_reminder', created: ago(110) }),
  mkAgent('saaniya3_0_post_po_acceptance', 'Saaniya3.0 Post PO Acceptance', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, created: ago(300) }),
  mkAgent('saniya_post_po_clarix', 'Saniya - POST PO - Clarix', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, synced: true, created: ago(160) }),
  mkAgent('saniya_postpo_agent', 'Saniya - PostPO Agent', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, created: ago(600) }),
  mkAgent('sarah_english_post_po', 'Sarah - English Post PO', { inputs: [...PO_INPUTS, { key: 'buyer_name', type: 'string', transform: '', sample: 'Procurement team', share_on_call: true }, { key: 'po_value', type: 'number', transform: '', sample: '48500', share_on_call: true }], outputs: PO_OUTPUTS.slice(0, 7), sections: PO_SECTIONS, created: ago(350) }),
  mkAgent('september_22_copy_of_saniya_post_po_clarix', 'September 22 - Copy of Saniya Post PO - Clarix', { inputs: PO_INPUTS, outputs: PO_OUTPUTS, sections: PO_SECTIONS, created: ago(170) }),
];

// ── Call scripts ────────────────────────────────────────────────────────────
function poScript(kind, c, t0) {
  const ev = [];
  let ts = t0.getTime() + 2000;
  const say = (who, text) => { ev.push({ kind: who === 'a' ? 'AGENT_TURN' : 'USER_TURN', text, ts: new Date(ts).toISOString() }); ts += int(3500, 9000); };
  const greet = `Namaste ${c.name.split(' ')[0]} ji, main Saniya bol rahi hoon ${c.context.plant_name} se, pee-oh follow-up ke regarding. Aapke ${c.context.po_count} pee-oh pending hain, kya aapse do minute baat ho sakti hai?`;
  let out = null;
  const po = c.context.po_numbers.split(', ');
  if (kind === 'silent') { say('a', greet); }
  else if (kind === 'voicemail') {
    say('a', greet); say('u', 'The number you have called is not answering. Please leave a message after the tone.'); say('a', 'Theek hai, main baad mein call karungi.');
    out = { status: 'No Response', po_acceptance_intent: 'UNKNOWN', eta_confirmation_received: false, accepted_po_count: 0, detailed_remarks: 'The call reached voicemail after the greeting. No contact was made with the supplier.' };
  } else if (kind === 'dropped') {
    say('a', greet); say('u', 'Haan boliye.'); say('a', `Pee-oh number ${po[0]} ke baare mein, ${c.context.item_details} ke liye. Kya aap ise accept karenge?`); say('u', 'Ek minute, main check karta hoon...');
    for (let i = 0; i < int(0, 5); i++) { say('a', 'Ji, main line par hoon.'); say('u', 'Haan... ek second.'); }
  } else if (kind === 'accepted') {
    const d = `${int(10, 28)}/${pick(['10', '11', '12'])}/2026`;
    say('a', greet); say('u', 'Haan ji boliye.'); say('a', `Pee-oh ${po[0]}, ${c.context.item_details}. Kya aap ise accept karenge?`); say('u', 'Haan, accept kar denge, portal par dekh liya hai.');
    say('a', 'Dhanyavaad. Dispatch kab tak ho payega?'); say('u', `${d} tak bhej denge.`); say('a', `Theek hai, ${d}. Main note kar rahi hoon. Aapka din shubh ho.`);
    ev.push({ kind: 'TOOL_CALL', tool: 'submit_call_outputs', ts: new Date(ts).toISOString(), args: out = { status: 'ETA Available/ Shared', po_acceptance_intent: 'ACCEPTED', eta_confirmation_received: true, accepted_po_count: po.length, accepted_po_numbers: po.join(','), dispatch_schedule: po.map((p) => `${p}:2026-${d.split('/')[1]}-${d.split('/')[0]}`).join(', '), detailed_remarks: `Supplier confirmed acceptance for ${po.length === 1 ? 'the pending PO' : 'all pending POs'} and committed to dispatch by ${d}. The date was read back and confirmed.` } });
    return { events: ev, outputs: out, turns: 7 };
  } else if (kind === 'callback') {
    const when = pick(['11:00', '15:30', '17:00']);
    say('a', greet); say('u', 'Abhi meeting mein hoon, kal call kijiye.'); say('a', `Bilkul. Kal kis samay call karun?`); say('u', `Kal ${when} baje.`); say('a', `Theek hai, kal ${when} baje call karungi. Dhanyavaad.`);
    out = { status: 'Call Back required by Ops', po_acceptance_intent: 'WILL_ACCEPT', eta_confirmation_received: false, accepted_po_count: 0, callback_time: when, callback_date: new Date(t0.getTime() + 86400e3).toISOString().slice(0, 10), detailed_remarks: 'Supplier was busy and asked for a call back tomorrow to confirm acceptance after checking the portal.' };
  } else if (kind === 'not_visible') {
    say('a', greet); say('u', 'Kaunsa pee-oh? Humare paas aisa koi order nahi aaya.'); say('a', `Pee-oh ${po[0]}, ${c.context.po_date} ka hai. Kya aap email check kar sakte hain?`); say('u', 'Nahi dikha. Aap email par bhej dijiye.'); say('a', 'Theek hai, main team ko bol deti hoon. Dhanyavaad.');
    out = { status: 'PO Copy/ Mail Not Received', po_acceptance_intent: 'PENDING_QUERY', eta_confirmation_received: false, accepted_po_count: 0, rejected_po_numbers: 'unidentified', detailed_remarks: 'Supplier could not find the PO on email or the portal and asked for a copy to be sent before confirming.' };
  } else if (kind === 'wrong_person') {
    say('a', greet); say('u', 'Main accounts se hoon, sales wale abhi nahi hain.'); say('a', 'Kya aap sales contact ka naam aur number bata sakte hain?'); say('u', 'Aap email par likh dijiye.');
    out = { status: 'Not Aligned for Dialler Calling', po_acceptance_intent: 'UNKNOWN', eta_confirmation_received: false, accepted_po_count: 0, detailed_remarks: 'The person who answered was not the sales contact and asked for the request on email.' };
  } else if (kind === 'drift') {
    say('a', greet); say('u', 'Pichhle order ka payment abhi tak nahi aaya, isliye naya order hold par hai.'); say('a', 'Samajh gayi. Main purchase team ko bata deti hoon.'); say('u', 'Haan, pehle woh clear kijiye.');
    out = { status: 'Issue in working with Moglix', po_acceptance_intent: 'PENDING_QUERY', eta_confirmation_received: false, accepted_po_count: 0, escalate_to: 'purchase_team', detailed_remarks: 'Supplier is holding the new PO until an earlier payment issue is resolved. Escalated to the purchase team.' };
  }
  if (out) ev.push({ kind: 'TOOL_CALL', tool: 'submit_call_outputs', ts: new Date(ts).toISOString(), args: out });
  return { events: ev, outputs: out, turns: ev.filter((e) => e.kind !== 'TOOL_CALL').length };
}

function rfxScript(kind, c, t0) {
  const ev = []; let ts = t0.getTime() + 2000;
  const say = (who, text) => { ev.push({ kind: who === 'a' ? 'AGENT_TURN' : 'USER_TURN', text, ts: new Date(ts).toISOString() }); ts += int(3500, 8000); };
  say('a', `Namaste ${c.name.split(' ')[0]} ji, main Priya bol rahi hoon procurement team se, ${c.context.rfx_number} ke quotation ke baare mein.`);
  let out;
  if (kind === 'aligned') { say('u', 'Haan, hum kal tak submit kar denge.'); say('a', 'Bahut badhiya, dhanyavaad.'); out = { status: 'completed', aligned: true, alignment: 'Aligned', remarks: 'Supplier confirmed they will submit the quotation on the portal by tomorrow.' }; }
  else if (kind === 'callback') { say('u', 'Approval chahiye, agle hafte call kijiye.'); say('a', 'Theek hai, agle hafte call karungi.'); out = { status: 'rescheduled', aligned: false, alignment: 'Callback', callback_time: 'next Tuesday', remarks: 'Supplier needs internal approval before quoting and asked for a call back next week.' }; }
  else { say('u', 'Payment terms theek nahi hain, hum quote nahi karenge.'); say('a', 'Samajh gayi, main team ko bata dungi.'); out = { status: 'completed', aligned: false, alignment: 'Not Aligned', remarks: 'Supplier will not quote because of the payment terms.' }; }
  ev.push({ kind: 'TOOL_CALL', tool: 'submit_call_outputs', ts: new Date(ts).toISOString(), args: out });
  return { events: ev, outputs: out, turns: ev.length - 1 };
}

// ── Batches: Clarix sheets that became Echo campaigns, plus Echo only ones ───
const templates = {
  po: { id: '6ab3b411d9325fbad665f8a4', key: 'EXCHANGE_SANIYA_POST_PO_CLARIX', name: 'Saniya - POST PO - Clarix', agent: 'saniya_post_po_clarix', file: 'EXCHANGE_SANIYA_POST_PO_CLARIX_template' },
  rfx: { id: '6ab6719a53e10feeb0acc65e', key: 'EXCHANGE_PRIYA_RFX_QUOTE_AGENT', name: 'Priya - RFX Quote Agent', agent: 'priya_rfx_quote_agent', file: 'EXCHANGE_PRIYA_RFX_QUOTE_AGENT_template' },
};

// [template, hoursAgo, uploader, mix]. Mix counts: captured kinds, dropped, silent, stuck (never reported).
const BATCHES = [
  ['po', 1.2, 1, { accepted: 1, callback: 2, not_visible: 1, voicemail: 1, dropped: 5, silent: 5, stuck: 14 }, { dupPhone: true }],
  ['po', 16, 1, { accepted: 2, callback: 3, not_visible: 1, wrong_person: 1, drift: 1, dropped: 6, silent: 4, stuck: 12 }, { dupPhone: true, badPhone: true }],
  ['po', 67.6, 1, { callback: 1, dropped: 1, silent: 1, stuck: 4 }, {}],
  ['rfx', 84.5, 2, { callback: 2 }, {}],
  ['rfx', 84.7, 2, { notaligned: 1, aligned: 0, callback: 0, rfx_notaligned2: 1 }, {}],
  ['rfx', 84.9, 2, { callback: 1, aligned: 1 }, {}],
  ['po', 114.6, 3, { accepted: 1, callback: 1, not_visible: 1, dropped: 2, silent: 2, stuck: 7 }, {}],
  ['po', 115.3, 2, { accepted: 1 }, {}],
  ['po', 115.4, 2, { silent: 1 }, {}],
];

const batches = [];
const campaigns = [];
const calls = [];
let callSeq = 0;
const callId = () => String(4071590000000000 + (++callSeq) * 7919 + int(0, 99));

function mkContact(tpl, t0, i) {
  const firm = pick(FIRM);
  const name = rnd() < 0.55 ? person() : firm;
  const nPo = rnd() < 0.7 ? 1 : int(2, 3);
  const po = poNumbers(nPo);
  const context = tpl === 'po'
    ? { plant_name: pick(PLANTS), po_count: String(nPo), po_numbers: po.join(', '), item_count: String(int(1, 14)), item_details: pick(ITEMS), po_date: ddmmyyyy(new Date(t0.getTime() - 3 * 86400e3)), target_dispatch_date: ddmmyyyy(new Date(t0.getTime() + int(20, 160) * 86400e3)), current_date: ddmmyyyy(t0) }
    : { rfx_number: `RFX-${int(40000, 49999)}`, plant_name: pick(PLANTS), item_count: String(int(2, 9)), submission_deadline: ddmmyyyy(new Date(t0.getTime() + 4 * 86400e3)), buyer_name: 'Procurement team', current_date: ddmmyyyy(t0) };
  return { primary_id: oid(), name, phone: phone(), email: email(name, firm), supplier_id: String(int(10000, 99999)), context, row: i + 1 };
}

BATCHES.forEach(([tplKey, h, op, mix, flags], bi) => {
  const tpl = templates[tplKey];
  const t0 = new Date(now.getTime() - h * 3600e3);
  const batchId = oid();
  const kinds = [];
  for (const [k, n] of Object.entries(mix)) for (let i = 0; i < n; i++) kinds.push(k);
  // Shuffle so outcomes are not grouped.
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const contacts = kinds.map((k, i) => ({ ...mkContact(tplKey, t0, i), kind: k }));
  if (flags.dupPhone && contacts.length > 4) {
    // The same supplier twice in one sheet: one stuck and one answered on the busy batch, both stuck on the other.
    const a = contacts.findIndex((c) => c.kind === 'stuck');
    const b = contacts.findIndex((c, i) => i !== a && (bi === 0 ? c.kind === 'stuck' : c.kind === 'callback'));
    if (a >= 0 && b >= 0) { contacts[b].phone = contacts[a].phone; contacts[b].name = contacts[a].name; }
  }
  if (flags.badPhone) { const s = contacts.find((c) => c.kind === 'stuck'); if (s) s.phone = '001' + String(int(4000000, 4999999)); }

  const campId = `${tpl.agent.replace(/_/g, '-')}-${batchId}-${hex(8)}`;
  const rows = contacts.map((c, i) => {
    const started = new Date(t0.getTime() + (i * 17 + int(5, 60)) * 1000 + 60e3);
    let status = 'dialled'; let call = null;
    if (c.kind !== 'stuck') {
      const kind = c.kind === 'rfx_notaligned2' ? 'notaligned' : c.kind;
      const s = tplKey === 'po' ? poScript(kind, c, started) : rfxScript(kind, c, started);
      const dur = kind === 'silent' ? int(6, 16) : kind === 'dropped' ? int(35, 115) : int(45, 175);
      const id = callId();
      const summary = s.outputs
        ? Object.entries(s.outputs).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : s.turns <= 1 ? `Agent spoke, caller never did (${Math.max(1, s.turns)} turn${s.turns === 1 ? '' : 's'})` : `Ended without a reported outcome (${s.turns} turns)`;
      const ended = new Date(started.getTime() + dur * 1000);
      call = {
        call_id: id, called_number: '0800000' + int(1000, 9999), agent: tpl.agent, agent_key: `ozonetel/${tpl.agent}/gemini`, campaign_id: campId,
        contact_name: c.name, phone: c.phone, duration_seconds: dur + Math.round(rnd() * 10) / 10, started_at: started.toISOString(), ended_at: ended.toISOString(),
        mode: 'telephony', num_turns: Math.max(1, s.turns), provider: 'gemini', source: 'campaign', status: 'completed', summary, telephony_provider: 'ozonetel',
        tools_called: s.outputs ? ['submit_call_outputs'] : [], total_tokens: Math.max(1, s.turns) * int(12500, 15500) + (s.outputs ? int(2000, 9000) : 0),
        turn_shape: s.turns <= 1 ? 'a' : 'au'.repeat(Math.ceil(s.turns / 2)).slice(0, s.turns), variant: 'full', recording_source: 'ozonetel', recording_url: '',
        disconnect_reason: s.outputs ? 'agent_end_call' : kind === 'silent' ? 'caller_hangup' : 'caller_hangup',
        campaign_name: `${tpl.name}_${batchId}`, context: { ...c.context, contact_name: c.name, contact_phone: c.phone, contact_email: c.email },
        events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context: { ...c.context, contact_name: c.name, contact_phone: c.phone } }, ...s.events],
        outputs: s.outputs,
      };
      calls.push(call);
      status = s.outputs ? 'captured' : 'disconnected_early';
    }
    return {
      primary_id: c.primary_id, name: c.name, phone: c.phone, email: c.email, supplier_id: c.supplier_id, context: c.context, row: c.row,
      status, call_id: call?.call_id || null, recording_call_id: call?.call_id || null,
      captured_at: call?.outputs ? call.ended_at : null, outputs: call?.outputs || {}, kind: c.kind,
      dispatched_at: new Date(t0.getTime() + 20e3 + i * 1000).toISOString(),
    };
  });
  const captured = rows.filter((r) => r.status === 'captured').length;
  const open = rows.some((r) => r.status === 'dialled' || r.status === 'pending');
  campaigns.push({
    campaign_id: campId, name: `${tpl.name}_${batchId}`, agent: tpl.agent, provider: 'gemini', source: 'clarix', direction: 'outbound', description: 'Submitted via clarix',
    created_at: t0.toISOString(), status: open ? 'running' : 'completed', contacts: rows, clarix_batch_id: batchId,
  });
  batches.push({ id: batchId, templateId: tpl.id, templateKey: tpl.key, templateName: tpl.name, file: `${tpl.file}${bi === 1 ? ' (1)' : ''}.csv`, uploadedBy: OPERATORS[op], createdAt: t0.toISOString(), campaignId: campId, rows });
});

// Echo only campaigns: two console tests of an agent that was later removed, and one that failed input checks.
function echoOnly(name, agent, h, desc, contactsSpec) {
  const t0 = new Date(now.getTime() - h * 3600e3);
  const rows = contactsSpec.map((kind, i) => {
    const c = mkContact('rfx', t0, i);
    if (kind === 'invalid') return { primary_id: c.phone, name: c.name, phone: c.phone, context: c.context, row: i + 1, status: 'input_validation_failed', validation_error: 'Row 2: submission_deadline is required', outputs: {}, call_id: null, recording_call_id: null, captured_at: null };
    const started = new Date(t0.getTime() + 90e3 + i * 20e3);
    const s = rfxScript(kind, c, started);
    const id = callId();
    const dur = int(80, 150);
    const call = { call_id: id, called_number: '0800000' + int(1000, 9999), agent, agent_key: `ozonetel/${agent}/gemini`, campaign_id: '', contact_name: c.name, phone: c.phone, duration_seconds: dur, started_at: started.toISOString(), ended_at: new Date(started.getTime() + dur * 1000).toISOString(), mode: 'telephony', num_turns: s.turns, provider: 'gemini', source: 'campaign', status: 'completed', summary: Object.entries(s.outputs).map(([k, v]) => `${k}: ${v}`).join(' · '), telephony_provider: 'ozonetel', tools_called: ['submit_call_outputs'], total_tokens: s.turns * int(12000, 15000), turn_shape: 'au', variant: 'full', recording_source: 'ozonetel', recording_url: '', disconnect_reason: 'agent_end_call', campaign_name: name, context: c.context, events: [{ kind: 'CALL_CONTEXT', ts: started.toISOString(), context: c.context }, ...s.events], outputs: s.outputs };
    calls.push(call);
    return { primary_id: c.phone, name: c.name, phone: c.phone, context: c.context, row: i + 1, status: 'captured', call_id: id, recording_call_id: id, captured_at: call.ended_at, outputs: s.outputs };
  });
  const campId = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}-${hex(8)}`;
  rows.forEach((r) => { const k = calls.find((x) => x.call_id === r.call_id); if (k) k.campaign_id = campId; });
  const failed = rows.every((r) => r.status === 'input_validation_failed');
  campaigns.push({ campaign_id: campId, name, agent, provider: 'gemini', source: 'internal', direction: 'outbound', description: desc, created_at: t0.toISOString(), status: failed ? 'failed' : 'completed', contacts: rows });
}
echoOnly('Priya - RFX Testing - 2026-09-25 18:19', 'priya_rfx_testing', 85.2, '', ['aligned', 'aligned']);
echoOnly('Priya - RFX Testing - 2026-09-25 18:04', 'priya_rfx_testing', 85.5, 'test 1', ['callback', 'aligned']);
echoOnly('Saniya - POST PO - Clarix - 2026-09-23 17:04', 'saniya_post_po_clarix', 134.4, 'new', ['invalid']);

campaigns.sort((a, b) => b.created_at.localeCompare(a.created_at));
calls.sort((a, b) => b.started_at.localeCompare(a.started_at));

// What the fixed backend (PRD-ECHO-11) would report for every row. Live leaves the
// unanswered ones at "dialled"; the mocks show this instead unless MOCK_BEHAVIOUR=live.
// Uses a hash of the row id, not the random stream, so earlier data never shifts.
const hash = (str) => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h / 4294967296; };
const RESULT_OF = { silent: 'no_response', voicemail: 'voicemail', dropped: 'disconnected_early' };
for (const camp of campaigns) {
  const today = now.getTime() - Date.parse(camp.created_at) < 12 * 3600e3;
  const seen = new Set();
  for (const r of camp.contacts) {
    const dup = seen.has(r.phone); seen.add(r.phone);
    const x = hash(String(r.primary_id));
    let f;
    if (r.status === 'input_validation_failed') f = { status: 'failed', reason: 'data_validation_failed', attempts: 0 };
    else if (r.status === 'captured') f = { status: 'completed', result: 'conversation', attempts: 1 };
    else if (r.status === 'disconnected_early') f = { status: 'completed', result: RESULT_OF[r.kind] || 'disconnected_early', attempts: 1 };
    else if (dup) f = { status: 'failed', reason: 'duplicate_row', attempts: 0 };
    else if (!/^[6-9]\d{9}$/.test(r.phone)) f = { status: 'invalid_number', reason: 'invalid_format', attempts: 0 };
    else if (today && x < 0.35) f = { status: 'retry_scheduled', reason: x < 0.2 ? 'no_answer' : 'busy', attempts: 1, next_attempt_in_min: 30 + Math.round(x * 300) };
    else if (x < 0.40) f = { status: 'no_answer', reason: 'no_answer', attempts: 1 };
    else if (x < 0.60) f = { status: 'retry_exhausted', reason: 'no_answer', attempts: 3 };
    else if (x < 0.78) f = { status: 'busy', reason: 'destination_busy', attempts: 1 };
    else if (x < 0.93) f = { status: 'unreachable', reason: 'subscriber_absent', attempts: 1 };
    else f = { status: 'failed', reason: 'congestion', attempts: 1 };
    r.final = f;
  }
}
for (const b of batches) for (const r of b.rows) r.final = campaigns.flatMap((c) => c.contacts).find((c) => c.primary_id === r.primary_id)?.final;
for (const c of calls) {
  const row = campaigns.flatMap((x) => x.contacts).find((r) => r.call_id === c.call_id);
  c.call_result = row?.final?.result || (c.outputs ? 'conversation' : c.num_turns <= 1 ? 'no_response' : 'disconnected_early');
}

// Two console test calls with no campaign, as live shows them.
const scenario = { anchor: now.toISOString(), agents, campaigns, calls, batches, templates, operators: OPERATORS, poOutputs: PO_OUTPUTS, rfxOutputs: RFX_OUTPUTS };
const out = join(dirname(fileURLToPath(import.meta.url)), 'scenario.json');
writeFileSync(out, JSON.stringify(scenario, null, 1));
const count = (s) => campaigns.reduce((n, c) => n + c.contacts.filter((r) => r.status === s).length, 0);
console.log(`wrote ${out}: ${agents.length} agents, ${campaigns.length} campaigns, ${campaigns.reduce((n, c) => n + c.contacts.length, 0)} contacts, ${calls.length} calls, ${batches.length} Clarix batches; captured ${count('captured')}, disconnected ${count('disconnected_early')}, dialled ${count('dialled')}`);
