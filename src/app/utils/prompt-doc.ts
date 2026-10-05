/**
 * Full view of an agent prompt: every section as one plain text document.
 *
 * Each section starts with a marker line, then its body exactly as stored:
 *
 *   ==== IDENTITY ====
 *   ==== EXAMPLES (off) ====
 *   ==== Call details (auto: inputs) ====
 *
 * Sections are separated by one blank line. `toDoc` then `fromDoc` gives back the
 * same sections, byte for byte, so switching between Full and Blocks views loses
 * nothing. An auto section with no override shows AUTO_LINE instead of a body;
 * leaving that line in keeps it generated.
 */
export interface PromptSection {
  id?: string;
  title: string;
  body: string;
  kind: string;
  enabled?: boolean;
}

export const AUTO_LINE = '(filled in automatically from the call data)';
const MARK = /^==== (.*) ====$/;

function header(s: PromptSection): string {
  const auto = s.kind === 'input' || s.kind === 'output' ? ` (auto: ${s.kind}s)` : '';
  const off = s.enabled === false ? ' (off)' : '';
  return `==== ${s.title || 'Untitled'}${auto}${off} ====`;
}

export function toDoc(sections: PromptSection[]): string {
  return sections
    .map((s) => {
      const auto = s.kind === 'input' || s.kind === 'output';
      const body = auto && !(s.body || '').trim() ? AUTO_LINE : s.body || '';
      return `${header(s)}\n${body}`;
    })
    .join('\n\n');
}

/** Parses a Full view document. `previous` supplies ids for sections that kept their place and title. */
export function fromDoc(doc: string, previous: PromptSection[] = []): PromptSection[] {
  const lines = doc.split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => { if (MARK.test(l)) starts.push(i); });
  const out: PromptSection[] = [];

  // Text before the first marker becomes an untitled section, so nothing typed is lost.
  const lead = (starts.length ? lines.slice(0, starts[0]) : lines).join('\n');
  if (lead.trim()) out.push({ id: '', title: '', body: lead.replace(/\n\n$/, ''), kind: 'text', enabled: true });

  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    let raw = MARK.exec(lines[start])![1];
    let enabled = true;
    let kind = 'text';
    if (raw.endsWith(' (off)')) { enabled = false; raw = raw.slice(0, -6); }
    const auto = / \(auto: (inputs|outputs)\)$/.exec(raw);
    if (auto) { kind = auto[1] === 'inputs' ? 'input' : 'output'; raw = raw.slice(0, auto.index); }
    let body = lines.slice(start + 1, end).join('\n');
    if (n + 1 < starts.length && body.endsWith('\n')) body = body.slice(0, -1); // the blank separator line
    if (kind !== 'text' && body.trim() === AUTO_LINE) body = '';
    const title = raw === 'Untitled' ? '' : raw;
    out.push({ id: '', title, body, kind, enabled });
  });

  // Keep ids stable: reuse the id of the previous section with the same kind and title.
  const pool = [...previous];
  return out.map((s) => {
    const i = pool.findIndex((p) => p.kind === s.kind && (p.title || '') === s.title);
    if (i < 0) return s;
    const [match] = pool.splice(i, 1);
    return { ...match, ...s, id: match.id || '' };
  });
}
