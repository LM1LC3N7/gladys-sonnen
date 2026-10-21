// -----------------------------------------------------------------------------
// The answers of a sonnenBatterie -> our values. Pure.
//
// The keys and their meaning come from sonnen-api-v2 (Katamave, MIT,
// `sonnen_api_v2/const.py`, `sonnen.py` and its test answers) and the API v2
// documentation of the battery:
// - status: `USOC` (usable state of charge, what the sonnen app shows),
//   `RSOC`, `Pac_total_W` (battery power, < 0 charging, > 0 discharging),
//   `Production_W`, `Consumption_W`, `Consumption_Avg`, `GridFeedIn_W`
//   (> 0 export, < 0 import), `Fac`, `Uac`, `BackupBuffer`, `SystemStatus`
//   (OnGrid, OffGrid...), `BatteryCharging`, `BatteryDischarging`,
//   `dischargeNotAllowed`, `OperatingMode`;
// - latestdata: `FullChargeCapacity` (Wh);
// - powermeter: one entry per meter, `direction` production or consumption,
//   `kwh_imported` its lifetime counter (kWh);
// - battery: `cyclecount`, `minimumcelltemperature`,
//   `maximumcelltemperature` (°C), `usableremainingcapacity` (Ah),
//   `nominalmoduledcvoltage` (V), `fullchargecapacitywh` (Wh),
//   `systemdcvoltage` (V);
// - configurations: `DE_Software`, `IC_BatteryModules`,
//   `CM_MarketingModuleCapacity` (Wh), `EM_OperatingMode`, `EM_USOC`.
//
// Hostile answers: only own keys are read (never the prototype), only finite
// numbers (or strings of a plain decimal number) are taken, every value is
// checked against a range; anything else is left out, never read as 0.
// -----------------------------------------------------------------------------

import { ENERGY_MAX, POWER_MAX } from '../constants.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, key) => (isObject(o) && Object.hasOwn(o, key) ? o[key] : undefined);

/** A number the battery sent: a finite number, or a string of a plain decimal number. */
export function num(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && /^-?\d{1,12}(\.\d{1,9})?$/.test(v.trim())) {
    return Number(v.trim());
  }
  return undefined;
}

/** `key` of `o`, a number within [min, max], else undefined. */
function read(o, key, min, max) {
  const v = num(own(o, key));
  return v !== undefined && v >= min && v <= max ? v : undefined;
}

const bool = (o, key) => {
  const v = own(o, key);
  return typeof v === 'boolean' ? v : undefined;
};

/** The keys of which one at least is in a configuration of a sonnenBatterie. */
const CONFIGURATION_KEYS = [
  'EM_OperatingMode',
  'DE_Software',
  'IC_BatteryModules',
  'EM_USOC',
  'CM_MarketingModuleCapacity',
];

/** Whether an answer is the configuration of a sonnenBatterie (not another device). */
export function isConfigurations(answer) {
  return isObject(answer) && CONFIGURATION_KEYS.some((k) => Object.hasOwn(answer, k));
}

const FIRMWARE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

/** The operating modes of the library: 1 manual, 2 self-consumption, 6 module extension, 10 time of use. */
export const OPERATING_MODES = [1, 2, 6, 10];

/** The configuration -> `{ firmware, modules, moduleCapacity, operatingMode, reserve }`. */
export function parseConfigurations(c) {
  const firmware = own(c, 'DE_Software');
  const modules = read(c, 'IC_BatteryModules', 1, 100);
  const mode = read(c, 'EM_OperatingMode', 0, 1000);
  return {
    firmware:
      typeof firmware === 'string' && FIRMWARE.test(firmware.trim()) ? firmware.trim() : undefined,
    modules: Number.isInteger(modules) ? modules : undefined,
    moduleCapacity: read(c, 'CM_MarketingModuleCapacity', 1, 100_000),
    operatingMode: OPERATING_MODES.includes(mode) ? mode : undefined,
    reserve: read(c, 'EM_USOC', 0, 100),
  };
}

/** SystemStatus -> 0 on grid, 1 off grid (backup), else undefined. */
const GRID_STATES = { ongrid: 0, offgrid: 1 };

/**
 * The meters of the powermeter answer: `{ production, consumption }` by their
 * `direction`; without any direction and with exactly two meters, as the
 * library: the first is the production, the second the consumption.
 */
export function metersOf(powermeter) {
  const list = Array.isArray(powermeter) ? powermeter.slice(0, 8).filter(isObject) : [];
  const directed = (name) =>
    list.find(
      (m) => typeof own(m, 'direction') === 'string' && m.direction.trim().toLowerCase() === name,
    );
  const anyDirection = list.some((m) => typeof own(m, 'direction') === 'string');
  if (!anyDirection && list.length === 2) {
    return { production: list[0], consumption: list[1] };
  }
  return { production: directed('production'), consumption: directed('consumption') };
}

/**
 * One read (src/sonnen/client.js readAll) -> `{ name: number }`, only what
 * came, checked. Powers in W, energies in kWh, temperatures in °C.
 */
export function parseValues(answers = {}) {
  const { configurations, status, latest, powermeter, battery } = answers;
  const v = {};
  const config = parseConfigurations(configurations);

  // --- status
  v.usoc = read(status, 'USOC', 0, 100);
  v.rsoc = read(status, 'RSOC', 0, 100);
  v.batteryPower = read(status, 'Pac_total_W', -POWER_MAX, POWER_MAX);
  if (v.batteryPower !== undefined) {
    v.chargePower = v.batteryPower < 0 ? -v.batteryPower : 0;
    v.dischargePower = v.batteryPower > 0 ? v.batteryPower : 0;
  }
  v.productionPower = read(status, 'Production_W', 0, POWER_MAX);
  v.consumptionPower = read(status, 'Consumption_W', 0, POWER_MAX);
  v.consumptionAverage = read(status, 'Consumption_Avg', 0, POWER_MAX);
  const feedIn = read(status, 'GridFeedIn_W', -POWER_MAX, POWER_MAX);
  // grid-sensor / power: import > 0, export < 0 (the battery: export > 0).
  v.gridPower = feedIn === undefined ? undefined : feedIn === 0 ? 0 : -feedIn;
  v.frequency = read(status, 'Fac', 0, 100);
  v.voltage = read(status, 'Uac', 0, 1000);
  v.backupBuffer = read(status, 'BackupBuffer', 0, 100) ?? config.reserve;
  const system = own(status, 'SystemStatus');
  v.gridState = typeof system === 'string' ? GRID_STATES[system.trim().toLowerCase()] : undefined;
  const charging = bool(status, 'BatteryCharging');
  const discharging = bool(status, 'BatteryDischarging');
  if (charging !== undefined && discharging !== undefined && !(charging && discharging)) {
    v.batteryState = charging ? 1 : discharging ? 2 : 0;
  }
  const notAllowed = bool(status, 'dischargeNotAllowed');
  v.dischargeNotAllowed = notAllowed === undefined ? undefined : notAllowed ? 1 : 0;
  const statusMode = read(status, 'OperatingMode', 0, 1000);
  v.operatingMode =
    config.operatingMode ?? (OPERATING_MODES.includes(statusMode) ? statusMode : undefined);

  // --- battery
  v.cycles = read(battery, 'cyclecount', 0, 1e6);
  v.minCellTemperature = read(battery, 'minimumcelltemperature', -40, 120);
  v.maxCellTemperature = read(battery, 'maximumcelltemperature', -40, 120);
  v.dcVoltage = read(battery, 'systemdcvoltage', 0, 1000);
  const usableAh = read(battery, 'usableremainingcapacity', 0, 100_000);
  const moduleVolts = read(battery, 'nominalmoduledcvoltage', 1, 1000);
  // As the library: usable remaining capacity (Ah) × module voltage (V).
  v.remainingEnergy =
    usableAh !== undefined && moduleVolts !== undefined
      ? (usableAh * moduleVolts) / 1000
      : undefined;
  const fullWh =
    read(battery, 'fullchargecapacitywh', 0, 1_000_000) ??
    read(latest, 'FullChargeCapacity', 0, 1_000_000);
  v.fullChargeCapacity = fullWh === undefined ? undefined : fullWh / 1000;
  if (config.modules !== undefined && config.moduleCapacity !== undefined) {
    v.installedCapacity = (config.modules * config.moduleCapacity) / 1000;
  }

  // --- powermeter
  const { production, consumption } = metersOf(powermeter);
  v.pvEnergy = read(production, 'kwh_imported', 0, ENERGY_MAX);
  v.consumptionEnergy = read(consumption, 'kwh_imported', 0, ENERGY_MAX);

  for (const name of Object.keys(v)) {
    if (v[name] === undefined) {
      delete v[name];
    }
  }
  return v;
}
