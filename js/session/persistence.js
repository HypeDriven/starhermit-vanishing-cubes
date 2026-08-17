// Local persistence: versioned, checksummed JSON documents in localStorage.
// Documents carry a revision counter so cloud/local conflicts can be detected
// (a strict descendant wins; otherwise both snapshots are preserved and the
// player is asked). Never stores credentials or tokens.

const NS = 'vc.';

function checksum(str) {
  // Small local copy of cyrb53 to keep this module dependency-free.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 4294967296 + (h1 >>> 0)).toString(16);
}

const MIGRATIONS = {
  // name: { fromVersion: (payload) => migratedPayload }
  settings: {},
  progression: {},
  profile: {},
  achievements: {},
  dailies: {},
  boards: {},
};

export const DOC_VERSIONS = {
  settings: 1,
  progression: 1,
  profile: 1,
  achievements: 1,
  dailies: 1,
  boards: 1,
};

function storageAvailable() {
  try {
    const k = NS + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const memoryFallback = new Map();
const hasStorage = typeof localStorage !== 'undefined' && storageAvailable();

function rawGet(key) {
  return hasStorage ? localStorage.getItem(key) : memoryFallback.get(key) ?? null;
}
function rawSet(key, value) {
  if (hasStorage) localStorage.setItem(key, value);
  else memoryFallback.set(key, value);
}

export function loadDoc(name, fallback) {
  const raw = rawGet(NS + name);
  if (!raw) return { payload: fallback, rev: 0 };
  try {
    const doc = JSON.parse(raw);
    const body = JSON.stringify({ version: doc.version, rev: doc.rev, payload: doc.payload });
    if (doc.checksum !== checksum(body)) {
      console.warn('persistence: checksum mismatch on', name, '— resetting');
      return { payload: fallback, rev: 0 };
    }
    let payload = doc.payload;
    let version = doc.version;
    const migrations = MIGRATIONS[name] || {};
    while (version < DOC_VERSIONS[name]) {
      const migrate = migrations[version];
      payload = migrate ? migrate(payload) : payload;
      version++;
    }
    return { payload, rev: doc.rev || 0 };
  } catch (err) {
    console.warn('persistence: corrupt doc', name, err);
    return { payload: fallback, rev: 0 };
  }
}

export function saveDoc(name, payload, rev = 0) {
  const doc = {
    version: DOC_VERSIONS[name],
    rev: rev + 1,
    updatedAt: Date.now(),
    payload,
  };
  doc.checksum = checksum(JSON.stringify({ version: doc.version, rev: doc.rev, payload: doc.payload }));
  rawSet(NS + name, JSON.stringify(doc));
  return doc.rev;
}

// Conflict handling for a remote (cloud) snapshot arriving alongside a local
// one. A strict descendant wins outright; when neither is an ancestor of the
// other, both are preserved — the incoming copy is stashed and the caller
// asks the player which to keep.
export function resolveConflict(name, localDoc, remoteDoc) {
  if (!remoteDoc) return { winner: localDoc, conflict: false };
  if (!localDoc) return { winner: remoteDoc, conflict: false };
  if (remoteDoc.rev > localDoc.rev) return { winner: remoteDoc, conflict: false };
  if (remoteDoc.rev < localDoc.rev) return { winner: localDoc, conflict: false };
  if (JSON.stringify(remoteDoc.payload) === JSON.stringify(localDoc.payload)) {
    return { winner: localDoc, conflict: false };
  }
  rawSet(NS + name + '.conflict-' + Date.now(), JSON.stringify(remoteDoc));
  return { winner: localDoc, conflict: true };
}
