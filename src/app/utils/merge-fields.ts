/**
 * Keeping an edited generated block in step with the variable declarations.
 *
 * A generated section can be overridden — the operator rewrites the wording, adds
 * a note, reorders a line. When the variable list then changes, replacing the whole
 * body with freshly generated text would throw those edits away, and leaving it
 * alone would leave the prompt referring to variables that no longer exist.
 *
 * So Refresh merges instead: field lines are matched by their `{{token}}`, which is
 * the one part of a line that cannot be reworded. Lines for removed variables go,
 * lines for new variables arrive in their generated position, and every other line
 * — prose, headings, blank lines, and the operator's own wording of a field that
 * still exists — is left exactly as it was.
 */

/** A field line: "- Some Label: {{some_key}}". The label may be anything. */
const FIELD_RE = /^\s*-\s*.*?:\s*\{\{\s*(\w+)\s*\}\}\s*$/;

/** The variable a line declares, or null when the line is not a field line. */
export function fieldKey(line: string): string | null {
  const m = line.match(FIELD_RE);
  return m ? m[1] : null;
}

export function mergeFieldLines(body: string, generated: string): string {
  const genOrder: string[] = [];
  const genByKey = new Map<string, string>();
  for (const line of generated.split('\n')) {
    const key = fieldKey(line);
    if (key && !genByKey.has(key)) {
      genOrder.push(key);
      genByKey.set(key, line);
    }
  }
  // Nothing recognisable to sync against — leave the body untouched rather than
  // risk mangling it.
  if (genOrder.length === 0) return body;

  // Drop fields whose variable is gone.
  const lines = body.split('\n').filter(line => {
    const key = fieldKey(line);
    return key === null || genByKey.has(key);
  });

  const indexOfKey = (key: string) => lines.findIndex(l => fieldKey(l) === key);

  // Add fields that are new, each next to whichever of its generated neighbours is
  // already present — so an added variable lands among its siblings even when the
  // operator has moved the block around.
  genOrder.forEach((key, position) => {
    if (indexOfKey(key) !== -1) return;

    let at = -1;
    for (let j = position - 1; j >= 0 && at === -1; j--) {
      const found = indexOfKey(genOrder[j]);
      if (found !== -1) at = found + 1;
    }
    for (let j = position + 1; j < genOrder.length && at === -1; j++) {
      const found = indexOfKey(genOrder[j]);
      if (found !== -1) at = found;
    }
    lines.splice(at === -1 ? lines.length : at, 0, genByKey.get(key) as string);
  });

  return lines.join('\n');
}
