// Reports, follow ups and report schedules for the local mock (prototype of the reporting work).
//
// Report: the same numbers as the Overview, split by anything: campaign, agent, day or any column of the uploaded file.
// Follow ups: contacts that calling alone cannot settle (blocked, wrong number, rejected, every try used). A person
// takes each one: owner, notes, a new number, call again or close.
// Schedules: the report sent by email on a timetable, as an image, a PDF and a spreadsheet.
import { randomUUID } from 'node:crypto';
import { writeWorkbook } from './xlsx.mjs';
import { OUTCOMES, contactOutcome } from './outcome.mjs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Why a contact needs a person. Order is the order shown. */
export const FOLLOW_REASONS = {
  blocked: { label: 'Blocked', help: 'The number or its network refuses our calls (DND or an explicit block). Calling again will not help until the contact allows the number.' },
  wrong_number: { label: 'Wrong number', help: 'The number does not exist or is not valid. It needs a corrected number.' },
  rejected: { label: 'Rejected', help: 'The contact declined the call. A person should reach out before the agent calls again.' },
  no_more_tries: { label: 'No more tries', help: 'Every allowed try was used and the contact was never reached.' },
  never_reached: { label: 'Not reached on 2+ days', help: 'The contact was tried on two or more separate days and never picked up. The number may be wrong, dead or blocking the calls.' },
};
export function followReason(row) {
  if (row.status === 'retry_exhausted') return 'no_more_tries';
  const o = contactOutcome(row);
  return FOLLOW_REASONS[o] ? o : null;
}


/**
 * Answers summary for one agent, built from the agent's own answer fields. Nothing is assumed about the use case:
 * a choice or yes/no field becomes counts per value, a number field becomes a total and an average, free text is left out.
 * defs: [{ key, label, type: 'choice' | 'number', unit }]; records: one object of answers per call (or per row).
 */
export function summariseAnswers(defs, recordsOf) {
  const out = [];
  for (const d of defs) {
    const vals = recordsOf(d).map((r) => r?.[d.key]).filter((v) => v !== undefined && v !== null && v !== '');
    if (!vals.length) continue;
    if (d.type === 'number') {
      const n = vals.map(Number).filter(Number.isFinite); if (!n.length) continue;
      const sum = n.reduce((a, b) => a + b, 0);
      out.push({ key: d.key, label: d.label, type: 'number', unit: d.unit, answered: n.length, sum: Math.round(sum * 100) / 100, avg: Math.round((sum / n.length) * 10) / 10, min: Math.min(...n), max: Math.max(...n) });
    } else {
      const m = new Map(); for (const v of vals) { const k = v === true ? 'Yes' : v === false ? 'No' : String(v); m.set(k, (m.get(k) || 0) + 1); }
      // A choice has a handful of values. A field with a different value on almost every call is text, whatever its type says.
      if (m.size > 12 || (m.size > 6 && m.size > vals.length / 2)) continue;
      const values = [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      out.push({ key: d.key, label: d.label, type: 'choice', unit: d.unit, answered: vals.length, values });
    }
  }
  return out;
}
export const fieldLabel = (k) => { const s = String(k).replace(/_\d+$/, '').replace(/_/g, ' ').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };

/**
 * Input checks from the field type, never from the use case. rows: [{ values, rejected }] of one upload;
 * fields: [{ key, type }] with type text, number, date, phone or choice. Returns the problems found with row counts.
 */
export function checkInput(uploads, fieldsOf) {
  const problems = new Map(); let total = 0, rejected = 0, warned = 0;
  const hit = (set, label, field, kind, i) => { const k = `${kind}|${label}|${field}`; if (!problems.has(k)) problems.set(k, { label, field, kind, rows: 0 }); problems.get(k).rows++; set.add(i); };
  const dateShape = (v) => { const m = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/.exec(String(v).trim()); if (!m) return null; const [a, b] = [Number(m[1]), Number(m[2])]; return m[1].length === 4 ? 'year first' : b > 12 ? 'month first' : a > 12 ? 'day first' : 'either'; };
  for (const up of uploads) {
    const rows = up.rows; const fields = fieldsOf(up); const bad = new Set(); const warn = new Set(); total += rows.length;
    rows.forEach((r, i) => { if (r.rejected) hit(bad, r.rejected, '', 'reject', i); });
    for (const f of fields) {
      const vals = rows.map((r) => (r.values?.[f.key] === undefined || r.values[f.key] === null ? '' : String(r.values[f.key]).trim()));
      const filled = vals.filter(Boolean); if (!filled.length) continue;
      if (f.type === 'date') {
        const shapes = vals.map((v) => (v ? dateShape(v) : 'blank')); const sure = shapes.filter((s) => s === 'month first' || s === 'day first');
        const main = sure.filter((s) => s === 'day first').length >= sure.filter((s) => s === 'month first').length ? 'day first' : 'month first';
        shapes.forEach((s, i) => { if (rows[i].rejected || s === 'blank') return; if (s === null) hit(warn, 'Not a date', f.key, 'warn', i); else if ((s === 'month first' || s === 'day first') && s !== main) hit(warn, `Date written ${s}; the rest of the file is ${main}`, f.key, 'warn', i); });
      } else if (f.type === 'number') {
        vals.forEach((v, i) => { if (v && !rows[i].rejected && isNaN(Number(v.replace(/,/g, '')))) hit(warn, 'Not a number', f.key, 'warn', i); });
      } else if (f.type !== 'phone') {
        const count = new Map(); filled.forEach((v) => count.set(v, (count.get(v) || 0) + 1));
        // A column whose values normally repeat: a value seen once is probably in the wrong column or misspelt.
        const repeating = [...count.values()].filter((n) => n >= 3).reduce((a, b) => a + b, 0);
        if (count.size <= 12 && repeating / filled.length >= 0.7) vals.forEach((v, i) => { if (v && !rows[i].rejected && count.get(v) === 1) hit(warn, 'One off value in a column that normally repeats', f.key, 'warn', i); });
        const lens = filled.map((v) => v.length).sort((a, b) => a - b); const med = lens[Math.floor(lens.length / 2)];
        if (med >= 16) vals.forEach((v, i) => { if (v && !rows[i].rejected && v.length < med / 4) hit(warn, 'Much shorter than the rest of the column', f.key, 'warn', i); });
      }
    }
    const seen = new Map(); rows.forEach((r, i) => { if (r.rejected || !r.contact) return; if (seen.has(r.contact) && !up.grouped) hit(warn, 'Same contact on more than one row', '', 'warn', i); else seen.set(r.contact, i); });
    rejected += bad.size; warned += [...warn].filter((i) => !bad.has(i)).length;
  }
  return { rows: total, rejected, warned, clean: total - rejected - warned, problems: [...problems.values()].sort((a, b) => (a.kind === b.kind ? b.rows - a.rows : a.kind === 'reject' ? -1 : 1)) };
}
/** Why a picked up call did not finish: one fixed list for every agent. */
export const WHY = { call_later: 'Asked to call later', wrong_person: 'Wrong person', no_trust: 'Did not trust the call', cannot_hear: 'Could not hear', machine: 'Machine answered', hung_up: 'Hung up early', silent: 'Picked up and stayed silent' };
const pick = (seed, list) => { let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return list[h % list.length]; };
/** outcome: Echo's call status word. The agent records the reason on the call; the mock derives one from the status. */
export function whyOf(outcome, seed, callbackAsked) {
  if (callbackAsked) return 'call_later';
  if (outcome === 'voicemail') return 'machine';
  if (outcome === 'no_reply') return 'silent';
  if (outcome === 'call_dropped') return 'cannot_hear';
  if (outcome === 'caller_hung_up') return pick(seed, ['hung_up', 'hung_up', 'no_trust', 'wrong_person', 'call_later']);
  return null;
}
const fieldType = (t) => (/number|integer|decimal/i.test(t) ? 'number' : /date/i.test(t) ? 'date' : /phone/i.test(t) ? 'phone' : /enum|choice/i.test(t) ? 'choice' : 'text');

export function registerReports({ on, json, file, fail, campaigns, agents, agentByKey, users, orgOf, nowIso, redial, isDialled, isReached }) {
  const inWindow = (q) => {
    const from = Date.now() - Number(q.get('days') || 30) * 86400000; const org = orgOf(q);
    return campaigns.filter((c) => (c.org_id || 'org_moglix') === org && Date.parse(c.created_at) >= from && (!q.get('campaign_id') || c.campaign_id === q.get('campaign_id')) && (!q.get('agent') || c.agent === q.get('agent')));
  };
  const lastDial = (x) => (x.attempts_detail || []).slice(-1)[0];
  const dayOf = (c, x) => (lastDial(x)?.started_at || c.created_at).slice(0, 10);
  const blank = () => ({ contacts: 0, dialled: 0, reached: 0, completed: 0, not_reached: 0, failed: 0, in_progress: 0, not_dialled: 0, follow_up: 0, talk_seconds: 0 });
  const add = (m, c, x) => {
    const o = contactOutcome(x); const g = OUTCOMES[o]?.group || 'failed';
    // Dialled and reached use the Overview funnel's own rules, so the two never disagree.
    m.contacts++; if (isDialled(c, x)) m.dialled++;
    if (isDialled(c, x) && isReached(x)) m.reached++; if (o === 'completed') m.completed++;
    if (g === 'not_reached') m.not_reached++; if (g === 'failed') m.failed++; if (g === 'in_progress') m.in_progress++; if (g === 'not_dialled') m.not_dialled++;
    if (reasonFor(x, add.never || new Set()) && x.follow_up?.state !== 'done') m.follow_up++;
    m.talk_seconds += (x.attempts_detail || []).reduce((n, a) => n + (a.stream?.connected ? a.talk_seconds || 0 : 0), 0);
    return m;
  };
  /** Columns of the uploaded files that make sense to compare by: with a handful of values, not one per row. */
  const columnsOf = (list) => {
    const seen = {};
    for (const c of list) for (const x of c.contacts) for (const [k, v] of Object.entries(x.context || {})) { if (v == null || typeof v === 'object') continue; (seen[k] ||= new Set()).add(String(v)); }
    const rows = list.reduce((n, c) => n + c.contacts.length, 0);
    // Names, not numbers, dates, ids or long text: a value must repeat and read like a label.
    const label = (v) => v.length <= 40 && !/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(v) && (v.replace(/\D/g, '').length / Math.max(v.length, 1)) < 0.4;
    return Object.entries(seen).filter(([, s]) => s.size >= 2 && s.size <= 8 && rows / s.size >= 6 && [...s].every(label)).map(([key, s]) => ({ key, label: key.replace(/_/g, ' '), values: [...s].sort() }));
  };
  /** Answer fields of one agent: its call level answers, and for agents that answer per row, the fields of each row. */
  const answersOf = (agentKey, list) => {
    const a = agentByKey(agentKey); if (!a) return [];
    const defs = []; const kind = (t) => (t === 'number' || t === 'integer' ? 'number' : t === 'enum' || t === 'boolean' ? 'choice' : null);
    for (const v of a.output_variables || []) {
      if (v.fields?.length) { for (const f of v.fields) if (kind(f.type)) defs.push({ key: f.key, label: f.label || fieldLabel(f.key), type: kind(f.type), unit: 'rows', list: v.key }); }
      else if (kind(v.type)) defs.push({ key: v.key, label: v.label || fieldLabel(v.key), type: kind(v.type), unit: 'calls' });
    }
    const contacts = list.flatMap((c) => c.contacts).filter((x) => x.outputs && Object.keys(x.outputs).length);
    return summariseAnswers(defs, (d) => (d.list ? contacts.flatMap((x) => (Array.isArray(x.outputs[d.list]) ? x.outputs[d.list] : [])) : contacts.map((x) => x.outputs)));
  };
  /** Never reached on two or more separate days, on any campaign: calling again is unlikely to help. */
  const neverReached = (org) => {
    const days = new Map(); const reached = new Set();
    for (const c of campaigns) { if ((c.org_id || 'org_moglix') !== org) continue; for (const x of c.contacts) { if (!x.phone) continue; if (isReached(x)) reached.add(x.phone); else if ((x.attempts_detail || []).length) (days.get(x.phone) || days.set(x.phone, new Set()).get(x.phone)).add(dayOf(c, x)); } }
    return new Set([...days].filter(([p, d]) => d.size >= 2 && !reached.has(p)).map(([p]) => p));
  };
  const reasonFor = (x, never) => followReason(x) || (never.has(x.phone) && OUTCOMES[contactOutcome(x)]?.group === 'not_reached' && x.status !== 'retry_scheduled' ? 'never_reached' : null);
  /** The Input layer: every uploaded row checked against the agent's own field types. */
  const inputOf = (list) => checkInput(list.map((c) => { const a = agentByKey(c.agent); const grouped = a?.input_plan?.mode === 'group';
    const rows = c.contacts.flatMap((x) => { const rej = x.status === 'input_validation_failed' || x.reason === 'data_validation_failed' ? String(x.validation_error || 'Failed the upload check').replace(/^Row \d+: /, '').replace(/^(\w+) is required$/, 'Required value missing') : x.reason === 'duplicate_row' ? 'Repeats an earlier row' : null;
      return x.items?.length ? x.items.map((it) => ({ values: { ...x.context, ...it.values }, rejected: rej, contact: x.phone })) : [{ values: x.context || {}, rejected: rej, contact: x.phone }]; });
    return { rows, grouped, agent: a }; }), (up) => (up.agent?.input_variables || []).map((v) => ({ key: v.key, type: fieldType(v.type) })));
  /** Many rows per call: how many uploaded rows were actually covered on a call. */
  const rowsOf = (list) => { let uploaded = 0, onReached = 0, covered = 0, any = false;
    for (const c of list) { const key = agentByKey(c.agent)?.input_plan?.answers_key; for (const x of c.contacts) { if (!x.items?.length) continue; any = true; uploaded += x.items.length; if (!isReached(x)) continue; onReached += x.items.length; const ans = Array.isArray(x.outputs?.[key]) ? x.outputs[key] : []; covered += ans.filter((e) => Object.values(e).some((v) => v !== 'not_covered' && v !== '' && v !== null) && !Object.values(e).includes('not_covered')).length; } }
    return any ? { uploaded, on_reached: onReached, covered: Math.min(covered, onReached), not_covered: Math.max(0, onReached - covered) } : null; };
  const whyFor = (list) => { const m = {}; let base = 0;
    for (const c of list) for (const x of c.contacts) { const o = contactOutcome(x); if (OUTCOMES[o]?.group !== 'reached' || o === 'completed') continue; base++; const k = whyOf(o, x.primary_id, !!(x.outputs?.callback_time || x.outputs?.callback_date)); if (k) m[k] = (m[k] || 0) + 1; }
    return { base, reasons: Object.entries(m).map(([key, count]) => ({ key, label: WHY[key], count })).sort((a, b) => b.count - a.count) }; };
  function summary(q) {
    const list = inWindow(q); const by = q.get('by') || 'campaign'; const only = q.get('value') || '';
    const keyOf = (c, x) => by === 'campaign' ? [c.campaign_id, c.name] : by === 'agent' ? [c.agent, agentByKey(c.agent)?.label || c.agent] : by === 'day' ? [dayOf(c, x), dayOf(c, x)] : [String(x.context?.[by] ?? ''), String(x.context?.[by] ?? '') || 'Not given'];
    add.never = neverReached(orgOf(q));
    const groups = new Map(); const days = new Map(); const total = blank(); const outcomes = {};
    for (const c of list) for (const x of c.contacts) {
      const [k, label] = keyOf(c, x); if (only && k !== only) continue;
      if (!groups.has(k)) groups.set(k, { key: k, label, ...blank() }); add(groups.get(k), c, x); add(total, c, x);
      const d = dayOf(c, x); if (!days.has(d)) days.set(d, { day: d, ...blank() }); add(days.get(d), c, x);
      const o = contactOutcome(x); outcomes[o] = (outcomes[o] || 0) + 1;
    }
    const rows = [...groups.values()].sort((a, b) => by === 'day' ? b.key.localeCompare(a.key) : b.dialled - a.dialled || a.label.localeCompare(b.label));
    return { by, days: Number(q.get('days') || 30), generated_at: nowIso(), total, rows, trend: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)), by_outcome: outcomes, columns: columnsOf(list), campaigns: list.length,
      input: inputOf(only ? [] : list), why: whyFor(list), rows_line: rowsOf(list),
      // Agents with calls in the period (to pick one), and that agent's own answers when one is picked.
      agent: q.get('agent') || '', agents: [...new Set(campaigns.filter((c) => (c.org_id || 'org_moglix') === orgOf(q)).map((c) => c.agent))].map((key) => ({ key, label: agentByKey(key)?.label || key })).sort((a, b) => a.label.localeCompare(b.label)),
      answers: q.get('agent') ? answersOf(q.get('agent'), list) : [] };
  }
  on('GET', '/api/reports/summary', ({ res, q }) => json(res, 200, summary(q)));

  // ── Follow ups ────────────────────────────────────────────────────────────
  const owners = (org) => users.filter((u) => u.org_id === org || u.org_id === '*').map((u) => ({ user_id: u.user_id, email: u.email }));
  function followRows(q) {
    const org = orgOf(q); const out = []; const never = neverReached(org);
    for (const c of campaigns) {
      if ((c.org_id || 'org_moglix') !== org) continue;
      for (const x of c.contacts) {
        const reason = reasonFor(x, never); if (!reason && !x.follow_up) continue;
        const f = x.follow_up || {}; const last = lastDial(x);
        out.push({ campaign_id: c.campaign_id, campaign_name: c.name, agent: agentByKey(c.agent)?.label || c.agent, primary_id: x.primary_id, name: x.name, phone: x.phone,
          reason: f.reason || reason, reason_label: FOLLOW_REASONS[f.reason || reason]?.label || '', status: OUTCOMES[contactOutcome(x)]?.label || '', dials: (x.attempts_detail || []).length,
          since: last?.ended_at || last?.started_at || c.created_at, telephony: last?.provider ? { Status: last.provider.Status, CustomerStatus: last.provider.CustomerStatus, DialStatus: last.provider.DialStatus } : null,
          state: f.state || 'open', owner: f.owner || '', notes: f.notes || [], closed_as: f.closed_as || '', old_phone: f.old_phone || '', context: x.context || {} });
      }
    }
    return out.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  }
  on('GET', '/api/follow-ups', ({ res, q }) => {
    const all = followRows(q); const open = all.filter((r) => r.state === 'open');
    const want = q.get('state') || 'open';
    json(res, 200, { rows: all.filter((r) => r.state === want), counts: { open: open.length, done: all.length - open.length, by_reason: open.reduce((m, r) => { m[r.reason] = (m[r.reason] || 0) + 1; return m; }, {}) }, reasons: FOLLOW_REASONS, owners: owners(orgOf(q)) });
  });
  const rowOf = (p) => { const c = campaigns.find((k) => k.campaign_id === p.cid); const x = c?.contacts.find((r) => r.primary_id === p.pid); return [c, x]; };
  on('PATCH', '/api/follow-ups/:cid/:pid', ({ res, p, body }) => {
    const [, x] = rowOf(p); if (!x) return fail(res, 404, 'Contact not found');
    const f = (x.follow_up ||= { state: 'open', reason: followReason(x), notes: [] });
    f.notes ||= [];
    if ('owner' in body) f.owner = String(body.owner || '');
    if (body.note) f.notes.push({ text: String(body.note).slice(0, 500), by: body.by || 'admin@example.com', at: nowIso() });
    if (body.phone && String(body.phone) !== x.phone) { f.old_phone = x.phone; x.phone = String(body.phone).replace(/\D/g, '').slice(-10); f.notes.push({ text: `Number changed from ${f.old_phone} to ${x.phone}`, by: body.by || 'admin@example.com', at: nowIso(), system: true }); }
    if (body.state === 'done') { f.state = 'done'; f.closed_as = body.closed_as || 'No call needed'; f.closed_at = nowIso(); }
    if (body.state === 'open') { f.state = 'open'; f.closed_as = ''; }
    json(res, 200, { ok: true });
  });
  on('POST', '/api/follow-ups/:cid/:pid/call-again', ({ res, p, body }) => {
    const [c, x] = rowOf(p); if (!x) return fail(res, 404, 'Contact not found');
    const f = (x.follow_up ||= { state: 'open', reason: followReason(x), notes: [] });
    f.notes ||= [];
    f.notes.push({ text: 'Sent back to the agent to call again', by: body?.by || 'admin@example.com', at: nowIso(), system: true });
    Object.assign(f, { state: 'done', closed_as: 'Called again', closed_at: nowIso() });
    redial(c, x);
    json(res, 200, { ok: true });
  });

  // ── Report schedules ──────────────────────────────────────────────────────
  const schedules = [
    { id: 'rs_daily', org_id: 'org_moglix', name: 'End of day calling report', every: 'day', weekdays: [1, 2, 3, 4, 5], time: '18:30', days: 1, by: 'campaign', value: '', recipients: ['ops.lead@example.com', 'scm.head@example.com'], formats: ['image', 'excel'], include_follow_ups: true, on: true, last_sent_at: new Date(Date.now() - 18 * 3600000).toISOString(), created_by: 'admin@example.com' },
    { id: 'rs_weekly', org_id: 'org_moglix', name: 'Weekly summary', every: 'week', weekdays: [1], time: '08:30', days: 7, by: 'agent', value: '', recipients: ['business.head@example.com'], formats: ['pdf', 'excel'], include_follow_ups: false, on: true, last_sent_at: null, created_by: 'admin@example.com' },
  ];
  const clean = (b, old = {}) => ({
    name: String(b.name ?? old.name ?? '').trim().slice(0, 80), every: b.every === 'week' ? 'week' : b.every === 'day' ? 'day' : old.every || 'day',
    weekdays: Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : old.weekdays || [1, 2, 3, 4, 5],
    time: /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : old.time || '18:30', days: [1, 7, 30].includes(Number(b.days)) ? Number(b.days) : old.days || 1,
    by: String(b.by ?? old.by ?? 'campaign'), value: String(b.value ?? old.value ?? ''), agent: String(b.agent ?? old.agent ?? ''),
    recipients: (Array.isArray(b.recipients) ? b.recipients : old.recipients || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 25),
    formats: (Array.isArray(b.formats) ? b.formats : old.formats || ['image']).filter((f) => ['image', 'pdf', 'excel'].includes(f)),
    include_follow_ups: 'include_follow_ups' in b ? !!b.include_follow_ups : old.include_follow_ups ?? true, on: 'on' in b ? !!b.on : old.on ?? true,
  });
  const check = (s) => !s.name ? 'Give the report a name' : !s.recipients.length ? 'Add at least one email address' : !s.formats.length ? 'Pick at least one format' : !s.weekdays.length ? 'Pick at least one day' : '';
  on('GET', '/api/report-schedules', ({ res, q }) => json(res, 200, { schedules: schedules.filter((s) => s.org_id === orgOf(q)) }));
  on('POST', '/api/report-schedules', ({ res, q, body }) => {
    const s = clean(body); const err = check(s); if (err) return fail(res, 400, err);
    const made = { id: `rs_${randomUUID().slice(0, 8)}`, org_id: orgOf(q), ...s, last_sent_at: null, created_by: body.by || 'admin@example.com' }; schedules.push(made); json(res, 200, made);
  });
  on('PATCH', '/api/report-schedules/:id', ({ res, p, body }) => {
    const s = schedules.find((x) => x.id === p.id); if (!s) return fail(res, 404, 'Report not found');
    const next = clean(body, s); const err = check(next); if (err) return fail(res, 400, err); Object.assign(s, next); json(res, 200, s);
  });
  on('DELETE', '/api/report-schedules/:id', ({ res, p }) => { const i = schedules.findIndex((x) => x.id === p.id); if (i >= 0) schedules.splice(i, 1); json(res, 200, {}); });
  on('POST', '/api/report-schedules/:id/send-now', ({ res, p }) => {
    const s = schedules.find((x) => x.id === p.id); if (!s) return fail(res, 404, 'Report not found');
    s.last_sent_at = nowIso(); json(res, 200, { sent_to: s.recipients, at: s.last_sent_at });
  });

  // ── Spreadsheet: one workbook, five tabs ──────────────────────────────────
  on('GET', '/api/reports/export.xlsx', ({ res, q }) => {
    const s = summary(q); const list = inWindow(q); const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const cols = ['Contacts', 'Dialled', 'Reached', 'Reached %', 'Completed', 'Completed %', 'Not reached', 'Failed', 'In progress', 'Needs follow up', 'Talk minutes'];
    const line = (m) => [m.contacts, m.dialled, m.reached, pct(m.reached, m.dialled), m.completed, pct(m.completed, m.reached), m.not_reached, m.failed, m.in_progress, m.follow_up, Math.round(m.talk_seconds / 60)];
    const byLabel = s.by === 'campaign' ? 'Campaign' : s.by === 'agent' ? 'Agent' : s.by === 'day' ? 'Day' : s.by.replace(/_/g, ' ');
    const follow = followRows(q).filter((r) => r.state === 'open');
    const allRows = list.flatMap((c) => c.contacts.map((x) => { const last = lastDial(x); return [c.name, agentByKey(c.agent)?.label || c.agent, x.name || '', x.phone || '', OUTCOMES[contactOutcome(x)]?.label || '', OUTCOMES[contactOutcome(x)]?.group || '', (x.attempts_detail || []).length, last?.started_at || '', last?.talk_seconds || 0, last?.provider?.Status || '', last?.provider?.CustomerStatus || '', last?.provider?.DialStatus || '', x.call_id || '']; }));
    file(res, writeWorkbook([
      { name: 'Summary', rows: [['Period', `Last ${s.days} day${s.days === 1 ? '' : 's'}`], ['Made at', s.generated_at], ['Campaigns', s.campaigns], ...cols.map((c, i) => [c, line(s.total)[i]]), [], ['Call status', 'Contacts'], ...Object.entries(s.by_outcome).sort((a, b) => b[1] - a[1]).map(([k, n]) => [OUTCOMES[k]?.label || k, n])] },
      { name: `By ${byLabel}`.slice(0, 31), rows: [[byLabel, ...cols], ...s.rows.map((r) => [r.label, ...line(r)])] },
      { name: 'By day', rows: [['Day', ...cols], ...s.trend.map((r) => [r.day, ...line(r)])] },
      ...(s.answers.length ? [{ name: 'Answers', rows: [['Answer', 'Value', 'Count', 'Out of'], ...s.answers.flatMap((a) => a.type === 'number' ? [[a.label, 'Total', a.sum, a.answered], [a.label, 'Average', a.avg, a.answered]] : a.values.map((v) => [a.label, v.value, v.count, a.answered]))] }] : []),
      { name: 'Input problems', rows: [['Problem', 'Field', 'Rows', 'Result'], ...s.input.problems.map((p) => [p.label, p.field, p.rows, p.kind === 'reject' ? 'Rejected' : 'Warning'])] },
      ...(s.why.reasons.length ? [{ name: 'Why not finished', rows: [['Reason', 'Calls'], ...s.why.reasons.map((r) => [r.label, r.count])] }] : []),
      { name: 'Needs follow up', rows: [['Contact', 'Number', 'Campaign', 'Why', 'Dials', 'Since', 'Owner', 'Last note'], ...follow.map((r) => [r.name || '', r.phone, r.campaign_name, r.reason_label, r.dials, r.since, r.owner, r.notes.filter((n) => !n.system).slice(-1)[0]?.text || ''])] },
      { name: 'All contacts', rows: [['Campaign', 'Agent', 'Contact', 'Number', 'Call status', 'Group', 'Dials', 'Last dial at', 'Talk seconds', 'Telephony status', 'Telephony customer status', 'Telephony dial status', 'Call id'], ...allRows] },
    ]), XLSX, `calling-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}
