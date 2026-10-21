import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SonnenClient, readBounded } from '../src/sonnen/client.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import { ADDRESS, HOST, TOKEN, battery, json } from './fixtures/sonnen.js';

const setup = (overrides) => {
  const routes = battery(overrides);
  const fake = createFetch({ [HOST]: routes });
  return { fake, routes, client: new SonnenClient({ fetchImpl: fake.fetch }) };
};

test('one read: GET only, the token in the header, no redirect followed, the five endpoints', async () => {
  const { client, fake } = setup();
  const read = await client.readAll(ADDRESS, TOKEN);
  assert.deepEqual(read.missing, []);
  assert.equal(read.configurations.DE_Software, '1.14.5');
  assert.equal(read.status.USOC, 81);
  assert.ok(Array.isArray(read.powermeter));
  assert.deepEqual(
    fake.calls.map((c) => c.path),
    [
      '/api/v2/configurations',
      '/api/v2/status',
      '/api/v2/latestdata',
      '/api/v2/powermeter',
      '/api/v2/battery',
    ],
  );
  for (const call of fake.calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.headers['Auth-Token'], TOKEN);
    assert.ok(call.url.startsWith(`http://${ADDRESS}/api/v2/`));
  }
});

test('a refused token stops the read; the error never carries the token nor the URL', async () => {
  const { client } = setup({ token: 'another-token-123' });
  const err = await client.readAll(ADDRESS, TOKEN).catch((e) => e);
  assert.equal(err.code, 'refused');
  assert.equal(err.status, 401);
  for (const text of [err.message, String(err), JSON.stringify(err)]) {
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes('http'));
  }
});

test('review 1, point 1: a 401/403 of a secondary endpoint only leaves it out (denied)', async () => {
  const { client, fake } = setup({ fail: { '/api/v2/battery': 403, '/api/v2/latestdata': 401 } });
  const read = await client.readAll(ADDRESS, TOKEN);
  assert.deepEqual(read.denied, ['latest', 'battery']);
  assert.deepEqual(read.missing, []);
  assert.equal(read.status.USOC, 81);
  assert.ok(read.powermeter);
  assert.equal(fake.calls.length, 5);
});

test('review 1, point 3: the configuration asked once without a token', async () => {
  const closed = setup();
  assert.equal(await closed.client.answersWithoutToken(ADDRESS), false);
  assert.equal(closed.fake.calls[0].init.headers['Auth-Token'], undefined);
  const open = setup({
    fail: { '/api/v2/configurations': () => json({ EM_OperatingMode: '2' }) },
  });
  assert.equal(await open.client.answersWithoutToken(ADDRESS), true);
  const none = new SonnenClient({ fetchImpl: createFetch({}).fetch });
  assert.equal(await none.answersWithoutToken(ADDRESS), false);
});

test('a 5xx on a secondary endpoint leaves its values out; the others are read', async () => {
  const { client } = setup({ fail: { '/api/v2/latestdata': 500, '/api/v2/battery': 502 } });
  const read = await client.readAll(ADDRESS, TOKEN);
  assert.deepEqual(read.missing, ['latest', 'battery']);
  assert.equal(read.status.USOC, 81);
  assert.ok(read.powermeter);
});

test('a 5xx or a 429 of the configuration stops the read, with the Retry-After', async () => {
  const server = setup({ fail: { '/api/v2/configurations': 503 } });
  const err = await server.client.readAll(ADDRESS, TOKEN).catch((e) => e);
  assert.equal(err.code, 'server');
  assert.equal(err.status, 503);
  const limited = setup({
    fail: { '/api/v2/status': () => json({}, 429, { 'retry-after': '120' }) },
  });
  const tooMany = await limited.client.readAll(ADDRESS, TOKEN).catch((e) => e);
  assert.equal(tooMany.code, 'rate_limited');
  assert.equal(tooMany.retryAfter, 120_000);
});

test('a network failure on a secondary endpoint stops the remaining requests', async () => {
  const { client, fake } = setup({
    fail: {
      '/api/v2/latestdata': () => {
        throw timeoutError();
      },
    },
  });
  const read = await client.readAll(ADDRESS, TOKEN);
  assert.deepEqual(read.missing, ['latest', 'powermeter', 'battery']);
  assert.equal(fake.calls.length, 3);
});

test('another device at the address, a redirect, odd answers', async () => {
  const other = setup({ fail: { '/api/v2/configurations': () => json({ device: { sn: 'x' } }) } });
  assert.equal((await other.client.readAll(ADDRESS, TOKEN).catch((e) => e)).code, 'unknown_answer');
  const moved = setup({
    fail: {
      '/api/v2/configurations': () =>
        new Response('', { status: 302, headers: { location: 'http://evil.example/' } }),
    },
  });
  assert.equal((await moved.client.readAll(ADDRESS, TOKEN).catch((e) => e)).code, 'http');
  const html = setup({ fail: { '/api/v2/configurations': () => new Response('<html>') } });
  assert.equal((await html.client.readAll(ADDRESS, TOKEN).catch((e) => e)).code, 'not_json');
  const none = new SonnenClient({ fetchImpl: createFetch({}).fetch });
  assert.equal((await none.readAll(ADDRESS, TOKEN).catch((e) => e)).code, 'unreachable');
  const stopped = setup();
  const read = await stopped.client.readAll(ADDRESS, TOKEN, () => false);
  assert.equal(stopped.fake.calls.length, 1, 'stopped after the configuration');
  assert.equal(read.status, undefined);
});

test('a body is bounded, read into one buffer', async () => {
  const big = new Response('x'.repeat(70 * 1024));
  assert.equal((await readBounded(big, 64 * 1024).catch((e) => e)).code, 'too_large');
  const chunks = new ReadableStream({
    start(controller) {
      for (const part of ['{"a":', '1', '}']) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
  assert.equal(await readBounded(new Response(chunks), 64), '{"a":1}');
  assert.equal(await readBounded(new Response(null), 64), '');
});

test('read-only: the client has no method that writes, and never another verb', () => {
  const source = readFileSync(new URL('../src/sonnen/client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /method: '(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(source, /\/api\/v2\/(setpoint|configurations\/)/i);
  const methods = Object.getOwnPropertyNames(SonnenClient.prototype);
  assert.deepEqual(methods.sort(), [
    'answersWithoutToken',
    'constructor',
    'get',
    'readAll',
    'readConfigurations',
  ]);
});
