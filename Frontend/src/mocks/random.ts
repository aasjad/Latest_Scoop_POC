/** Deterministic PRNG so seeded history and appearances are stable across reloads. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const pick = <T,>(rnd: () => number, items: readonly T[]) => items[Math.floor(rnd() * items.length)];
export const range = (rnd: () => number, min: number, max: number) => min + rnd() * (max - min);

/** Exponential sample with the given mean. */
export const exp = (rnd: () => number, mean: number) => -Math.log(1 - rnd()) * mean;
