// -----------------------------------------------------------------------------
// The Gladys device of the sonnenBatterie and its states. Pure.
//
// External id (forever): battery:main (the read API gives no serial: one
// battery per integration, the one whose token is configured).
// Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js, the comments of
// DEVICE_FEATURE_TYPES, and the lot 6 rules of this project):
// - the ONLY index is the solar production meter of the battery
//   (`energy-production-sensor` / `index`, with its `thirty-minutes-production`
//   declared here, ids computed (UUID v5) so that an "Update" in Discovery
//   keeps the same rows; the integration never publishes that one). It goes
//   through the guard (src/guard.js): never 0, a jump or a drop held until the
//   user accepts it;
// - NO `energy-sensor` / `index`, no `daily-consumption`, never
//   publishEnergyConsumption: the consumption meter of the battery measures
//   the house consumption, which the main meter of the home (Linky...) already
//   counts in Gladys; counted twice, it would be billed twice. It is a plain
//   sensor, kWh in the name. The API gives no grid nor battery energy counter;
//   none is ever made up from a power;
// - the grid exchange is `grid-sensor` / `power` (one signed value, import > 0);
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): %, W, kWh for battery-storage, W, kWh
//   for energy-production-sensor and grid-sensor, V for energy-sensor, °C for
//   device-temperature-sensor, none for unknown (the unit is then in the name).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_KEY, ENERGY_MAX, EXTERNAL_ID_TYPE, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  USOC: 'usoc',
  RSOC: 'rsoc',
  CHARGE_POWER: 'charge_power',
  DISCHARGE_POWER: 'discharge_power',
  BATTERY_POWER: 'battery_power',
  BATTERY_STATE: 'battery_state',
  REMAINING_ENERGY: 'remaining_energy',
  PV_POWER: 'pv_power',
  PV_ENERGY: 'pv_energy',
  /** 30-minute production: fed by the Gladys core from the index, never by the integration. */
  PV_30MIN: 'pv_energy_production',
  CONSUMPTION_POWER: 'consumption_power',
  CONSUMPTION_AVERAGE: 'consumption_average',
  CONSUMPTION_ENERGY: 'consumption_energy',
  GRID_POWER: 'grid_power',
  GRID_STATE: 'grid_state',
  GRID_FREQUENCY: 'grid_frequency',
  GRID_VOLTAGE: 'grid_voltage',
  BACKUP_BUFFER: 'backup_buffer',
  OPERATING_MODE: 'operating_mode',
  DISCHARGE_NOT_ALLOWED: 'discharge_not_allowed',
  CYCLES: 'cycles',
  MIN_CELL_TEMPERATURE: 'min_cell_temperature',
  MAX_CELL_TEMPERATURE: 'max_cell_temperature',
  DC_VOLTAGE: 'dc_voltage',
  FULL_CHARGE_CAPACITY: 'full_charge_capacity',
  INSTALLED_CAPACITY: 'installed_capacity',
};

/**
 * The guarded indexes: their feature, the value they come from
 * (src/sonnen/model.js), their limits (INDEX_LIMITS) and their name in the
 * texts (src/i18n.js).
 */
export const INDEXES = [{ name: 'pv', key: FEATURE.PV_ENERGY, value: 'pvEnergy' }];

/** The external ids of the battery. */
export const ids = (gladys) => gladys.externalIds(EXTERNAL_ID_TYPE, DEVICE_KEY);

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('8e41c7d25a0b4f3e9d6c12a7f05b3e98', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name (as gladys-apsystems). */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- The catalog ------------------------------------------------------------------
//
// Each entry: the feature key, the value of src/sonnen/model.js it shows, its
// rounding, and how it is declared.

const def = (key, value, digits, spec) => ({ key, value, digits, spec });

const measure = (name, category, type, extra = {}) => ({ name, category, type, ...extra });
/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (name, extra = {}) => measure(name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);
const code = (name, max) => measure(name, C.UNKNOWN, T.SENSOR.INTEGER, { max });
const watts = (name, category, type) =>
  measure(name, category, type, { unit: U.WATT, max: POWER_MAX });
const temperature = (name) =>
  measure(name, C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
    unit: U.CELSIUS,
    min: -40,
    max: 120,
  });
const index = (name, type) =>
  measure(name, C.ENERGY_PRODUCTION_SENSOR, type, { unit: U.KILOWATT_HOUR, max: ENERGY_MAX });

export const CATALOG = [
  def(FEATURE.USOC, 'usoc', 0, {
    ...measure('State of charge', C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL),
    unit: U.PERCENT,
    max: 100,
  }),
  def(FEATURE.RSOC, 'rsoc', 0, plain('Relative state of charge (%)', { max: 100 })),
  def(
    FEATURE.CHARGE_POWER,
    'chargePower',
    0,
    watts('Charge power', C.BATTERY_STORAGE, T.BATTERY_STORAGE.CHARGE_POWER),
  ),
  def(
    FEATURE.DISCHARGE_POWER,
    'dischargePower',
    0,
    watts('Discharge power', C.BATTERY_STORAGE, T.BATTERY_STORAGE.DISCHARGE_POWER),
  ),
  def(
    FEATURE.BATTERY_POWER,
    'batteryPower',
    0,
    plain('Battery power (W, discharge > 0)', { min: -POWER_MAX, max: POWER_MAX }),
  ),
  def(
    FEATURE.BATTERY_STATE,
    'batteryState',
    0,
    code('Battery state (0 = idle, 1 = charging, 2 = discharging)', 2),
  ),
  def(FEATURE.REMAINING_ENERGY, 'remainingEnergy', 2, {
    ...measure(
      'Usable energy remaining',
      C.BATTERY_STORAGE,
      T.BATTERY_STORAGE.BATTERY_ENERGY_REMAINING,
    ),
    unit: U.KILOWATT_HOUR,
    max: 1000,
  }),
  def(
    FEATURE.PV_POWER,
    'productionPower',
    0,
    watts('Solar power', C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER),
  ),
  def(
    FEATURE.PV_ENERGY,
    'pvEnergy',
    3,
    index('Solar production index', T.ENERGY_PRODUCTION_SENSOR.INDEX),
  ),
  // Declared only: the core computes it from the index.
  def(
    FEATURE.PV_30MIN,
    undefined,
    3,
    index(
      'Solar production index (30-minute production)',
      T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
    ),
  ),
  def(
    FEATURE.CONSUMPTION_POWER,
    'consumptionPower',
    0,
    plain('House consumption (W)', { max: POWER_MAX }),
  ),
  def(
    FEATURE.CONSUMPTION_AVERAGE,
    'consumptionAverage',
    0,
    plain('House consumption, average (W)', { max: POWER_MAX }),
  ),
  def(
    FEATURE.CONSUMPTION_ENERGY,
    'consumptionEnergy',
    3,
    plain('House consumption (kWh, total, not counted)', { max: ENERGY_MAX }),
  ),
  def(FEATURE.GRID_POWER, 'gridPower', 0, {
    ...measure('Grid power (import > 0, export < 0)', C.GRID_SENSOR, T.GRID_SENSOR.POWER),
    unit: U.WATT,
    min: -POWER_MAX,
    max: POWER_MAX,
  }),
  def(FEATURE.GRID_STATE, 'gridState', 0, code('Grid (0 = on grid, 1 = off grid, backup)', 1)),
  def(FEATURE.GRID_FREQUENCY, 'frequency', 2, plain('Grid frequency (Hz)', { max: 100 })),
  def(FEATURE.GRID_VOLTAGE, 'voltage', 1, {
    ...measure('Grid voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE),
    unit: U.VOLT,
    max: 1000,
    keep_history: false,
  }),
  def(
    FEATURE.BACKUP_BUFFER,
    'backupBuffer',
    0,
    plain('Backup buffer, reserve for an outage (%)', { max: 100 }),
  ),
  def(
    FEATURE.OPERATING_MODE,
    'operatingMode',
    0,
    code(
      'Operating mode (1 = manual, 2 = self-consumption, 6 = module extension, 10 = time of use)',
      10,
    ),
  ),
  def(
    FEATURE.DISCHARGE_NOT_ALLOWED,
    'dischargeNotAllowed',
    0,
    code('Discharge not allowed (0 = no, 1 = yes)', 1),
  ),
  def(FEATURE.CYCLES, 'cycles', 0, plain('Charge cycles', { max: 1e6 })),
  def(
    FEATURE.MIN_CELL_TEMPERATURE,
    'minCellTemperature',
    1,
    temperature('Battery cell temperature, minimum'),
  ),
  def(
    FEATURE.MAX_CELL_TEMPERATURE,
    'maxCellTemperature',
    1,
    temperature('Battery cell temperature, maximum'),
  ),
  def(FEATURE.DC_VOLTAGE, 'dcVoltage', 1, plain('Battery DC voltage (V)', { max: 1000 })),
  def(
    FEATURE.FULL_CHARGE_CAPACITY,
    'fullChargeCapacity',
    2,
    plain('Full charge capacity (kWh)', { max: 1000 }),
  ),
  def(
    FEATURE.INSTALLED_CAPACITY,
    'installedCapacity',
    2,
    plain('Installed capacity (kWh)', { max: 1000 }),
  ),
];

/** The device of the battery. `info`: `{ address, firmware, modules }`. */
export function buildDevice(gladys, info = {}) {
  const external = ids(gladys);
  const pvIndexId = external.feature(FEATURE.PV_ENERGY);
  // Every feature of the catalog, always: a device never loses a feature
  // ("Update" in Discovery would drop its history).
  const features = CATALOG.map(({ key, spec }) => {
    const feature = {
      min: 0,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...spec,
      external_id: external.feature(key),
    };
    if (key === FEATURE.PV_ENERGY) {
      feature.id = uuidOf(pvIndexId);
    } else if (key === FEATURE.PV_30MIN) {
      feature.id = uuidOf(external.feature(FEATURE.PV_30MIN));
      feature.energy_parent_id = uuidOf(pvIndexId);
    }
    return feature;
  });
  return {
    name: 'sonnenBatterie',
    external_id: external.device,
    features,
    params: [
      { name: 'SONNEN_ADDRESS', value: info.address ?? '' },
      { name: 'SONNEN_FIRMWARE', value: info.firmware ?? '' },
      { name: 'SONNEN_MODULES', value: info.modules === undefined ? '' : String(info.modules) },
    ],
  };
}

export const round = (value, digits) => {
  const r = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const INDEX_KEYS = new Set(INDEXES.map((i) => i.key));

/**
 * The states of a read. `values`: src/sonnen/model.js parseValues; `indexes`:
 * by feature key, the values the guards let through (undefined: not
 * published this time). An index is never taken from `values` directly.
 */
export function readStates(external, values, indexes = {}) {
  const states = [];
  for (const { key, value, digits, spec } of CATALOG) {
    let v;
    if (INDEX_KEYS.has(key)) {
      // Never 0 (the guard never lets 0 through, checked again here).
      v = isNumber(indexes[key]) && indexes[key] > 0 ? indexes[key] : undefined;
    } else if (value !== undefined) {
      v = values[value];
    }
    if (!isNumber(v)) {
      continue;
    }
    const r = round(v, digits);
    const min = spec.min ?? 0;
    if (r < min || (spec.max !== undefined && r > spec.max)) {
      continue;
    }
    states.push({ device_feature_external_id: external.feature(key), state: r });
  }
  return states;
}
