// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake sonnenBatterie.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SonnenApp } from '../src/app.js';
import { ACTIONS, PAUSE_MIN, REFUSED_FIRST, RETRY_MIN } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { SonnenClient } from '../src/sonnen/client.js';
import { createMemoryStore } from '../src/store.js';
import { createFetch } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import { ADDRESS, HOST, NOW, TOKEN, battery, json } from './fixtures/sonnen.js';

const SELECTOR = 'sonnen';
const DEVICE = `ext:${SELECTOR}:battery:main`;
const F = (key) => `${DEVICE}:${key}`;
const CONFIG = { address: HOST, token: TOKEN };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const POLL = 30 * SECOND;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created({ index } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, { address: ADDRESS });
  if (index) {
    const feature = device.features.find((f) => f.external_id === F('pv_energy'));
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

async function setup({
  config = CONFIG,
  routes = battery(),
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  clock = { now },
} = {}) {
  const fake = createFetch({ [HOST]: routes });
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const timers = createFakeTimers();
  const logger = createLogger();
  const app = new SonnenApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    client: new SonnenClient({ fetchImpl: fake.fetch, now: () => clock.now }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  gladys.onScanRequest(() => app.scan());
  /** `ms` later, the timer looks whether a read is due. */
  const tick = async (ms = POLL) => {
    clock.now += ms;
    await timers.runIntervals();
    await app.idle();
  };
  return { app, gladys, timers, clock, logger, fake, tick, store, routes };
}

const status = (gladys) => gladys.fake.connectionStatus;
const configReads = (fake) => fake.calls.filter((c) => c.path === '/api/v2/configurations').length;
const last = (gladys, key) => gladys.fake.lastState(F(key));
const text = (message) => `${message.en} ${message.fr}`;

test('nothing configured, or a bad token: the status says so, nothing is called', async () => {
  for (const [config, words] of [
    [{}, /adresse IP de la sonnenBatterie/],
    [{ address: HOST }, /jeton de lecture/],
    [{ address: HOST, token: 'a b' }, /pas valide/],
    [{ address: 'u:p@x', token: TOKEN }, /adresse n’est pas valide/],
  ]) {
    const { app, gladys, fake } = await setup({ config });
    await app.start(config);
    await app.idle();
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, words);
    assert.equal(fake.calls.length, 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), words);
  }
});

test('the first read: the device in Discovery, no value before it is created', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'sonnenBatterie');
  assert.deepEqual(
    device.params.find((p) => p.name === 'SONNEN_FIRMWARE'),
    { name: 'SONNEN_FIRMWARE', value: '1.14.5' },
  );
  assert.ok(device.features.every((f) => f.read_only));
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
});

test('a created battery gets its values, read-only, never the consumption endpoint', async () => {
  const { app, gladys, fake } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'usoc'), 81);
  assert.equal(last(gladys, 'charge_power'), 1394);
  assert.equal(last(gladys, 'discharge_power'), 0);
  assert.equal(last(gladys, 'battery_power'), -1394);
  assert.equal(last(gladys, 'pv_power'), 2972);
  assert.equal(last(gladys, 'pv_energy'), 3969.8);
  assert.equal(last(gladys, 'pv_energy_production'), undefined, 'computed by the core');
  assert.equal(last(gladys, 'consumption_energy'), 816.5);
  assert.equal(last(gladys, 'grid_power'), 0);
  assert.equal(last(gladys, 'remaining_energy'), 16.75);
  assert.equal(last(gladys, 'max_cell_temperature'), 20);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  assert.ok(fake.calls.every((c) => c.init.method === 'GET'));
  assert.match(status(gladys).message.en, /sonnenBatterie answering \(software 1\.14\.5\)/);
});

test('pace: nothing reads faster than the interval (timer, reconnection, unchanged save, test, Discovery)', async () => {
  const { app, gladys, fake, tick, clock } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(configReads(fake), 1);
  await tick(10 * SECOND);
  assert.equal(configReads(fake), 1, 'the timer waits the interval');
  // A reconnection to Gladys, a save of the same form, Discovery, the test button.
  await app.start(CONFIG);
  await app.idle();
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  await gladys.fake.scanRequest();
  await app.idle();
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(text(answer), /next read possible at 10:00:30 UTC/);
  assert.match(text(answer), /read token accepted/);
  assert.equal(configReads(fake), 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1, 'Discovery republished, no request');
  await tick(20 * SECOND);
  assert.equal(configReads(fake), 2, 'read once the interval passed');
  // The test button once the interval passed: one read, not two.
  await tick(28 * SECOND);
  assert.equal(configReads(fake), 2);
  clock.now += 2 * SECOND;
  const clicked = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(clicked.fr, /jeton de lecture accepté/);
  assert.equal(configReads(fake), 3);
});

test('a reconnection during a read starts no other read; the late read publishes nothing', async () => {
  let release;
  const routes = battery({ hold: new Promise((r) => (release = r)) });
  const { app, gladys, fake, clock } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.lifecycle;
  assert.equal(fake.calls.length, 1, 'the read is waiting for the battery');
  const statuses = gladys.fake.connectionStatuses.length;
  await app.start(CONFIG);
  await app.lifecycle;
  clock.now += 40 * SECOND;
  // The look of the timer gets the read running, not a new one.
  const running = app.tick();
  assert.ok(running);
  assert.equal(fake.calls.length, 1, 'no second read while the first runs');
  routes.state.hold = undefined;
  release();
  await app.idle();
  assert.equal(gladys.fake.states.length, 0, 'the late read publishes nothing');
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'only the restart status');
  clock.now += 1;
  await app.tick();
  await app.idle();
  assert.equal(last(gladys, 'usoc'), 81);
});

test('a restart of the container never reads sooner: last request in /data, written once a minute', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const first = await setup({ store, clock, devices: [created()] });
  await first.app.start(CONFIG);
  await first.app.idle();
  assert.equal(store.data.lastAttemptAt, NOW);
  const saves = store.saves;
  await first.tick(POLL);
  assert.equal(configReads(first.fake), 2);
  assert.equal(store.data.lastAttemptAt, NOW, 'not written again within the minute');
  assert.ok(store.saves - saves <= 1);
  await first.tick(POLL);
  assert.equal(store.data.lastAttemptAt, NOW + 2 * POLL, 'written after a minute');
  // A restart right after the third read.
  await first.app.stop();
  const second = await setup({ store, clock, devices: [created()] });
  await second.app.start(CONFIG);
  await second.app.idle();
  assert.equal(second.fake.calls.length, 0);
  assert.match(status(second.gladys).message.en, /next read at/);
  await second.tick(POLL + MINUTE - 1000);
  assert.equal(second.fake.calls.length, 0, 'the interval and the minute not written');
  await second.tick(1000);
  assert.equal(configReads(second.fake), 1);
});

test('a refused token: a stop kept in /data, spaced tries, a new token tried at once; never logged', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const routes = battery({ token: 'the-right-token-42' });
  const a = await setup({ store, clock, routes });
  await a.app.start(CONFIG);
  await a.app.idle();
  assert.equal(status(a.gladys).connected, false);
  assert.match(status(a.gladys).message.fr, /refuse le jeton de lecture \(HTTP 401\)/);
  assert.match(store.data.refusal.fp, /^[0-9a-f]{32}$/);
  assert.equal(store.data.refusal.count, 1);
  await a.tick(REFUSED_FIRST - 1000);
  assert.equal(configReads(a.fake), 1, 'no try before the end of the stop');
  await a.tick(1000);
  assert.equal(configReads(a.fake), 2);
  assert.equal(store.data.refusal.count, 2, 'spaced: 30 min now');
  // A restart: still stopped, nothing asked.
  await a.app.stop();
  const b = await setup({ store, clock, routes });
  await b.app.start(CONFIG);
  await b.app.idle();
  assert.equal(b.fake.calls.length, 0);
  assert.match(status(b.gladys).message.en, /refuses the read token/);
  // The right token saved: read at once, the fingerprint erased.
  await b.app.start({ ...CONFIG, token: 'the-right-token-42' }, { fresh: true });
  await b.app.idle();
  assert.equal(configReads(b.fake), 1);
  assert.equal(store.data.refusal, null);
  assert.equal(status(b.gladys).connected, true);
  const everything = [
    ...a.logger.lines,
    ...b.logger.lines,
    JSON.stringify(store.data),
    JSON.stringify(a.gladys.fake.connectionStatuses),
    JSON.stringify(b.gladys.fake.connectionStatuses),
  ].join('\n');
  assert.ok(!everything.includes(TOKEN));
  assert.ok(!everything.includes('the-right-token-42'));
});

test('a token changed while the container was stopped is tried at once (its fingerprint differs)', async () => {
  const store = createMemoryStore();
  const clock = { now: NOW };
  const routes = battery({ token: 'the-right-token-42' });
  const a = await setup({ store, clock, routes });
  await a.app.start(CONFIG);
  await a.app.idle();
  await a.app.stop();
  const b = await setup({
    store,
    clock,
    routes,
    config: { ...CONFIG, token: 'the-right-token-42' },
  });
  await b.app.start({ ...CONFIG, token: 'the-right-token-42' });
  await b.app.idle();
  assert.equal(configReads(b.fake), 1);
  assert.equal(store.data.refusal, null);
  assert.equal(status(b.gladys).connected, true);
});

test('429 / 5xx of the configuration: a pause kept in /data; the test button never asks', async () => {
  const store = createMemoryStore();
  const routes = battery({
    fail: { '/api/v2/configurations': () => json({}, 429, { 'retry-after': '600' }) },
  });
  const { app, gladys, fake, tick } = await setup({ store, routes });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(store.data.pause.code, 'rate_limited');
  assert.equal(store.data.pause.until, NOW + 600 * SECOND);
  assert.match(status(gladys).message.fr, /demande d’attendre/);
  routes.state.fail = {};
  await tick(5 * MINUTE);
  const answer = (await gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(answer.en, /too many requests 429/);
  assert.equal(fake.calls.length, 1);
  await tick(5 * MINUTE);
  assert.equal(fake.calls.length, 6, 'read again after the pause');
  assert.equal(store.data.pause, null);
  const server = await setup({ routes: battery({ fail: { '/api/v2/configurations': 500 } }) });
  await server.app.start(CONFIG);
  await server.app.idle();
  assert.ok(server.app.kept.pause.until >= NOW + PAUSE_MIN);
});

test('a 5xx of a secondary endpoint keeps the other values and says what is missing', async () => {
  const routes = battery({ fail: { '/api/v2/battery': 500 } });
  const { app, gladys } = await setup({ routes, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'usoc'), 81);
  assert.equal(last(gladys, 'cycles'), undefined);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Non lu cette fois.*modules de batterie/);
});

test('unreachable: tried again after a minute, doubled, never faster than the interval', async () => {
  const { app, gladys, fake, tick } = await setup({ routes: {} });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.en, /unreachable/);
  await tick(RETRY_MIN - 1000);
  assert.equal(fake.calls.length, 1);
  await tick(1000);
  assert.equal(fake.calls.length, 2);
  await tick(RETRY_MIN);
  assert.equal(fake.calls.length, 2, 'doubled: 2 min');
  await tick(RETRY_MIN);
  assert.equal(fake.calls.length, 3);
});

test('the solar index: never 0, a jump held until accepted in two clicks', async () => {
  const routes = battery();
  const { app, gladys, tick } = await setup({
    routes,
    devices: [created({ index: { value: 3969, at: NOW - MINUTE } })],
  });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'pv_energy'), 3969.8);
  routes.state.answers['/api/v2/powermeter'][0].kwh_imported = 0;
  await tick();
  assert.equal(last(gladys, 'pv_energy'), 3969.8, 'never 0');
  routes.state.answers['/api/v2/powermeter'][0].kwh_imported = 9000;
  await tick();
  assert.equal(last(gladys, 'pv_energy'), 3969.8, 'a jump is held');
  assert.match(status(gladys).message.fr, /saut de 3969.8 à 9000 kWh/);
  const first = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(first.en, /A second click accepts exactly/);
  await tick(5 * SECOND);
  assert.equal(last(gladys, 'pv_energy'), 3969.8);
  const second = (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message;
  assert.match(second.en, /Accepted: solar production index 9000 kWh/);
  await tick();
  assert.equal(last(gladys, 'pv_energy'), 9000);
  assert.equal(
    (await gladys.fake.action(ACTIONS.ACCEPT_HELD)).data.message.en,
    'No index is held back: nothing to accept.',
  );
});

test('the device created after a read gets the last values at once, without a request', async () => {
  const { app, gladys, fake } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const calls = fake.calls.length;
  await gladys.fake.deviceCreated(created());
  await app.idle();
  assert.equal(fake.calls.length, calls);
  assert.equal(last(gladys, 'usoc'), 81);
});

test('the states budget is taken before a publication: two at once never both pass', async () => {
  const { app, gladys } = await setup({ devices: [created()] });
  const states = Array.from({ length: 200 }, (_, i) => ({
    device_feature_external_id: F('usoc'),
    state: i,
  }));
  let calls = 0;
  const publish = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = (...args) => {
    calls += 1;
    return publish(...args);
  };
  await Promise.all([app.send(states), app.send(states)]);
  assert.equal(calls, 1);
});

test('each connection publishes the status and the device again', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const discoveries = gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  await app.start(CONFIG);
  await app.idle();
  assert.ok(gladys.fake.connectionStatuses.length > statuses);
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});
