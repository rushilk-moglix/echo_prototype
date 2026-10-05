/** G.711 µ-law codecs — ported verbatim from the React codebase. */

export function linToUlaw(s: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (s >> 8) & 0x80;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let m = 0x4000; (s & m) === 0 && exp > 0; exp--, m >>= 1) {
    /* find exponent */
  }
  return ~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0f)) & 0xff;
}

export function ulawToLin(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exp = (u >> 4) & 7;
  const mant = u & 0x0f;
  const s = (((mant << 3) + 0x84) << exp) - 0x84;
  return sign ? -s : s;
}
