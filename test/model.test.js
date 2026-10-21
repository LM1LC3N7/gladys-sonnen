import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConfigurations, metersOf, num, parseValues } from '../src/sonnen/model.js';
import { answers } from './fixtures/sonnen.js';

const read = (a = answers()) => ({
  configurations: a['/api/v2/configurations'],
  status: a['/api/v2/status'],
  latest: a['/api/v2/latestdata'],
  powermeter: a['/api/v2/powermeter'],
  battery: a['/api/v2/battery'],
  missing: [],
});

test('the answers of a charging battery (test data of the library)', () => {
  const v = parseValues(read());
  assert.equal(v.usoc, 81);
  assert.equal(v.rsoc, 88);
  assert.equal(v.batteryPower, -1394);
  assert.equal(v.chargePower, 1394);
  assert.equal(v.dischargePower, 0);
  assert.equal(v.productionPower, 2972);
  assert.equal(v.consumptionPower, 1578);
  assert.equal(v.gridPower, 0);
  assert.equal(v.backupBuffer, 20);
  assert.equal(v.gridState, 0);
  assert.equal(v.batteryState, 1);
  assert.equal(v.dischargeNotAllowed, 0);
  assert.equal(v.operatingMode, 2);
  assert.equal(v.cycles, 30);
  assert.equal(v.minCellTemperature, 18.95);
  assert.equal(v.maxCellTemperature, 19.95);
  assert.ok(Math.abs(v.remainingEnergy - 16.75264) < 1e-9);
  assert.ok(Math.abs(v.fullChargeCapacity - 20.68349) < 1e-9);
  assert.equal(v.installedCapacity, 20);
  assert.equal(v.pvEnergy, 3969.800048828125);
  assert.equal(v.consumptionEnergy, 816.5);
});

test('signs: discharge, grid import and export', () => {
  const a = answers();
  Object.assign(a['/api/v2/status'], {
    Pac_total_W: 800,
    GridFeedIn_W: -350,
    BatteryCharging: false,
    BatteryDischarging: true,
    SystemStatus: 'OffGrid',
  });
  const v = parseValues(read(a));
  assert.equal(v.dischargePower, 800);
  assert.equal(v.chargePower, 0);
  assert.equal(v.gridPower, 350, 'import > 0 for grid-sensor / power');
  assert.equal(v.batteryState, 2);
  assert.equal(v.gridState, 1);
  a['/api/v2/status'].GridFeedIn_W = 1200;
  assert.equal(parseValues(read(a)).gridPower, -1200, 'export < 0');
});

test('hostile answers: never the prototype, never a text read as a number, ranges checked', () => {
  const status = JSON.parse(
    '{"__proto__": {"USOC": 50}, "RSOC": "1e3", "Fac": "NaN", "USOC": 150}',
  );
  const v = parseValues({
    configurations: {},
    status,
    battery: { minimumcelltemperature: -273.15 },
  });
  assert.equal(v.usoc, undefined);
  assert.equal(v.rsoc, undefined);
  assert.equal(v.frequency, undefined);
  assert.equal(v.minCellTemperature, undefined);
  assert.equal(num(' 12.5 '), 12.5);
  assert.equal(num('12,5'), undefined);
  assert.equal(num(Infinity), undefined);
  assert.equal(num(true), undefined);
  assert.deepEqual(parseValues({}), {});
  const both = parseValues({ status: { BatteryCharging: true, BatteryDischarging: true } });
  assert.equal(both.batteryState, undefined, 'both at once is not a state');
});

test('review 1, point 5: -200 to 0 W of production or consumption is 0; further below, left out', () => {
  const a = answers();
  Object.assign(a['/api/v2/status'], { Production_W: -3, Consumption_W: -150 });
  const v = parseValues(read(a));
  assert.equal(v.productionPower, 0);
  assert.equal(v.consumptionPower, 0);
  Object.assign(a['/api/v2/status'], { Production_W: -201, Consumption_W: -5000 });
  const w = parseValues(read(a));
  assert.equal(w.productionPower, undefined);
  assert.equal(w.consumptionPower, undefined);
});

test('the configuration of a sonnenBatterie is recognised; another answer is not', () => {
  assert.ok(isConfigurations({ EM_OperatingMode: '2' }));
  assert.ok(!isConfigurations({ device: { sn: 'x' } }));
  assert.ok(!isConfigurations([]));
  assert.ok(!isConfigurations(JSON.parse('{"__proto__": {"DE_Software": "1"}}')));
});

test('meters: by direction; without any, two meters as the library', () => {
  const p = { kwh_imported: 1 };
  const c = { kwh_imported: 2 };
  assert.deepEqual(metersOf([p, c]), { production: p, consumption: c });
  assert.deepEqual(
    metersOf([
      { ...c, direction: 'consumption' },
      { ...p, direction: 'Production' },
    ]).production.kwh_imported,
    1,
  );
  assert.deepEqual(metersOf([p]), { production: undefined, consumption: undefined });
  assert.deepEqual(metersOf({}), { production: undefined, consumption: undefined });
  assert.equal(metersOf([{ direction: 'other' }, p]).production, undefined);
});
