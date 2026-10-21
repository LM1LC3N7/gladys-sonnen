// -----------------------------------------------------------------------------
// The local API v2 of a sonnenBatterie, plain HTTP on the home network
// (port 80), no cloud, after sonnen-api-v2 (Katamave, MIT, see
// THIRD_PARTY_NOTICES.md) and the API documentation the battery serves at
// /api/doc.html: GET requests with the read token in the `Auth-Token` header.
//
// READ-ONLY: only GET, only the five read endpoints of PATHS. No method here
// writes anything (no operating mode, no charge or discharge set point, no
// configuration): there is none to call.
//
// The token is only ever placed in the header of a request to the configured
// address; a redirect is never followed (the token never leaves for another
// host). Errors carry our own codes, never a text of the battery, never a URL,
// never the token. Every body is bounded (64 KiB) and read into one buffer.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { isConfigurations } from './model.js';

export class SonnenError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'refused'|'http'|'server'|'rate_limited'|'too_large'|
   *   'not_json'|'unknown_answer'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'SonnenError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

function networkError(err) {
  if (err instanceof SonnenError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new SonnenError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, read into ONE buffer of at most `limit` bytes (no buffer kept per
 * chunk, no concatenation): a longer one is not an answer of the battery.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = Buffer.allocUnsafe(limit);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (size + value.byteLength > limit) {
      await reader.cancel().catch(() => {});
      throw new SonnenError('too_large');
    }
    buffer.set(value, size);
    size += value.byteLength;
  }
  return buffer.toString('utf8', 0, size);
}

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/** The endpoints read after the configuration; each may fail alone. */
export const SECONDARY = [
  ['status', PATHS.STATUS],
  ['latest', PATHS.LATEST],
  ['powermeter', PATHS.POWERMETER],
  ['battery', PATHS.BATTERY],
];

export class SonnenClient {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
  }

  /** One GET of `path` at `address` (`host:port`): its parsed JSON (an object or an array). */
  async get(address, path, token) {
    let response;
    let text;
    try {
      response = await this.fetch(`http://${address}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Auth-Token': token },
        // A redirect is never followed: the token stays on this address.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
      // The body can fail too (timeout, connection cut): same errors.
      text = await readBounded(response, MAX_BODY_BYTES);
    } catch (err) {
      throw networkError(err);
    }
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new SonnenError('refused', { status });
    }
    if (status === 429 || status >= 500) {
      throw new SonnenError(status === 429 ? 'rate_limited' : 'server', {
        status,
        retryAfter: retryAfterOf(response, this.now),
      });
    }
    if (status < 200 || status >= 300) {
      throw new SonnenError('http', { status });
    }
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new SonnenError('not_json');
    }
    if (answer === null || typeof answer !== 'object') {
      throw new SonnenError('unknown_answer');
    }
    return answer;
  }

  /** The configuration: the token check (an answer of a sonnenBatterie, accepted). */
  async readConfigurations(address, token) {
    const answer = await this.get(address, PATHS.CONFIGURATIONS, token);
    if (!isConfigurations(answer)) {
      throw new SonnenError('unknown_answer');
    }
    return answer;
  }

  /**
   * One read: the configuration first (required: it proves that the battery
   * at this address takes this token), then each secondary endpoint. A
   * secondary endpoint that fails with an error of the battery (5xx, an odd
   * answer) only leaves its values out (`missing`); a refused token or a 429
   * stops the read; a network failure stops the remaining requests (kept:
   * what came). `alive()` false (a restart, a new configuration) stops
   * between two requests.
   * @returns {Promise<{ configurations, status?, latest?, powermeter?, battery?, missing: string[] }>}
   */
  async readAll(address, token, alive = () => true) {
    const result = { configurations: await this.readConfigurations(address, token), missing: [] };
    for (const [name, path] of SECONDARY) {
      if (!alive()) {
        break;
      }
      try {
        result[name] = await this.get(address, path, token);
      } catch (err) {
        if (err.code === 'refused' || err.code === 'rate_limited') {
          throw err;
        }
        result.missing.push(name);
        if (err.code === 'timeout' || err.code === 'unreachable') {
          for (const [rest] of SECONDARY.slice(SECONDARY.findIndex(([n]) => n === name) + 1)) {
            result.missing.push(rest);
          }
          break;
        }
      }
    }
    return result;
  }
}
