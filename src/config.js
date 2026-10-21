// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// The read token is a secret: it is never logged, never shown, never written
// to /data, and only ever sent to the configured address, in the `Auth-Token`
// header of a GET.
// -----------------------------------------------------------------------------

import {
  DEFAULT_PORT,
  POLL_DEFAULT,
  POLL_MAX,
  POLL_MIN,
  PV_ENERGY_MONITORING,
  PV_SENSOR_ONLY,
} from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port (80 when absent). A pasted URL ("http://192.168.1.30/api") is
 * reduced to its host and port. (The parser of gladys-p1-monitor.)
 * @returns {{ address: string } | { error: 'invalid' } | { empty: true }}
 *   `address` is always `host:port`.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { empty: true };
  }
  if (text.length > 300) {
    return { error: 'invalid' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return withPort(`[${text.toLowerCase()}]`, undefined);
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

function withPort(host, port) {
  const number = port === undefined ? DEFAULT_PORT : Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: `${host}:${number}` };
}

/**
 * The read token: printable ASCII without spaces, 8 to 256 characters (a
 * header value never carries a line break). Anything else is refused before
 * any request, without being echoed.
 */
const TOKEN = /^[\x21-\x7e]{8,256}$/;

/** The reading interval (s): a number from 30 to 300, else 30. */
function pollOf(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return POLL_DEFAULT;
  }
  return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(value)));
}

/**
 * `{ address, token, pollInterval, problem }`: `address` and `token` are
 * undefined when missing or invalid; `problem` is 'address_missing',
 * 'address_invalid', 'token_missing', 'token_invalid' or undefined.
 */
export function normalizeConfig(raw = {}) {
  const parsed = parseAddress(typeof raw?.address === 'string' ? raw.address : '');
  const tokenText = typeof raw?.token === 'string' ? raw.token.trim() : '';
  const token = TOKEN.test(tokenText) ? tokenText : undefined;
  let problem;
  if (parsed.empty) problem = 'address_missing';
  else if (parsed.error) problem = 'address_invalid';
  else if (tokenText === '') problem = 'token_missing';
  else if (!token) problem = 'token_invalid';
  return {
    address: parsed.address,
    token: problem ? undefined : token,
    pollInterval: pollOf(raw?.poll_interval),
    // The solar production as an index of the energy monitoring (default), or
    // a plain sensor only (an inverter already sends it to Gladys).
    pvIndex: raw?.pv_index === PV_SENSOR_ONLY ? PV_SENSOR_ONLY : PV_ENERGY_MONITORING,
    problem,
  };
}
