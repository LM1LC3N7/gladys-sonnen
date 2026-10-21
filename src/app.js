// -----------------------------------------------------------------------------
// The integration itself: the battery of the configuration (address and read
// token), read every 30 s by default (configuration, status, latest data,
// meters, battery modules), its device, the solar production index checked
// by its guard, the pauses and the refusal of the token kept in /data, the
// test and accept buttons. index.js only wires the SDK handlers to it.
//
// READ-ONLY: only GET requests of the read API; no operating mode, no charge
// or discharge, no configuration is ever sent (no onSetValue at all).
//
// Pace: nothing reads the battery faster than the interval: not the timer,
// not the test button, not Discovery, not a (re)connection to Gladys, not a
// save of an unchanged configuration, not a restart of the container (the
// instant of the last request is kept in /data, written at most once a
// minute). A new address or a new token may be read at once.
//
// A read belongs to its generation (each start/stop opens a new one): a read
// that ends after a restart or a new configuration publishes nothing and sets
// no status. Identity: every read asks the configuration first, with the
// token; a read token belongs to one battery, so another battery at the
// address (DHCP) refuses it and gets nothing.
//
// Two clocks: `now` (wall clock) dates the index and what /data keeps;
// `monotonic` paces the reads, so that a wall clock set back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  ATTEMPT_SAVE_EVERY,
  FRESH_INTERVALS,
  INDEX_LIMITS,
  PAUSE_MAX,
  PAUSE_MIN,
  PV_SENSOR_ONLY,
  REFUSED_FIRST,
  REFUSED_MAX,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STATES_PER_MINUTE,
  TEST_ANSWER_WITHIN,
  TICK,
} from './constants.js';
import { INDEXES, buildDevice, ids, readStates, round } from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { SonnenClient } from './sonnen/client.js';
import { parseConfigurations, parseValues } from './sonnen/model.js';
import { createFileStore, fingerprint, readState } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const MINUTE = 60_000;

/** The index Gladys already holds for a feature of the created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

export class SonnenApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'sonnen' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    client,
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.client = client ?? new SonnenClient({ now });
    this.store = store;
    /** What /data keeps (src/store.js readState), read once. */
    this.kept = readState(store.load(), now(), { maxPause: PAUSE_MAX, maxRefusal: REFUSED_MAX });
    /** The instant of the last request as written in /data (written at most once a minute). */
    this.savedAttemptAt = this.kept.lastAttemptAt;
    /**
     * After a restart of the container: the first read waits the interval
     * and the minute the last request may have come after the one written.
     */
    this.restartedAt = this.kept.lastAttemptAt > 0 ? this.kept.lastAttemptAt : 0;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** The token of the last start (memory only): another one may be tried at once. */
    this.knownToken = undefined;
    /** Monotonic time of the last request started, in this process. */
    this.lastAttemptMono = undefined;
    /** Unreachable / odd answer: failures in a row, the monotonic time of the next try. */
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    /** The values of the last good read, its monotonic time, the endpoints that failed. */
    this.values = undefined;
    this.valuesAt = undefined;
    this.readAt = undefined;
    this.missing = [];
    /** The secondary endpoints that refuse the (good) token, at the last read. */
    this.denied = [];
    /** The address checked once for a configuration answering without a token, and the answer. */
    this.openChecked = undefined;
    this.openApi = false;
    /** A battery read once (now or before the restart): its device is in Discovery. */
    this.known = Boolean(this.kept.info);
    /** By index feature external id: IndexGuard. */
    this.guards = new Map();
    /** The first click of "Accept the held index": `{ at, listedAt, list }`, in memory only. */
    this.pendingAccept = undefined;
    this.publishedDevices = undefined;
    /** The states sent in the last minute: `[{ at, count }]`, monotonic (STATES_PER_MINUTE). */
    this.sent = [];
    /** By index feature external id: the hold last logged (`direction:from`). */
    this.loggedHolds = new Map();
    this.timer = undefined;
    this.busy = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user saved the form (not a reconnection). It accepts no index held back. */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    const { address, token } = this.config;
    let changed = false;
    if (address && address !== this.kept.address) {
      // Another address: its pace, pause and refusal start afresh (the device
      // and its index stay: the same battery may have moved).
      Object.assign(this.kept, { address, lastAttemptAt: 0, pause: null, refusal: null });
      this.savedAttemptAt = 0;
      this.restartedAt = 0;
      this.forgetPace();
      this.values = undefined;
      changed = true;
    }
    if (address && token) {
      const refusal = this.kept.refusal;
      const other =
        this.knownToken !== undefined
          ? this.knownToken !== token
          : Boolean(refusal) && refusal.fp !== fingerprint(this.kept.salt, address, token);
      this.knownToken = token;
      if (other) {
        // A new token: tried at once (a pause asked by the battery stays).
        this.kept.refusal = null;
        this.restartedAt = 0;
        this.forgetPace();
        changed = true;
      }
    }
    if (changed) {
      await this.saveState();
    }
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    if (!fresh) {
      // A (re)connection: every value again at the next read.
      this.gladys.forgetPublishedStates?.();
    }
    await this.discover();
    await this.updateStatus({ starting: true });
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(() => this.run(generation, () => this.tick()), TICK);
    this.firstRun = this.run(generation, () => this.tick());
  }

  forgetPace() {
    this.lastAttemptMono = undefined;
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return undefined;
    }
    try {
      return await job();
    } catch (err) {
      this.logger.error(`sonnenBatterie: unexpected error (${err?.name ?? 'Error'})`);
      return undefined;
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Device ---------------------------------------------------------------------

  external() {
    return ids(this.gladys);
  }

  /** The created Gladys device, undefined until the user creates it. */
  createdDevice() {
    const id = this.external().device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === id);
  }

  info() {
    return {
      address: this.config.address ?? this.kept.address ?? undefined,
      firmware: this.kept.info?.firmware,
      modules: this.kept.info?.modules,
    };
  }

  async discover({ force = false } = {}) {
    const devices =
      this.known && this.config.address
        ? [
            buildDevice(this.gladys, this.info(), {
              pvIndex: this.config.pvIndex,
              created: this.createdDevice(),
            }),
          ]
        : [];
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    this.publishedDevices = json;
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) =>
        this.logger.warn(`Publishing the sonnenBatterie device failed: ${err.message}`),
      );
  }

  /** The Discover tab: the device known, published again; never a request to the battery. */
  async scan() {
    await this.discover({ force: true });
    await this.updateStatus();
  }

  isFresh() {
    return (
      this.values !== undefined &&
      this.monotonic() - this.valuesAt <= FRESH_INTERVALS * this.config.pollInterval * 1000
    );
  }

  /** The device just created: the values of the last read now (no new request). */
  async onDeviceCreated(device) {
    if (device?.external_id !== this.external().device) {
      return;
    }
    // A new device: no reference of its index yet (nor a state kept in /data
    // for a deleted device of the same id).
    for (const { key } of INDEXES) {
      const id = this.external().feature(key);
      this.guards.delete(id);
      delete this.kept.indexes[id];
    }
    this.savedKey = undefined;
    await this.saveState();
    await this.publishLast();
  }

  async onDeviceUpdated(device) {
    if (device?.external_id === this.external().device) {
      await this.publishLast();
    }
  }

  async publishLast() {
    const generation = this.generation;
    if (!this.isFresh()) return;
    const prepared = this.prepare(this.values);
    await this.saveState();
    if (prepared && generation === this.generation) {
      await this.send(prepared);
      if (generation === this.generation) await this.updateStatus();
    }
  }

  // --- /data -------------------------------------------------------------------------

  /**
   * Keeps the state in /data when it changed. The instant of the last request
   * is written at most once a minute (the one already written otherwise).
   */
  async saveState() {
    const indexes = { ...this.kept.indexes };
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    this.kept.indexes = indexes;
    const now = this.now();
    const attempt =
      this.kept.lastAttemptAt !== this.savedAttemptAt &&
      (this.savedAttemptAt === 0 || now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY)
        ? this.kept.lastAttemptAt
        : this.savedAttemptAt;
    const state = {
      salt: this.kept.salt,
      address: this.kept.address,
      lastAttemptAt: attempt,
      pause: this.kept.pause,
      refusal: this.kept.refusal,
      info: this.kept.info,
      indexes,
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
      this.savedAttemptAt = attempt;
    } catch (err) {
      this.logger.warn(`Saving the sonnenBatterie state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Reads -------------------------------------------------------------------------

  intervalMs() {
    return this.config.pollInterval * 1000;
  }

  /** The wait after a failure: never faster than a read, doubled up to 15 min. */
  retryWait(failures) {
    const first = Math.max(RETRY_MIN, this.intervalMs());
    return Math.min(first * 2 ** failures, Math.max(RETRY_MAX, first));
  }

  /** The earliest instant (wall clock) of the next read, whatever asks for it. */
  nextReadAt({ manual = false } = {}) {
    const now = this.now();
    const mono = this.monotonic();
    const at = [now];
    if (this.lastAttemptMono !== undefined) {
      // Never sooner than the interval (the timer looks every 5 s: 30 to 35 s at 30 s).
      at.push(now + this.lastAttemptMono + this.intervalMs() - mono);
    }
    if (this.retryAtMono > mono) at.push(now + this.retryAtMono - mono);
    if (this.restartedAt > 0) {
      at.push(this.restartedAt + ATTEMPT_SAVE_EVERY + this.intervalMs());
    }
    if (this.kept.pause) at.push(this.kept.pause.until);
    if (!manual && this.kept.refusal) at.push(this.kept.refusal.until);
    return Math.max(...at);
  }

  due(options) {
    return Boolean(this.config.token) && this.nextReadAt(options) <= this.now();
  }

  /**
   * One look: a read when one is due. A read still running is never doubled,
   * whatever its generation (a reconnection during a read starts no other).
   */
  tick({ manual = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    if (!this.due({ manual })) {
      return undefined;
    }
    const generation = this.generation;
    this.busy = this.read(generation).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read(generation) {
    const { address, token } = this.config;
    const alive = () => generation === this.generation;
    const now = this.now();
    // Recorded first: neither a reconnection, a save nor a restart reads sooner.
    this.lastAttemptMono = this.monotonic();
    this.restartedAt = 0;
    this.kept.lastAttemptAt = now;
    await this.saveState();
    let answers;
    try {
      answers = await this.client.readAll(address, token, alive);
    } catch (err) {
      await this.failed(err, { address, token, alive });
      return;
    }
    if (!alive()) {
      // Late: an old configuration or a restart. Nothing published, no status.
      return;
    }
    this.failures = 0;
    this.retryAtMono = 0;
    this.lastError = undefined;
    this.kept.pause = null;
    // The fingerprint of a refused token goes with the first success.
    this.kept.refusal = null;
    const config = parseConfigurations(answers.configurations);
    this.kept.info = { firmware: config.firmware, modules: config.modules };
    this.known = true;
    this.values = parseValues(answers);
    this.valuesAt = this.monotonic();
    this.readAt = this.now();
    this.missing = answers.missing;
    this.denied = answers.denied ?? [];
    const prepared = this.prepare(this.values);
    // Saved BEFORE Gladys gets the values: a crash in between never sends an
    // index /data does not know.
    await this.saveState();
    if (!alive()) return;
    if (prepared) await this.send(prepared);
    if (!alive()) return;
    if (this.openChecked !== address) {
      // Once per start of the container and address: does the configuration
      // answer without any token? Then only the address tells the battery.
      this.openChecked = address;
      this.openApi = await this.client.answersWithoutToken(address);
      if (!alive()) return;
    }
    await this.discover();
    if (!alive()) return;
    await this.updateStatus();
  }

  async failed(err, { address, token, alive }) {
    const code = err?.code ?? 'error';
    // A late failure of another configuration is dropped; a pause or a refusal
    // of the same battery with the same token is still kept.
    const same = this.config.address === address && this.config.token === token;
    if (!alive() && !same) return;
    // Our own words only (SonnenError codes): never a text of the battery, never the token.
    this.logger.warn(
      `sonnenBatterie read of ${address} failed: ${code}${err?.status ? ` ${err.status}` : ''}`,
    );
    const now = this.now();
    const mono = this.monotonic();
    if (code === 'refused') {
      const count = (this.kept.refusal?.count ?? 0) + 1;
      this.kept.refusal = {
        until: now + Math.min(REFUSED_FIRST * 2 ** (count - 1), REFUSED_MAX),
        count: Math.min(count, 32),
        status: err.status === 403 ? 403 : 401,
        fp: fingerprint(this.kept.salt, address, token),
      };
    } else if (code === 'rate_limited' || code === 'server') {
      const count = (this.kept.pause?.count ?? 0) + 1;
      const asked = err.retryAfter ?? PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN, this.intervalMs()), PAUSE_MAX);
      this.kept.pause = {
        until: now + wait,
        count: Math.min(count, 32),
        code,
        status: err.status ?? null,
      };
    } else {
      this.retryAtMono = mono + this.retryWait(this.failures);
      this.failures += 1;
    }
    this.lastError = err;
    await this.saveState();
    if (alive()) {
      await this.updateStatus();
    }
  }

  /** The guard of an index of the created device, from Gladys and /data. */
  guardOf(created, id, limits) {
    if (!this.guards.has(id)) {
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), this.kept.indexes[id], this.now(), limits),
      );
    }
    return this.guards.get(id);
  }

  /**
   * The states of a read, the index through its guard (not sent yet: `send`
   * does it, after /data is saved). Undefined without a created device.
   */
  prepare(values) {
    const created = this.createdDevice();
    if (!created) {
      return undefined;
    }
    const external = this.external();
    const now = this.now();
    const indexes = {};
    // "Sensor only": the index never gets a value (nor goes through its guard).
    for (const { name, key, value } of this.indexMode() ? INDEXES : []) {
      const id = external.feature(key);
      const guard = this.guardOf(created, id, INDEX_LIMITS[name]);
      const total = values[value] === undefined ? undefined : round(values[value], 3);
      if (total === undefined) {
        indexes[key] = guard.held ? guard.last?.value : undefined;
        continue;
      }
      const plausible = guard.accept(total, now);
      const held = guard.held ? `${guard.held.direction}:${guard.held.from}` : undefined;
      if (held && this.loggedHolds.get(id) !== held) {
        this.logger.warn(
          `sonnenBatterie ${key} ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      if (held) this.loggedHolds.set(id, held);
      else this.loggedHolds.delete(id);
      // While a value is held, the last accepted one is sent again (no delta for the core).
      indexes[key] = plausible ? total : guard.held ? guard.last?.value : undefined;
    }
    const features = new Set((created.features ?? []).map((f) => f.external_id));
    const states = readStates(external, values, indexes).filter((s) =>
      features.has(s.device_feature_external_id),
    );
    return states.length > 0 ? states : undefined;
  }

  /**
   * The states, within STATES_PER_MINUTE over any 60 s: a batch that would go
   * beyond is not sent this time. The room is taken BEFORE the publication
   * (two publications at once never both pass).
   */
  async send(states) {
    const mono = this.monotonic();
    this.sent = this.sent.filter((s) => mono - s.at < MINUTE);
    const used = this.sent.reduce((sum, s) => sum + s.count, 0);
    if (used + states.length > STATES_PER_MINUTE) {
      this.logger.debug('sonnenBatterie: values kept for the next read (states per minute)');
      return;
    }
    const entry = { at: mono, count: states.length };
    this.sent.push(entry);
    try {
      const result = await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT });
      if (Number.isInteger(result?.count) && result.count >= 0 && result.count <= states.length) {
        entry.count = result.count;
      }
    } catch (err) {
      this.logger.warn(`Publishing the sonnenBatterie values failed: ${err.message}`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  /** Whether the solar production goes to the energy monitoring (option `pv_index`). */
  indexMode() {
    return this.config.pvIndex !== PV_SENSOR_ONLY;
  }

  /** Every index held back: `{ id, name, direction, from, to }`. */
  heldList() {
    const created = this.createdDevice();
    if (!created || !this.indexMode()) return [];
    const list = [];
    for (const { name, key } of INDEXES) {
      const id = this.external().feature(key);
      const held = this.guardOf(created, id, INDEX_LIMITS[name]).held;
      if (held) list.push({ id, name, ...held });
    }
    return list;
  }

  async updateStatus({ starting = false } = {}) {
    const { problem, address } = this.config;
    if (problem) {
      await this.setStatus(false, T.problem[problem]);
      return;
    }
    const now = this.now();
    const mono = this.monotonic();
    const { pause, refusal } = this.kept;
    if (refusal) {
      await this.setStatus(false, T.refused(address, refusal, Math.max(0, refusal.until - now)));
      return;
    }
    if (pause && now < pause.until) {
      await this.setStatus(false, T.paused(address, pause, pause.until - now));
      return;
    }
    if (this.lastError) {
      const wait = Math.max(0, this.retryAtMono - mono);
      await this.setStatus(false, T.failing(address, this.lastError, wait));
      return;
    }
    if (!this.values) {
      const at = this.nextReadAt();
      if (starting && at <= now) {
        await this.setStatus(false, T.connecting);
      } else {
        // After a restart, a battery read before (no refusal, no pause, no
        // error) is shown connected until its next read.
        await this.setStatus(this.known, T.waiting(at));
      }
      return;
    }
    const notes = [];
    if (!this.createdDevice()) notes.push(T.notes.noDevice);
    if (this.missing.length > 0) notes.push(T.notes.missing(this.missing));
    if (this.denied.length > 0) notes.push(T.notes.denied(this.denied));
    if (this.openApi) notes.push(T.notes.openApi);
    const held = this.heldList();
    if (held.length > 0) notes.push(T.notes.held(held));
    await this.setStatus(true, T.ok(this.kept.info?.firmware, notes));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks: the first lists every index held
   * (nothing is accepted), the second, from 3 s to 5 min later, accepts
   * exactly what the first listed, and only when it still shows that value
   * (or what may have come since, src/guard.js). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.now();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (!pending || elapsed > ACCEPT_CONFIRM_WITHIN || elapsed < ACCEPT_CONFIRM_AFTER) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list };
      return T.accept.confirm(list, ACCEPT_CONFIRM_WITHIN);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.to >= entry.to && held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    for (const { name, direction } of accepted) {
      this.logger.info(
        `sonnenBatterie ${name} index ${direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
    }
    // Published at the next read (never a read sooner than the interval).
    return T.accept.done(accepted, changed);
  }

  /**
   * The test button: a read when one is due (the interval passed; a refused
   * token may be tried again then, once per click), else what is known and
   * when the next read can be. Never a request a pause or the pace forbids.
   */
  async testConnection() {
    const { problem, address } = this.config;
    if (problem) {
      return T.problem[problem];
    }
    const generation = this.generation;
    const job = this.busy ?? this.tick({ manual: true });
    if (job) {
      let timer;
      const late = new Promise((resolve) => {
        timer = this.timers.setTimeout(() => resolve('late'), TEST_ANSWER_WITHIN);
      });
      try {
        if ((await Promise.race([job.then(() => 'done'), late])) === 'late') {
          return T.test.slow;
        }
      } finally {
        this.timers.clearTimeout(timer);
      }
    }
    if (generation !== this.generation) {
      return T.test.slow;
    }
    const lines = [];
    const fresh = this.isFresh();
    if (this.kept.refusal) {
      lines.push(T.test.failed(address, { code: 'refused', status: this.kept.refusal.status }));
    } else if (this.kept.pause && this.now() < this.kept.pause.until) {
      lines.push(T.test.failed(address, this.kept.pause));
    } else if (this.lastError) {
      lines.push(T.test.failed(address, this.lastError));
    } else if (fresh) {
      lines.push(T.test.ok(address, this.values, this.kept.info?.firmware));
    }
    if (fresh && this.readAt !== undefined) lines.push(T.test.lastRead(this.readAt));
    if (!job) lines.push(T.test.notNow(this.nextReadAt({ manual: true })));
    return T.test.lines(lines);
  }
}
