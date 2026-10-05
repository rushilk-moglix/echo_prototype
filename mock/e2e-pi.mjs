// End to end check of the PI Industries flow against the running mock (npm run mock, port 8090):
// template -> filled sheet (20 PO rows, 6 suppliers, synthetic) -> check -> campaign -> calls -> results file.
// Usage: node mock/e2e-pi.mjs [outDir]. Exits 1 if any check fails. Writes the sheets it used to outDir.
import { writeFileSync, mkdirSync } from 'node:fs';
import { writeXlsx, readXlsx } from './xlsx.mjs';

const API = process.env.ECHO_API || 'http://localhost:8090';
const OUT = process.argv[2] || './pi-e2e';
mkdirSync(OUT, { recursive: true });
const checks = [];
const ok = (name, pass, detail = '') => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
let token = '';
const url = (p, q = {}) => `${API}${p}?${new URLSearchParams({ token, org_id: 'org_pi', ...q })}`;
const get = async (p, q) => { const r = await fetch(url(p, q)); if (!r.ok) throw new Error(`${p} ${r.status} ${await r.text()}`); return r; };
const post = async (p, body, q) => {
  const isForm = body instanceof FormData;
  const r = await fetch(url(p, q), { method: 'POST', body: isForm ? body : JSON.stringify(body || {}), headers: isForm ? {} : { 'Content-Type': 'application/json' } });
  const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t}`); return t ? JSON.parse(t) : {};
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'local-test' }) });
token = (await login.json()).access_token; ok('Sign in', !!token);

// 1. Input template from the agent
const AGENT = 'pi_packaging_followup';
const tpl = Buffer.from(await (await get(`/api/agents/${AGENT}/template.xlsx`)).arrayBuffer());
writeFileSync(`${OUT}/PI-input-template-from-app.xlsx`, tpl);
const [head] = readXlsx(tpl);
const need = ['supplier_code', 'supplier_name', 'contact_person', 'phone_number', 'plant', 'po_number', 'item', 'pending_qty', 'due_date'];
ok('Template has every input column', need.every((k) => head.includes(k)), head.join(', '));

// 2. A filled sheet: 6 suppliers, 20 PO rows (one supplier has 10 rows, so it splits 8 + 2), synthetic values only
const sup = [['SUP-2001', 'Alpha Packaging', 2], ['SUP-2002', 'Beta Polymers', 3], ['SUP-2003', 'Gamma Containers', 2], ['SUP-2004', 'Delta Print Pack', 10], ['SUP-2005', 'Epsilon Closures', 1], ['SUP-2006', 'Zeta Films', 2]];
const rows = []; let n = 0;
for (const [code, name, lines] of sup) for (let i = 0; i < lines; i++) {
  n++;
  rows.push({ supplier_code: code, supplier_name: name, contact_person: 'Test Contact', phone_number: `90000020${String(sup.findIndex((s) => s[0] === code) + 1).padStart(2, '0')}`, plant: 'Plant 1',
    po_number: `45000${20000 + n}/10`, item: `Packaging item ${n}`, pending_qty: String(500 + n * 50), due_date: `${String(1 + (n % 27)).padStart(2, '0')}/11/2026` });
}
const filled = writeXlsx([need, ...rows.map((r) => need.map((k) => r[k]))], 'Contacts');
writeFileSync(`${OUT}/PI-input-filled-sample.xlsx`, filled);
const form = () => { const f = new FormData(); f.append('file', new Blob([filled]), 'PI-input-filled-sample.xlsx'); return f; };

// 3. Check before creating anything
const chk = await post(`/api/agents/${AGENT}/check-file`, form());
ok('Check: 20 rows read', chk.rows === 20, `rows ${chk.rows}`);
ok('Check: grouped into 7 calls (8 + 2 split for one supplier)', chk.calls === 7, `calls ${chk.calls}`);
ok('Check: no missing columns', !(chk.missing_columns || []).length);

// 4. Campaign, upload, calls
const { campaign_id } = await post('/api/campaigns', { agent: AGENT, direction: 'outbound', description: 'PI E2E check' });
ok('Campaign created', !!campaign_id, campaign_id);
const up = await post(`/api/campaigns/${campaign_id}/upload`, form());
ok('Upload stored 7 calls', up.stored === 7, `stored ${up.stored}, dialled ${up.dial?.dialled}`);
// Wait until every call has finished its first dial: a final status, or a retry booked by the agent's rules.
const LIVE = new Set(['waiting', 'calling', 'on_call']);
let contacts = [];
for (let i = 0; i < 60; i++) {
  contacts = (await (await get(`/api/campaigns/${campaign_id}/contacts`)).json()).contacts;
  if (contacts.length && contacts.every((c) => c.outcome && !LIVE.has(c.outcome))) break;
  await sleep(5000);
}
const camp = await (await get(`/api/campaigns/${campaign_id}`)).json();
ok('Every call finished its first dial (final or retry booked)', contacts.every((c) => !LIVE.has(c.outcome)), `campaign ${camp.status}`);

// 5. Contacts: every call has a call status
ok('Every call has a call status', contacts.every((c) => c.outcome), contacts.map((c) => c.outcome).join(', '));

// 6. Results file: every uploaded row once, in file order, with call status and its own answers
const res = Buffer.from(await (await get(`/api/campaigns/${campaign_id}/results.xlsx`)).arrayBuffer());
writeFileSync(`${OUT}/PI-output-results-sample.xlsx`, res);
const [rh, ...rr] = readXlsx(res);
ok('Results: 20 rows, one per uploaded row', rr.length === 20, `rows ${rr.length}`);
ok('Results: inputs, call status and row answers present', ['po_number', 'call_status', 'call_result', 'dispatch_status'].every((k) => rh.includes(k)), rh.join(', '));
ok('Results: no duplicate column names', new Set(rh).size === rh.length);
ok('Results: file order kept', rr.map((r) => r[rh.indexOf('po_number')]).join() === rows.map((r) => r.po_number).join());
const reached = rr.filter((r) => /Completed|Caller hung up/.test(r[rh.indexOf('call_status')]));
ok('Results: reached rows carry a dispatch status', reached.every((r) => r[rh.indexOf('dispatch_status')]), `${reached.length} reached rows`);

const failed = checks.filter((c) => !c.pass);
writeFileSync(`${OUT}/PI-e2e-report.json`, JSON.stringify({ at: new Date().toISOString(), campaign_id, checks }, null, 1));
console.log(failed.length ? `\n${failed.length} check(s) failed` : `\nAll ${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
