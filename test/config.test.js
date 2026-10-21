import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress } from '../src/config.js';

const TOKEN = 'abcdefgh12345678';

test('addresses: IP, host name, port, pasted URL; port 80 by default', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { address: '192.168.1.50:80' });
  assert.deepEqual(parseAddress(' http://192.168.1.50:8080/api/v2 '), {
    address: '192.168.1.50:8080',
  });
  assert.deepEqual(parseAddress('Sonnen.local'), { address: 'sonnen.local:80' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]:80' });
  assert.deepEqual(parseAddress(''), { empty: true });
  for (const bad of ['u:p@192.168.1.50', 'a b', '1.2.3.4:0', '1.2.3.4:70000', 'x'.repeat(301)]) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
});

test('the configuration: problems named, the token never kept when invalid', () => {
  assert.equal(normalizeConfig({}).problem, 'address_missing');
  assert.equal(normalizeConfig({ address: 'a b', token: TOKEN }).problem, 'address_invalid');
  assert.equal(normalizeConfig({ address: '192.168.1.50' }).problem, 'token_missing');
  for (const bad of ['short', 'with space inside', 'line\nbreak12345', 'é'.repeat(10)]) {
    const config = normalizeConfig({ address: '192.168.1.50', token: bad });
    assert.equal(config.problem, 'token_invalid', bad);
    assert.equal(config.token, undefined);
  }
  const ok = normalizeConfig({ address: '192.168.1.50', token: ` ${TOKEN} `, poll_interval: '45' });
  assert.deepEqual(ok, {
    address: '192.168.1.50:80',
    token: TOKEN,
    pollInterval: 45,
    problem: undefined,
  });
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 30);
  assert.equal(normalizeConfig({ poll_interval: 9999 }).pollInterval, 300);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 30);
});
