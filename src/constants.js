// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the battery: `battery:main`. The read API of a
 * sonnenBatterie gives no serial number: one battery per integration (the one
 * whose token is configured), its device kept whatever its address.
 */
export const EXTERNAL_ID_TYPE = 'battery';
export const DEVICE_KEY = 'main';

// --- The local API v2 of the battery (read token, `Auth-Token` header) ---------
export const DEFAULT_PORT = 80;
export const PATHS = {
  /** The configuration of the battery: read first, the token check of every read. */
  CONFIGURATIONS: '/api/v2/configurations',
  STATUS: '/api/v2/status',
  LATEST: '/api/v2/latestdata',
  POWERMETER: '/api/v2/powermeter',
  BATTERY: '/api/v2/battery',
};
/** The library waits 20 s; an answer of a battery on the home network comes far sooner. */
export const HTTP_TIMEOUT = 10_000;
/** The answers are a few KiB: more is not an answer of the battery. */
export const MAX_BODY_BYTES = 64 * 1024;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The reading interval of the form (s): 30 s by default, 30 to 300. */
export const POLL_DEFAULT = 30;
export const POLL_MIN = 30;
export const POLL_MAX = 300;
/** How often the integration looks whether a read is due (never a read by itself). */
export const TICK = 5 * SECOND;
/**
 * The instant of the last request is written to /data at most once a minute:
 * after a restart, the first read waits this long on top of the interval, so
 * that a container restarting in a loop never reads faster than the interval.
 */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** The states sent in any 60 s, at most (the core refuses a whole batch beyond 300). */
export const STATES_PER_MINUTE = 270;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** Unreachable: tried again after 1 min (never faster than a read), doubled up to 15 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 15 * MINUTE;
/** HTTP 429 or 5xx on the configuration: a pause from 60 s to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** Token refused (401/403): a stop kept in /data, tried again after 15 min, doubled up to 6 h. */
export const REFUSED_FIRST = 15 * MINUTE;
export const REFUSED_MAX = 6 * HOUR;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** The second click of "Accept the held index" counts from 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;
/** Values older than this many intervals are no longer published as current. */
export const FRESH_INTERVALS = 2;

// --- Energy index ---------------------------------------------------------------------
/**
 * The guard of each index (src/guard.js), its own margin: the production
 * meter of a sonnenBatterie measures the whole solar installation (the
 * battery model does not bound it): 30 kW covers a home installation, and
 * 0.5 kWh is always accepted on top (rounding, a late read).
 */
export const INDEX_LIMITS = { pv: { maxKw: 30, slackKwh: 0.5 } };

/** A power above this (W) is a glitch. */
export const POWER_MAX = 100_000;
/** A lifetime counter above this (kWh) is a glitch. */
export const ENERGY_MAX = 10_000_000;
