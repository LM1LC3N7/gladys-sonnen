// -----------------------------------------------------------------------------
// What must survive a restart of the container (a small JSON file under
// /data, the only writable place): the instant of the last request (written
// at most once a minute), a pause asked by the battery (429/5xx), a refused
// token, the guards of the energy index, and what the Discovery list shows
// (firmware, number of modules: nothing secret).
//
// The token is never written. Only while a token is refused, the file keeps a
// salted scrypt fingerprint (16 bytes, a random salt per file) of that
// refused, wrong token, to know after a restart whether the refusal still
// concerns the configured one; it is erased by the first successful read.
// Nothing in the file can confirm a token that works. (After gladys-air-q.)
//
// Written through a temporary file and a rename, one write at a time; a
// failure is logged once, never fatal. Never any text of the battery.
// -----------------------------------------------------------------------------

import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/sonnen-state.json';
const MAX_FILE = 64 * 1024;

/** A JSON file: `load()` (sync, `{}` when absent or odd) and `save(data)` (atomic). */
export function createFileStore(file = DEFAULT_STATE_FILE) {
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    load() {
      try {
        const text = readFileSync(file, 'utf8');
        if (text.length > MAX_FILE) return {};
        const data = JSON.parse(text);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  let saves = 0;
  return {
    load: () => structuredClone(data),
    async save(next) {
      saves += 1;
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
    get saves() {
      return saves;
    },
  };
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A pause read back: `{ until, count, code, status }`, its end capped from now. */
export function validPause(pause, now, max) {
  if (
    !isObject(pause) ||
    finite(pause.until) === undefined ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + max),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** A refusal read back: `{ until, count, status, fp }`, its end capped from now. */
export function validRefusal(refusal, now, max) {
  if (
    !isObject(refusal) ||
    finite(refusal.until) === undefined ||
    !Number.isInteger(refusal.count) ||
    refusal.count < 1 ||
    typeof refusal.fp !== 'string' ||
    !/^[0-9a-f]{32}$/.test(refusal.fp)
  ) {
    return undefined;
  }
  return {
    until: Math.min(refusal.until, now + max),
    count: Math.min(refusal.count, 32),
    status: refusal.status === 403 ? 403 : 401,
    fp: refusal.fp,
  };
}

const FIRMWARE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

/** The non-secret facts of the battery read back from /data. */
export function validInfo(info) {
  if (!isObject(info)) return undefined;
  return {
    firmware:
      typeof info.firmware === 'string' && FIRMWARE.test(info.firmware) ? info.firmware : undefined,
    modules:
      Number.isInteger(info.modules) && info.modules >= 1 && info.modules <= 100
        ? info.modules
        : undefined,
  };
}

/**
 * The persisted state, sanitized: times capped (a request never "in the
 * future", a pause or a refusal never longer than a fresh one), so a clock
 * that jumped or a hand-edited file never stops the battery for longer.
 */
export function readState(raw, now, { maxPause, maxRefusal }) {
  const data = isObject(raw) ? raw : {};
  const salt =
    typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt)
      ? data.salt
      : randomBytes(16).toString('hex');
  const address =
    typeof data.address === 'string' && data.address.length <= 300 ? data.address : null;
  const indexes = {};
  if (isObject(data.indexes)) {
    for (const [id, state] of Object.entries(data.indexes).slice(0, 20)) {
      if (typeof id === 'string' && id.length <= 200 && isObject(state)) indexes[id] = state;
    }
  }
  const refusal = validRefusal(data.refusal, now, maxRefusal);
  return {
    salt,
    address,
    lastAttemptAt: Math.min(finite(data.lastAttemptAt) ?? 0, now),
    pause: address ? (validPause(data.pause, now, maxPause) ?? null) : null,
    // Kept until a read succeeds (its count spaces the next tries), past its end too.
    refusal: address && refusal ? refusal : null,
    info: validInfo(data.info) ?? null,
    indexes,
  };
}

/** The salted fingerprint of a REFUSED token for an address (never the token). */
export function fingerprint(salt, address, token) {
  return scryptSync(String(token), `${salt}:${address}`, 16).toString('hex');
}
