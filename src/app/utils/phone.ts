/**
 * Phone number utilities — ported from the React api.js.
 *
 * Normalise a typed number to E.164.
 * Indian 10-digit numbers get +91; anything already prefixed is left alone.
 */
export function toE164(raw: string): string {
  let s = (raw || '').trim().replace(/[\s()\-]/g, '');
  if (s.startsWith('+')) return s;
  s = s.replace(/\D/g, '');
  if (s.length === 10) return '+91' + s;
  if (s.length === 12 && s.startsWith('91')) return '+' + s;
  return s ? '+' + s : '';
}

export function isValidE164(v: string): boolean {
  return /^\+\d{8,15}$/.test(v);
}
