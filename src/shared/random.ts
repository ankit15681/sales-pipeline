/** Small seeded PRNG (mulberry32) so the 50k dataset is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

export const between = (rand: () => number, min: number, max: number) => min + rand() * (max - min);

let idCounter = 0;
/** Unique-enough id for mutations/toasts; not security relevant. */
export const uid = (prefix = 'm') => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
