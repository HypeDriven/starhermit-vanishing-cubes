// Seeded deterministic random streams.
// Rules, decoration, and audiovisual variants each get independent streams so
// cosmetic randomness can never perturb the rules stream.

export function hashSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// cyrb53 — deterministic 53-bit string hash, used for state hashing/checksums.
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

export class Rng {
  constructor(seed) {
    this.s = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  }
  next() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  range(a, b) {
    return a + this.int(b - a + 1);
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
  state() {
    return this.s;
  }
  restore(s) {
    this.s = s >>> 0;
  }
  // Derive an independent stream without advancing this one.
  fork(label) {
    return new Rng(hashSeed(this.s + ':' + label));
  }
}

export function makeStreams(seed) {
  const root = new Rng(hashSeed(String(seed)));
  return {
    rules: root.fork('rules'),
    decor: root.fork('decor'),
    av: root.fork('av'),
  };
}
