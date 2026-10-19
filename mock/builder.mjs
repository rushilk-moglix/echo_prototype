// Build an agent with AI: the customer drops whatever they have (an SOP, customer documents, the list they
// call from, a sample of the answers they want back, a database design, a call script) and says the job in
// a sentence. Echo reads it, asks only what it could not work out, and sets the whole agent up.
// In this prototype the reading is rule based and runs on the files themselves; the product uses a model.
import { randomUUID } from 'node:crypto';
import { readXlsx, writeXlsx } from './xlsx.mjs';

// Example files for "Try it with example files": served by this backend so they work in every build, offline too.
function sampleFiles() {
  const rows = [['Supplier Code', 'Supplier Name', 'Mobile', 'PO Number', 'Material', 'Pending Qty', 'Promised Date']];
  const sup = [['S-101', 'Supplier A', '9000000401'], ['S-102', 'Supplier B', '9000000402'], ['S-103', 'Supplier C', '9000000403']];
  let n = 0; for (const [c, nm, ph] of sup) for (let i = 0; i < 3; i++) rows.push([c, nm, ph, `45000${100 + n++}`, ['Bearing 6204', 'Hex bolt M12', 'Gasket 40mm'][i], String(50 * (i + 1)), `2${i}/10/2026`]);
  return {
    'open_po_lines.xlsx': { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: () => writeXlsx(rows, 'Lines') },
    'supplier_followup_sop.txt': { type: 'text/plain', body: () => Buffer.from('Supplier follow up SOP\n1. Always confirm the PO number before asking about dates.\n2. If the supplier says the material is delayed, take the new date and the reason.\n3. Never accept a date more than 30 days late without telling the buyer.\n4. Escalate to the buyer if the supplier refuses to share a date.\nCall between 10 am and 6 pm only.') },
    'erp_schema.sql': { type: 'text/plain', body: () => Buffer.from('CREATE TABLE purchase_orders (po_number varchar(20) primary key, supplier_code varchar(10), status varchar(20), buyer varchar(40));\nCREATE TABLE po_lines (po_number varchar(20), line_no int, material varchar(80), open_qty int, promised_date date);') },
    'call_script.txt': { type: 'text/plain', body: () => Buffer.from('Agent: Namaste, main Kavya, purchase team se. Kya meri baat supplier sahab se ho rahi hai?\nSupplier: Haan boliye.') },
  };
}

const KIND_LABEL = { input: 'List you call from', output: 'Sample of the answers', db: 'Database design', script: 'Call script', sop: 'SOP', docs: 'Customer documents' };
const ext = (n) => (String(n).split('.').pop() || '').toLowerCase();
export const snake = (h) => String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'column';

/** Rows of an .xlsx or .csv file, first row the headers. */
export function readTable(name, buf) {
  if (ext(name) !== 'csv') return readXlsx(buf);
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
const isTable = (n) => ['xlsx', 'xls', 'xlsm', 'csv'].includes(ext(n));
function classify(name, text = '') {
  const n = String(name).toLowerCase();
  if (isTable(n)) return /out|result|answer|report|response|expected|tracker_back|filled/.test(n) ? 'output' : 'input';
  if (['sql', 'dbml', 'prisma'].includes(ext(n)) || /schema|database|\bdb\b|erd|tables|data_model/.test(n) || /create\s+table/i.test(text)) return 'db';
  if (/script|transcript|recording|call_flow|callflow|pitch|dialogue/.test(n)) return 'script';
  if (/sop|process|procedure|policy|playbook|guideline|escalation|rules/.test(n)) return 'sop';
  return 'docs';
}

// ── Columns ──────────────────────────────────────────────────────────────────
function typeOf(key, vals) {
  const v = vals.map((x) => String(x ?? '').trim()).filter(Boolean);
  const all = (re) => v.length > 0 && v.every((x) => re.test(x));
  if (/phone|mobile|contact_no|whatsapp|cell|tel/.test(key) || all(/^\+?[\d\s-]{10,14}$/)) return 'phone';
  if (/email/.test(key) || all(/^[^@\s]+@[^@\s]+$/)) return 'email';
  if (/date|due|eta|_on$|deadline/.test(key) || all(/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}-\d{2}-\d{2}/)) return 'date';
  if (all(/^-?[\d,]+(\.\d+)?$/) && !/code|_no$|number|id$|pin/.test(key)) return 'number';
  return 'string';
}
const idLike = (k) => /order|po_|^po$|invoice|_no$|number|code|^id$|_id$|line|lr|awb|docket/.test(k);
function columns(rows) {
  const [head = [], ...data] = rows; const keys = head.map(snake);
  const seen = {}; const uniq = keys.map((k) => (seen[k] = (seen[k] || 0) + 1) > 1 ? `${k}_${seen[k]}` : k);
  return uniq.map((key, i) => {
    const vals = data.map((r) => r[i]);
    const type = typeOf(key, vals.slice(0, 50));
    return { key, header: head[i], type, sample: String(vals.find((x) => String(x ?? '').trim() !== '') ?? ''), transform: type === 'string' && idLike(key) && vals.some((x) => /\d{4,}/.test(String(x))) ? 'phonetic' : '', share_on_call: true, distinct: new Set(vals.map(String)).size };
  });
}

// ── What kind of job ─────────────────────────────────────────────────────────
const JOBS = {
  supplier: { words: /purchase order|\bpo\b|supplier|vendor.*(order|line|deliver)|promised|dispatch date|open line|lead time|quote/i, name: 'Kavya', team: 'the purchase team', what: 'open order lines',
    fields: [['line_status', 'enum', ['confirmed', 'delayed', 'dispatched', 'cancelled'], 'Will it arrive on the promised date'], ['new_date', 'date', [], 'New date if it is late'], ['dispatched_qty', 'number', [], 'Quantity already sent'], ['reason', 'string', [], 'Why it is late, in their words']],
    decision: { q: 'If a line is late, what should Echo do?', options: ['Take the new date and the reason', 'Take the new date and alert the buyer at once', 'Ask the buyer to call back'], rule: { 0: 'If a line is late, take the new date and the reason in their words.', 1: 'If a line is late, take the new date and the reason, and flag the line for the buyer now.', 2: 'If a line is late, say the buyer will call back today, and save the line as delayed.' } } },
  collections: { words: /invoice|payment|overdue|outstanding|collection|due amount|receivable|promise to pay/i, name: 'Neha', team: 'the accounts team', what: 'overdue invoices',
    fields: [['payment_status', 'enum', ['promised', 'paid', 'disputed', 'refused'], 'Where the invoice stands'], ['promise_date', 'date', [], 'Date they will pay'], ['amount', 'number', [], 'Amount they will pay'], ['dispute_reason', 'string', [], 'Why they dispute it']],
    decision: { q: 'If the customer disputes an invoice, what should Echo do?', options: ['Note the reason and flag it for the team', 'Offer to send the invoice copy on WhatsApp', 'Ask for the right person to talk to'], rule: { 0: 'If an invoice is disputed, note the reason exactly and flag it for the accounts team. Never argue.', 1: 'If an invoice is disputed, offer to send a copy on WhatsApp and note the reason.', 2: 'If an invoice is disputed, ask who can settle it and take their name and number.' } } },
  dispatch: { words: /transporter|vehicle|truck|\blr\b|\bpod\b|shipment|eta|freight|dispatch|delivery/i, name: 'Arjun', team: 'the logistics team', what: 'shipments',
    fields: [['vehicle_status', 'enum', ['placed', 'delayed', 'not_available', 'delivered'], 'Is the vehicle there'], ['vehicle_no', 'string', [], 'Vehicle number'], ['eta', 'date', [], 'Expected arrival'], ['pod_received', 'boolean', [], 'Proof of delivery received']],
    decision: { q: 'If no vehicle is ready, what should Echo do?', options: ['Ask when one will be ready', 'Flag it for the logistics team now'], rule: { 0: 'If no vehicle is ready, ask when one will be and save that date.', 1: 'If no vehicle is ready, flag the shipment for the logistics team now.' } } },
  vendor: { words: /kyc|gst|bank detail|vendor detail|onboard|verification|pan\b/i, name: 'Meera', team: 'the vendor team', what: 'vendor records',
    fields: [['details_correct', 'enum', ['yes', 'changed', 'wrong_contact'], 'Are the details on record right'], ['gst_number', 'string', [], 'GST number as said'], ['new_contact_phone', 'string', [], 'New contact number'], ['bank_change_asked', 'boolean', [], 'Asked to change bank details']],
    decision: { q: 'If someone asks to change bank details on the call?', options: ['Never change them; flag for a call back by finance'], rule: { 0: 'Never accept or confirm a change of bank details on the call. Say finance will call back on the number on record, and flag it.' } } },
  generic: { words: /.^/, name: 'Riya', team: 'the team', what: 'the list', fields: [['outcome', 'enum', ['done', 'call_back', 'not_interested'], 'What happened'], ['notes', 'string', [], 'Anything they said that matters']], decision: null },
};
function detectJob(text) {
  let best = 'generic', score = 0;
  for (const [k, j] of Object.entries(JOBS)) { const m = (text.match(new RegExp(j.words.source, 'gi')) || []).length; if (m > score) { best = k; score = m; } }
  return best;
}
const PACK_PROMPT = {
  supplier: 'Call each supplier once about all of their open purchase order lines. For each line, confirm it will arrive on the promised date, or take the new date and the reason.',
  collections: 'Call customers with overdue invoices. For each invoice, get a promise to pay with a date and amount, or note why they dispute it.',
  dispatch: 'Call transporters about today\'s shipments. Confirm the vehicle is placed, take the vehicle number and expected arrival, and ask for proof of delivery when delivered.',
  vendor: 'Call new vendors to confirm their contact, GST and bank details before the first purchase order. Never change bank details on the call.',
};

// ── Rules from an SOP, an opening from a script, lookups from a database design ─
function rulesFrom(text) {
  return String(text).split(/\r?\n|(?<=\.)\s+/).map((s) => s.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((s) => s.length > 12 && s.length < 220 && /\b(must|never|always|do not|don't|only|if|escalate|before|after|within|should)\b/i.test(s)).slice(0, 8);
}
function openingFrom(text) { return String(text).split(/\r?\n/).map((s) => s.replace(/^(agent|echo|caller|bot)\s*:\s*/i, '').trim()).find((s) => /\b(hello|hi|namaste|good (morning|afternoon)|this is|calling from|main .* se)\b/i.test(s)) || ''; }
function tablesFrom(text) {
  const out = [];
  for (const m of String(text).matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi)) out.push({ name: m[1], columns: m[2].split(',').map((c) => c.trim().split(/\s+/)[0].replace(/[`"[\]]/g, '')).filter((c) => c && !/^(primary|foreign|constraint|unique|key|index)$/i.test(c)) });
  try { const j = JSON.parse(text); for (const t of j.tables || []) out.push({ name: t.name, columns: (t.columns || []).map((c) => c.name || c) }); } catch { /* not json */ }
  return out;
}

export function registerBuilder({ on, json, fail, file, multipart, agents, agentByKey, agentDefaults, orgOf, nowIso, who, credits, flowsOf, syncTargets, pushAgent }) {
  const sessions = new Map();

  function analyze(org, prompt, pack, files) {
    const notes = []; const refs = []; let input = null, output = null, sopText = '', scriptText = '', tables = [];
    for (const f of files) {
      const text = isTable(f.filename) ? '' : f.content.toString('utf8').slice(0, 200000);
      const kind = f.kind || classify(f.filename, text);
      f.kind = kind;
      if (kind === 'input' || kind === 'output') {
        let rows; try { rows = readTable(f.filename, f.content); } catch { notes.push(`Could not read ${f.filename}; save it as .xlsx or .csv`); continue; }
        if (kind === 'input' && !input) input = { name: f.filename, rows }; else if (!output) output = { name: f.filename, rows }; else if (!input) input = { name: f.filename, rows };
      } else if (kind === 'db') tables.push(...tablesFrom(text));
      else if (kind === 'script') scriptText += '\n' + text;
      else if (kind === 'sop') { sopText += '\n' + (/^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(text.slice(0, 400)) ? text : ''); refs.push({ name: f.filename, kind }); }
      else refs.push({ name: f.filename, kind });
    }
    const all = [prompt, sopText, scriptText, input?.rows[0]?.join(' '), output?.rows[0]?.join(' '), files.map((f) => f.filename).join(' ')].join(' ');
    const job = pack && JOBS[pack] ? pack : detectJob(all); const J = JOBS[job];
    // Call data from the list
    let inputs = input ? columns(input.rows) : [{ key: 'contact_name', type: 'string', sample: 'Supplier A', transform: '', share_on_call: true }, { key: 'contact_phone', type: 'phone', sample: '9000000000', transform: '', share_on_call: true }];
    const rowsN = input ? input.rows.length - 1 : 0;
    if (input) notes.push(`Read ${rowsN} rows and ${inputs.length} columns from ${input.name}`);
    const phone = inputs.find((c) => c.type === 'phone');
    if (phone) notes.push(`Calls go to the number in ${phone.key}`);
    // Grouping: a code or name column that repeats means one call can cover several rows
    let group = null;
    if (input && rowsN > 1) {
      const cand = inputs.filter((c) => c.distinct < rowsN && (/vendor|supplier|customer|dealer|party|account|transporter|client|code/.test(c.key) || c.type === 'phone'));
      group = cand.find((c) => /code|_id$/.test(c.key)) || cand.find((c) => c.type === 'phone') || cand[0] || null;
    }
    let plan = { mode: 'row', group_by: '', call_columns: [], row_columns: [], order_by: '', order_dir: 'asc', max_rows: 8, overflow: 'split', answers_key: '' };
    let people = rowsN;
    if (group) {
      const [, ...data] = input.rows; const gi = inputs.indexOf(group);
      const byG = new Map(); data.forEach((r) => { const k = String(r[gi]); byG.set(k, [...(byG.get(k) || []), r]); });
      people = byG.size;
      const steady = inputs.filter((c, i) => [...byG.values()].every((rs) => new Set(rs.map((r) => String(r[i] ?? ''))).size <= 1)).map((c) => c.key);
      const rowCols = inputs.map((c) => c.key).filter((k) => !steady.includes(k));
      const dateCol = rowCols.find((k) => inputs.find((c) => c.key === k)?.type === 'date') || '';
      const idCol = rowCols.find(idLike) || '';
      const sayCols = rowCols.filter((k) => k !== idCol && k !== dateCol).slice(0, 2);
      plan = { ...plan, mode: 'group', group_by: group.key, call_columns: steady, row_columns: rowCols, order_by: dateCol, say_as: sayCols.map((k) => `{${k}}`).join(', '), identity: idCol ? [idCol] : [], remember: !!idCol, list_style: 'all_first', check_in_after: 5, answers_key: 'rows' };
      notes.push(`${rowsN} rows belong to ${people} ${group.key.replace(/_/g, ' ')}s, so one call can cover all of a person's rows`);
    }
    // Answers: from the sample of answers if there is one, else the usual ones for this job
    const inKeys = new Set(inputs.map((c) => c.key));
    let fields;
    if (output) {
      const cols = columns(output.rows).filter((c) => !inKeys.has(c.key));
      fields = cols.map((c) => { const vals = output.rows.slice(1).map((r) => r[output.rows[0].map(snake).indexOf(c.key)]).filter((x) => String(x ?? '').trim());
        const opts = [...new Set(vals.map((v) => snake(v)))]; const en = c.type === 'string' && vals.length >= 3 && opts.length <= 6;
        return { key: c.key, type: en ? 'enum' : c.type === 'phone' ? 'string' : c.type, options: en ? opts : [], description: `As in ${output.name}` }; });
      notes.push(`Answers to collect come from ${output.name}: ${fields.map((f) => f.key).join(', ') || 'no new columns found'}`);
    } else fields = J.fields.map(([key, type, options, description]) => ({ key, type, options, description }));
    const outputs = plan.mode === 'group'
      ? [{ key: 'call_result', label: 'Call result', type: 'enum', options: ['completed', 'callback_requested', 'wrong_contact', 'refused'], description: 'How the call went; the call status is separate', required: true },
        { key: 'rows', label: 'Answer for each row', type: 'list', required: true, description: 'One entry per row, saved as each row is answered', fields: [{ key: 'row', type: 'number', options: [] }, ...fields.map((f) => ({ key: f.key, type: f.type === 'list' ? 'string' : f.type, options: f.options || [] }))] },
        { key: 'rows_covered', label: 'Rows answered', type: 'number', description: 'Rows saved on this call', required: true }]
      : [{ key: 'call_result', label: 'Call result', type: 'enum', options: ['completed', 'callback_requested', 'wrong_contact', 'refused'], description: 'How the call went', required: true }, ...fields.map((f) => ({ ...f, label: f.key.replace(/_/g, ' '), required: false }))];
    // Rules, opening, lookups, knowledge
    const sopRules = rulesFrom(sopText); if (sopRules.length) notes.push(`Took ${sopRules.length} rules from the SOP`);
    const opening = openingFrom(scriptText); if (opening) notes.push('Used the opening line from the call script');
    const lookups = tables.filter((t) => t.columns.some((c) => inKeys.has(snake(c)))).slice(0, 3).map((t) => {
      const key = t.columns.find((c) => inKeys.has(snake(c)));
      return { name: `Look up ${t.name.replace(/_/g, ' ')}`, when: 'during', url: '', send: [snake(key)], returns: t.columns.filter((c) => c !== key).slice(0, 4).join(', '), timeout_s: 3, fallback: 'Let me check and get back to you.' };
    });
    if (tables.length) notes.push(lookups.length ? `Suggested ${lookups.length} lookup${lookups.length > 1 ? 's' : ''} from the database design; your team adds the address` : `Read ${tables.length} tables from the database design; none share a column with the list yet`);
    if (refs.length) notes.push(`${refs.length} document${refs.length > 1 ? 's' : ''} added as knowledge the agent can search on calls`);
    const name = (prompt.match(/\b(?:you are|called|named|call (?:her|him))\s+([A-Z][a-z]+)/) || [])[1] || J.name;
    const label = `${name} - ${job === 'generic' ? (prompt.split(/[.,\n]/)[0].slice(0, 40) || 'New agent') : { supplier: 'Supplier follow up', collections: 'Collections', dispatch: 'Dispatch and delivery', vendor: 'Vendor details check' }[job]}`;
    const draft = {
      label, job, name, team: J.team, description: (prompt || PACK_PROMPT[job] || '').split(/(?<=\.)\s/)[0].slice(0, 140),
      language: /hinglish|hindi|namaste|haan|ji\b/i.test(all) ? 'Hinglish' : 'Match the person',
      opening: opening || (job === 'generic' ? `Hello, this is ${name} from ${J.team}.` : `Hello, this is ${name} from ${J.team}, calling about your ${J.what}. Is this a good time for two minutes?`),
      inputs: inputs.map(({ distinct, header, ...c }) => c), plan, outputs, rules_from_sop: sopRules, decision: J.decision ? J.decision.rule[0] : '',
      references: refs, lookups, flow: flowsOf(org)[0]?.name || '', sync: 'none', voice: ['Kavya', 'Neha', 'Meera', 'Riya'].includes(name) ? 'Aoede' : 'Puck',
      stats: { rows: rowsN, people, calls: Math.max(people, 0) }, notes,
    };
    // Questions: only what could not be worked out, each with Echo's own answer ready
    const qs = [];
    if (input && !phone) qs.push({ id: 'phone', q: 'Which column has the phone number to call?', why: 'No column looked like phone numbers.', options: inputs.map((c) => c.key), default: inputs[0]?.key });
    if (group) qs.push({ id: 'group', q: `${rowsN} rows, ${people} people. Call each person once about all of their rows?`, why: `${group.key} repeats across rows.`, options: [`Yes, one call per ${group.key.replace(/_/g, ' ')}`, 'No, one call per row'], default: `Yes, one call per ${group.key.replace(/_/g, ' ')}` });
    if (!output) qs.push({ id: 'answers', q: plan.mode === 'group' ? 'What should Echo find out for each row?' : 'What should Echo find out on each call?', why: 'No sample of answers was added.', multi: true, options: fields.map((f) => f.key), default: fields.map((f) => f.key) });
    if (J.decision) qs.push({ id: 'decision', q: J.decision.q, why: sopRules.length ? 'The SOP does not say.' : 'No SOP was added.', options: J.decision.options, default: J.decision.options[0] });
    qs.push({ id: 'language', q: 'What language should the agent speak?', why: draft.language === 'Hinglish' ? 'Your files use Hindi words.' : 'Echo can follow the language the person answers in.', options: ['Match the person', 'Hinglish', 'English', 'Hindi'], default: draft.language });
    const on = syncTargets(org).filter((s) => s.connected && !s.needs_url); const dests = ['Keep in Echo', ...on.map((s) => s.label)];
    qs.push({ id: 'sync', q: 'Where should the answers go after each call?', why: 'Answers are saved in Echo either way; this sends them on as they come.', options: dests, default: on.find((s) => s.platform_key === 'clarix')?.label || 'Keep in Echo' });
    const flows = flowsOf(org);
    if (flows.length > 1) qs.push({ id: 'flow', q: 'Which phone line should it call from?', why: `${flows.length} lines are turned on in Settings.`, options: flows.slice(0, 6).map((f) => f.name), default: flows[0].name });
    return { draft, questions: qs };
  }

  /** Answers always apply to the untouched first draft, so changing an answer back undoes it. */
  function apply(s, answers) {
    const d = structuredClone(s.base); const J = JOBS[d.job];
    const a = { ...Object.fromEntries(s.questions.map((q) => [q.id, q.default])), ...(answers || {}) };
    if (a.phone) d.inputs = d.inputs.map((c) => (c.key === a.phone ? { ...c, type: 'phone' } : c));
    if (a.group && /^No/.test(a.group) && d.plan.mode === 'group') {
      const rowsOut = d.outputs.find((o) => o.key === 'rows');
      d.plan = { ...d.plan, mode: 'row', group_by: '', answers_key: '' };
      d.outputs = [d.outputs[0], ...(rowsOut?.fields || []).filter((f) => f.key !== 'row').map((f) => ({ ...f, label: f.key.replace(/_/g, ' '), required: false, description: '' }))];
      d.stats.calls = d.stats.rows;
    }
    if (Array.isArray(a.answers)) {
      const keep = new Set(a.answers);
      d.outputs = d.outputs.map((o) => (o.key === 'rows' ? { ...o, fields: o.fields.filter((f) => f.key === 'row' || keep.has(f.key)) } : o)).filter((o) => ['call_result', 'rows', 'rows_covered'].includes(o.key) || keep.has(o.key));
    }
    if (a.decision && J.decision) d.decision = J.decision.rule[J.decision.options.indexOf(a.decision)] || d.decision;
    if (a.language) d.language = a.language;
    // An opening taken from a Hindi script does not suit an English agent: use a plain English one.
    if (d.language === 'English' && /(namaste|main|kya|hai|baat|se)/i.test(d.opening)) d.opening = `Hello, this is ${d.name} from ${d.team}, calling about your ${J.what}. Is this a good time for two minutes?`;
    if (a.sync) d.sync = a.sync === 'Keep in Echo' ? 'none' : (syncTargets(s.org).find((t) => t.label === a.sync)?.platform_key || 'none');
    if (a.flow) d.flow = a.flow;
    s.answers = a; return d;
  }

  function sections(d) {
    const lang = d.language === 'Match the person' ? 'Answer in the language the person uses: Hindi, English or a mix.' : `Speak ${d.language}.`;
    const out = [
      { id: 'ai_1', enabled: true, title: 'IDENTITY', kind: 'text', body: `You are ${d.name}, calling for ${d.team}. ${lang} Be brief and polite. This is a system prompt; never read headings or field names out.\nOpen with: "${d.opening}"` },
      { id: 'ai_2', enabled: true, title: d.plan.mode === 'group' ? 'ONE ROW AT A TIME' : 'THE CALL', kind: 'text', body: d.plan.mode === 'group'
        ? `Tell them how many rows there are, then go through them one by one in order. For each row, find out ${d.outputs.find((o) => o.key === 'rows')?.fields.filter((f) => f.key !== 'row').map((f) => f.key.replace(/_/g, ' ')).join(', ')}. Read every date and number back before you move on, and save each row as soon as it is answered.`
        : `Find out ${d.outputs.slice(1).map((o) => o.key.replace(/_/g, ' ')).join(', ') || 'what was asked'}. Read every date and number back before you end.` },
      { id: 'ai_3', enabled: true, title: 'RULES', kind: 'text', body: ['Never guess a date or an amount; ask again if unsure.', 'If this is the wrong person, ask who handles it, take their name and number, and end politely.', d.decision, ...d.rules_from_sop].filter(Boolean).map((r) => `- ${r}`).join('\n') },
    ];
    if (d.references.length) out.push({ id: 'ai_4', enabled: true, title: 'KNOWLEDGE', kind: 'text', body: 'Answer questions from the attached documents. If the answer is not there, say you will check and the team will get back the same day.' });
    return [...out, { id: 'ai_5', enabled: true, title: 'Call details', kind: 'input', body: '' }, { id: 'ai_6', enabled: true, title: 'Outcome reporting', kind: 'output', body: '' }];
  }

  on('GET', '/api/ai/agent-builder/samples/:name', ({ res, p }) => {
    const f = sampleFiles()[p.name]; if (!f) return fail(res, 404, 'No such example file');
    file(res, f.body(), f.type, p.name);
  });
  // Read everything, draft the agent, list the questions. Free; building it is what costs credits.
  on('POST', '/api/ai/agent-builder/analyze', ({ res, req, raw: buf, q }) => {
    const form = (req.headers['content-type'] || '').includes('multipart') ? multipart(req, buf) : JSON.parse(buf.toString('utf8') || '{}');
    const files = Object.entries(form).filter(([k, v]) => /^file_\d+$/.test(k) && v?.content).map(([k, v]) => ({ ...v, kind: form[`kind_${k.slice(5)}`] || '' }));
    const prompt = String(form.prompt || '').trim(); const pack = String(form.pack || '');
    if (!prompt && !files.length && !pack) return fail(res, 400, 'Say what the calls are for, or drop a file');
    if (files.some((f) => f.content.length > 25 * 1024 * 1024)) return fail(res, 413, 'Files can be up to 25 MB each');
    const org = orgOf(q);
    const { draft, questions } = analyze(org, prompt || PACK_PROMPT[pack] || '', pack, files);
    const id = randomUUID().slice(0, 10);
    sessions.set(id, { id, org, base: draft, questions, prompt, files: files.map((f) => ({ name: f.filename, kind: f.kind, label: KIND_LABEL[f.kind], size_kb: Math.max(1, Math.round(f.content.length / 1024)) })) });
    const s = sessions.get(id); s.draft = apply(s, {});
    json(res, 200, { session: id, files: s.files, questions, draft: s.draft, cost: credits.price('ai_build') });
  });
  on('POST', '/api/ai/agent-builder/:id/answers', ({ res, p, body }) => {
    const s = sessions.get(p.id); if (!s) return fail(res, 404, 'This draft has expired; start again');
    s.draft = apply(s, body.answers || {});
    json(res, 200, { session: s.id, draft: s.draft });
  });
  on('POST', '/api/ai/agent-builder/:id/create', ({ res, p, body, q }) => {
    const s = sessions.get(p.id); if (!s) return fail(res, 404, 'This draft has expired; start again');
    const d = s.draft; const label = String(body.label || d.label).trim();
    let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56); while (agentByKey(key)) key += '_2';
    const e = credits.spend(s.org, 'ai_build', `Built with AI: ${label}`, credits.price('ai_build')); if (!e) return fail(res, 402, credits.short(s.org, credits.price('ai_build')));
    const flow = flowsOf(s.org).find((f) => f.name === d.flow);
    const a = agentDefaults({
      key, label, org_id: s.org, description: d.description, voice: d.voice, ozonetel_campaign: flow?.name || '', ozonetel_type: flow?.type || '',
      primary_id_key: d.plan.group_by || d.inputs.find((c) => c.type === 'phone')?.key || d.inputs[0]?.key, primary_id_label: d.plan.group_by || 'contact_phone', providers: ['gemini'],
      input_variables: d.inputs, input_plan: d.plan, output_variables: d.outputs, sections: sections(d), lookups: d.lookups,
      references: d.references.map((r) => ({ id: randomUUID().slice(0, 8), name: r.name, size_kb: s.files.find((f) => f.name === r.name)?.size_kb || 1, scope: 'agent', status: 'ready', added_at: nowIso(), keep: 'Kept until removed' })),
      synced_platform: d.sync !== 'none' ? d.sync : null, sync_status: d.sync !== 'none' ? 'synced' : null, sync_last_error: null, synced_at: d.sync !== 'none' ? nowIso() : null,
      sync_target: { type: d.sync, url: '' }, built_with_ai: { at: nowIso(), files: s.files, prompt: s.prompt, answers: s.answers },
      created_at: nowIso(), updated_at: nowIso(), updated_by: who(),
    });
    agents.unshift(a); sessions.delete(s.id);
    // Results going to Clarix: push the agent there now, as a save in the editor would.
    if (a.synced_platform && pushAgent) Promise.resolve().then(() => pushAgent(a)).catch(() => undefined);
    json(res, 201, { agent: a, charged: credits.price('ai_build') });
  });

  // Change an agent by saying what to change. Returns the changed parts for the editor's draft; nothing is saved here.
  on('POST', '/api/agents/:key/ai-edit', ({ res, p, body, q }) => {
    const a = agentByKey(p.key); if (!a) return fail(res, 404, 'Agent not found');
    const say = String(body.instruction || '').trim(); if (!say) return fail(res, 400, 'Say what to change');
    const org = orgOf(q);
    const e = credits.spend(org, 'ai_edit', `Changed with AI: ${a.label}`, credits.price('ai_edit')); if (!e) return fail(res, 402, credits.short(org, credits.price('ai_edit')));
    const sections = structuredClone(body.sections || a.sections); const outputs = structuredClone(body.outputs || a.output_variables); const inputs = structuredClone(body.inputs || a.input_variables);
    const changes = [];
    let rules = sections.find((x) => /RULES/i.test(x.title) && x.kind === 'text');
    if (!rules) { rules = { id: `ai_${Date.now()}`, enabled: true, title: 'RULES', kind: 'text', body: '' }; sections.splice(Math.max(0, sections.findIndex((x) => x.kind !== 'text')), 0, rules); }
    const addRule = (r) => { rules.body = `${rules.body ? rules.body.trimEnd() + '\n' : ''}- ${r}`; changes.push({ part: 'prompt', text: `Rule added: ${r}` }); };
    const l = say.toLowerCase();
    if (/slow|pace|fast/.test(l)) addRule('Speak slowly and pause after each row so the person can answer.');
    if (/date/.test(l) && /format|dd|say|read/.test(l)) addRule('Say dates as day, month name and year; save them as DD-MM-YYYY.');
    if (/digit|spell|one by one/.test(l)) { const ids = inputs.filter((v) => idLike(v.key) && v.type === 'string'); ids.forEach((v) => (v.transform = 'phonetic')); if (ids.length) changes.push({ part: 'call data', text: `Read digit by digit: ${ids.map((v) => v.key).join(', ')}` }); }
    if (/whatsapp/.test(l)) addRule('If the person prefers WhatsApp, say the lines will be sent there and end the call politely.');
    if (/polite|formal|warm|friendly|respect/.test(l)) addRule('Use a warm, respectful tone; thank them before ending.');
    const lang = (l.match(/\b(hinglish|hindi|english|marathi|tamil|telugu|gujarati|bengali|kannada)\b/) || [])[1];
    if (lang) { const id = sections.find((x) => /IDENTITY/i.test(x.title)); if (id) { id.body = id.body.replace(/Speak [A-Za-z]+\.|Answer in the language[^.]*\./, `Speak ${lang[0].toUpperCase() + lang.slice(1)}.`); changes.push({ part: 'prompt', text: `Language set to ${lang}` }); } }
    const add = l.match(/\b(?:add|collect|ask for|capture|save)\s+(?:a |an |the )?(?:field |answer |question )?(?:for |called |named )?([a-z][a-z0-9 _]{2,30})/);
    if (add && !/rule|line|whatsapp/.test(add[1])) {
      const key = snake(add[1].replace(/\b(too|also|as well|please)\b/g, '')); const type = /date|when|eta/.test(key) ? 'date' : /qty|amount|count|number_of/.test(key) ? 'number' : 'string';
      const list = outputs.find((o) => o.type === 'list');
      if (list && !list.fields.some((f) => f.key === key)) { list.fields.push({ key, type, options: [] }); changes.push({ part: 'answers', text: `Added ${key} to the answer for each row` }); }
      else if (!list && !outputs.some((o) => o.key === key)) { outputs.push({ key, label: key.replace(/_/g, ' '), type, options: [], description: say, required: false }); changes.push({ part: 'answers', text: `Added the answer ${key}` }); }
    }
    const never = l.match(/\b(?:never|don't|do not|stop)\s+([a-z].{4,120})/);
    if (never) addRule(`Never ${never[1].replace(/[.!]+$/, '')}.`);
    if (!changes.length) addRule(say.replace(/^please\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()).replace(/[.!]*$/, '.'));
    json(res, 200, { changes, sections, outputs, inputs, charged: credits.price('ai_edit') });
  });
  return { readTable };
}
