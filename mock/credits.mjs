// Credits: one wallet per workspace. Everything Echo charges for is priced in credits,
// so a team buys credits once and spends them on agents, numbers, calls and work done for them.
// Prices are drafts (1 credit is about 1 rupee); they live here so the app never hard codes one.
import { randomUUID } from 'node:crypto';

export const PRICES = [
  { key: 'answered_line', group: 'Calling', label: 'Answered line', unit: 'per line answered', credits: 9, note: 'Calls nobody picks up are free. Above 20,000 lines a month: 7 credits.' },
  { key: 'test_call', group: 'Calling', label: 'Test call', unit: 'per minute', credits: 6, note: 'Calls to your own number while you set up' },
  { key: 'ai_build', group: 'Agents', label: 'Build an agent with AI', unit: 'per agent', credits: 150, note: 'Reads your files, asks its questions and sets everything up' },
  { key: 'ai_edit', group: 'Agents', label: 'Change an agent with AI', unit: 'per change', credits: 10, note: 'Describe the change in plain words' },
  { key: 'file_match', group: 'Agents', label: 'Match a sheet to an agent', unit: 'per file', credits: 0, note: 'Free. Any column names work' },
  { key: 'number', group: 'Numbers', label: 'Phone number', unit: 'per number a month', credits: 999, note: 'India local and 1600 series; more countries on request' },
  { key: 'pilot', group: 'Done for you', label: 'Paid pilot', unit: '4 weeks', credits: 40000, note: 'One Pack set up and run on your own lines, with weekly reviews' },
  { key: 'custom_agent', group: 'Done for you', label: 'Agent built by our team', unit: 'from', credits: 100000, note: 'Quoted after a short call. 5,000 credit deposit, counted in the quote' },
  { key: 'custom_integration', group: 'Done for you', label: 'Custom integration', unit: 'from', credits: 50000, note: 'ERP, CRM or database write back. Quoted after a short call' },
];
export const PACKS = [
  { key: 'starter', label: 'Starter', credits: 25000, bonus: 0, price: 25000, fits: 'About 2,700 answered lines' },
  { key: 'growth', label: 'Growth', credits: 100000, bonus: 10000, price: 100000, fits: 'About 12,000 answered lines', best: true },
  { key: 'scale', label: 'Scale', credits: 500000, bonus: 75000, price: 500000, fits: 'About 64,000 answered lines' },
];
const DEPOSIT = 5000;
const price = (k) => PRICES.find((p) => p.key === k)?.credits ?? 0;
const AVAILABLE = [
  { number: '+91 22 4890 1120', region: 'Mumbai', kind: 'Local' }, { number: '+91 22 4890 1146', region: 'Mumbai', kind: 'Local' },
  { number: '+91 11 4129 7703', region: 'Delhi', kind: 'Local' }, { number: '+91 80 6911 2208', region: 'Bengaluru', kind: 'Local' },
  { number: '1600 22 4410', region: 'India', kind: '1600 series for service calls' }, { number: '1600 11 7302', region: 'India', kind: '1600 series for service calls' },
  { number: '+971 4 512 0931', region: 'Dubai', kind: 'Local' },
];

export function registerCredits({ on, json, fail, campaigns, agentByKey, orgOf, nowIso, rowStates, planOf, who, isPlatformAdmin }) {
  const wallets = new Map();
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  function wallet(org) {
    if (!wallets.has(org)) {
      wallets.set(org, {
        auto_topup: { on: false, pack: 'growth', below: 10000 }, low_at: 10000,
        entries: [
          { id: 'e1', at: day(24), kind: 'purchase', group: 'Bought', label: 'Growth pack', credits: 110000, by: 'admin@example.com', note: 'Includes 10,000 bonus credits' },
          { id: 'e2', at: day(23), kind: 'number', group: 'Numbers', label: 'Phone number 080 0000 0101, one month', credits: -999, by: 'admin@example.com' },
          { id: 'e3', at: day(23), kind: 'number', group: 'Numbers', label: 'Phone number 080 0000 0103, one month', credits: -999, by: 'admin@example.com' },
          { id: 'e4', at: day(9), kind: 'ai_build', group: 'Agents', label: 'Built with AI: Kavya, Order Tracker Follow Up', credits: -150, by: 'admin@example.com' },
          { id: 'e5', at: day(6), kind: 'test_call', group: 'Calling', label: 'Test calls, 7 minutes', credits: -42, by: 'ops.buyer1@example.com' },
          { id: 'e6', at: day(3), kind: 'custom_integration', group: 'Done for you', label: 'Deposit: SAP S/4 write back', credits: -DEPOSIT, by: 'admin@example.com' },
        ],
        numbers: [
          { number: '080 0000 0101', region: 'India', kind: 'Local', since: day(23), renews: day(-7), flow: 'PAAS_postpo' },
          { number: '080 0000 0102', region: 'India', kind: 'Local', since: day(40), renews: day(-20), flow: 'RFX_reminder' },
          { number: '080 0000 0103', region: 'India', kind: 'Local', since: day(23), renews: day(-7), flow: 'PAAS_followup' },
        ],
        requests: [
          { id: 'r1', kind: 'custom_integration', title: 'SAP S/4 write back', details: 'Write each confirmed line (new date, dispatched quantity, reason) back to the PO schedule line.', status: 'quoted',
            deposit: DEPOSIT, quote: 60000, eta: '3 weeks', created_at: day(3), by: 'admin@example.com',
            updates: [{ at: day(3), by: 'admin@example.com', text: 'Request sent' }, { at: day(1), by: 'Vanik team', text: 'Quoted 60,000 credits, about 3 weeks. Includes testing on your QA system.' }] },
        ],
      });
    }
    return wallets.get(org);
  }
  /** Calls are charged per answered line, worked out from each campaign's rows, so the bill always matches the results. */
  function campaignCharges(org) {
    return campaigns.filter((c) => (c.org_id || 'org_moglix') === org && !c.archived_at).map((c) => {
      const lines = c.contacts.reduce((n, x) => n + rowStates(c, x).filter((r) => r.state === 'answered').length, 0);
      return lines ? { id: `c_${c.campaign_id}`, at: c.created_at, kind: 'answered_line', group: 'Calling', label: `${lines} answered line${lines === 1 ? '' : 's'}: ${String(c.name).replace(/_\d{8,}$/, '')}`, credits: -lines * price('answered_line'), by: c.created_by || 'admin@example.com', ref: c.campaign_id } : null;
    }).filter(Boolean);
  }
  function view(org) {
    const w = wallet(org);
    const ledger = [...w.entries, ...campaignCharges(org)].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const balance = ledger.reduce((n, e) => n + e.credits, 0);
    const since = Date.now() - 30 * 86400000;
    const usage = {};
    for (const e of ledger) if (e.credits < 0 && Date.parse(e.at) >= since) usage[e.group] = (usage[e.group] || 0) - e.credits;
    const held = w.requests.filter((r) => r.status === 'accepted' || r.status === 'in_progress').reduce((n, r) => n + Math.max(0, (r.quote || 0) - r.deposit), 0);
    return { balance, low: balance < w.low_at, low_at: w.low_at, auto_topup: w.auto_topup, prices: PRICES, packs: PACKS, usage_30d: usage, ledger: ledger.slice(0, 60), held, requests: w.requests, numbers: w.numbers };
  }
  /** Spend from the wallet; refuses when there is not enough. Returns the entry or null. */
  function spend(org, kind, label, credits, ref) {
    const v = view(org);
    if (credits > v.balance) return null;
    const e = { id: randomUUID().slice(0, 8), at: nowIso(), kind, group: PRICES.find((p) => p.key === kind)?.group || 'Other', label, credits: -credits, by: who(), ref };
    wallet(org).entries.push(e); return e;
  }
  const short = (org, need) => `Not enough credits: this needs ${need.toLocaleString('en-IN')} and the workspace has ${view(org).balance.toLocaleString('en-IN')}. Buy credits to go on.`;

  on('GET', '/api/orgs/:org/credits', ({ res, p }) => json(res, 200, view(p.org)));
  on('POST', '/api/orgs/:org/credits/buy', ({ res, p, body }) => {
    const pack = PACKS.find((x) => x.key === body.pack); if (!pack) return fail(res, 400, 'Pick a pack');
    wallet(p.org).entries.push({ id: randomUUID().slice(0, 8), at: nowIso(), kind: 'purchase', group: 'Bought', label: `${pack.label} pack`, credits: pack.credits + pack.bonus, by: who(),
      note: `${body.method === 'invoice' ? 'Invoice sent to accounts' : body.method === 'card' ? 'Paid by card' : 'Paid by UPI'}${pack.bonus ? `; includes ${pack.bonus.toLocaleString('en-IN')} bonus credits` : ''}` });
    json(res, 200, view(p.org));
  });
  on('PUT', '/api/orgs/:org/credits/auto-topup', ({ res, p, body }) => { wallet(p.org).auto_topup = { on: !!body.on, pack: body.pack || 'growth', below: Number(body.below) || 10000 }; json(res, 200, view(p.org)); });
  on('POST', '/api/orgs/:org/credits/spend', ({ res, p, body }) => {
    const credits = Number(body.credits ?? price(body.kind));
    const e = spend(p.org, body.kind, body.label || body.kind, credits, body.ref);
    e ? json(res, 200, { entry: e, ...view(p.org) }) : fail(res, 402, short(p.org, credits));
  });

  // Work done by the Vanik team: a request, a quote, then the customer accepts.
  on('POST', '/api/orgs/:org/requests', ({ res, p, body }) => {
    const kind = body.kind === 'custom_integration' ? 'custom_integration' : 'custom_agent';
    if (!String(body.title || '').trim()) return fail(res, 400, 'Say what you need in a line');
    const e = spend(p.org, kind, `Deposit: ${body.title}`, DEPOSIT); if (!e) return fail(res, 402, short(p.org, DEPOSIT));
    const r = { id: randomUUID().slice(0, 6), kind, title: body.title.trim(), details: body.details || '', files: body.files || [], status: 'submitted', deposit: DEPOSIT, quote: null, eta: '', created_at: nowIso(), by: who(),
      updates: [{ at: nowIso(), by: who(), text: 'Request sent. The Vanik team replies within one working day.' }] };
    wallet(p.org).requests.unshift(r); json(res, 201, view(p.org));
  });
  on('POST', '/api/orgs/:org/requests/:id/accept', ({ res, p }) => {
    const r = wallet(p.org).requests.find((x) => x.id === p.id); if (!r) return fail(res, 404, 'Request not found');
    if (r.status !== 'quoted') return fail(res, 409, 'Only a quoted request can be accepted');
    const rest = r.quote - r.deposit; const e = spend(p.org, r.kind, `${r.title} (quote less deposit)`, rest, r.id); if (!e) return fail(res, 402, short(p.org, rest));
    r.status = 'in_progress'; r.updates.push({ at: nowIso(), by: who(), text: `Quote accepted; ${rest.toLocaleString('en-IN')} credits used` }); json(res, 200, view(p.org));
  });
  on('POST', '/api/orgs/:org/requests/:id/cancel', ({ res, p }) => {
    const w = wallet(p.org); const r = w.requests.find((x) => x.id === p.id); if (!r) return fail(res, 404, 'Request not found');
    if (!['submitted', 'quoted'].includes(r.status)) return fail(res, 409, 'Work has started; talk to the Vanik team to stop it');
    r.status = 'cancelled'; r.updates.push({ at: nowIso(), by: who(), text: 'Cancelled; deposit returned' });
    w.entries.push({ id: randomUUID().slice(0, 8), at: nowIso(), kind: 'refund', group: 'Bought', label: `Deposit returned: ${r.title}`, credits: r.deposit, by: who() });
    json(res, 200, view(p.org));
  });
  // The Vanik team (platform admins) answers requests from the same page.
  on('PATCH', '/api/orgs/:org/requests/:id', ({ res, p, body }) => {
    if (!isPlatformAdmin()) return fail(res, 403, 'Only the Vanik team can quote');
    const r = wallet(p.org).requests.find((x) => x.id === p.id); if (!r) return fail(res, 404, 'Request not found');
    if (body.quote) { r.quote = Number(body.quote); r.eta = body.eta || r.eta; r.status = 'quoted'; r.updates.push({ at: nowIso(), by: 'Vanik team', text: `Quoted ${r.quote.toLocaleString('en-IN')} credits${r.eta ? ', about ' + r.eta : ''}.` }); }
    if (body.status === 'delivered') { r.status = 'delivered'; r.updates.push({ at: nowIso(), by: 'Vanik team', text: body.note || 'Delivered and live.' }); }
    json(res, 200, view(p.org));
  });

  // Phone numbers bought with credits.
  on('GET', '/api/numbers/available', ({ res, q }) => { const owned = new Set([...wallets.values()].flatMap((w) => w.numbers.map((n) => n.number))); json(res, 200, { numbers: AVAILABLE.filter((n) => !owned.has(n.number)).map((n) => ({ ...n, credits: price('number') })) }); });
  on('POST', '/api/orgs/:org/numbers', ({ res, p, body }) => {
    const n = AVAILABLE.find((x) => x.number === body.number); if (!n) return fail(res, 404, 'That number is no longer free');
    const e = spend(p.org, 'number', `Phone number ${n.number}, one month`, price('number')); if (!e) return fail(res, 402, short(p.org, price('number')));
    wallet(p.org).numbers.push({ ...n, since: nowIso(), renews: new Date(Date.now() + 30 * 86400000).toISOString(), flow: '' });
    json(res, 201, view(p.org));
  });

  return { spend, view, price, short };
}
