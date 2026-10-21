// -----------------------------------------------------------------------------
// A fake sonnenBatterie: the answers of the test data of sonnen-api-v2
// (Katamave, MIT, `tests/mock_sonnenbatterie_v2_charging.py`: a battery
// charging from the sun), shortened, behind a read token.
// -----------------------------------------------------------------------------

export const HOST = '192.168.1.50';
export const ADDRESS = `${HOST}:80`;
export const TOKEN = 'rEaD-t0ken-1234567890';
/** 2026-10-21 10:00:00 UTC. */
export const NOW = Date.UTC(2026, 9, 21, 10, 0, 0);

export const answers = () => ({
  '/api/v2/configurations': {
    EM_RE_ENABLE_MICROGRID: '1',
    IC_BatteryModules: 4,
    DE_Software: '1.14.5',
    EM_USOC: 20,
    EM_OperatingMode: '2',
    IC_InverterMaxPower_w: 5000,
    CM_MarketingModuleCapacity: 5000,
    CN_CascadingRole: 'none',
  },
  '/api/v2/status': {
    Apparent_output: 98,
    BackupBuffer: '20',
    BatteryCharging: true,
    BatteryDischarging: false,
    Consumption_Avg: 486,
    Consumption_W: 1578,
    Fac: 50.05781555175781,
    GridFeedIn_W: 0,
    OperatingMode: '2',
    Pac_total_W: -1394,
    Production_W: 2972,
    RSOC: 88,
    RemainingCapacity_Wh: 40181,
    SystemStatus: 'OnGrid',
    Timestamp: '2023-11-20 17:00:55',
    USOC: 81,
    Uac: 235,
    Ubat: 212,
    dischargeNotAllowed: false,
  },
  '/api/v2/latestdata': {
    FullChargeCapacity: 20187.086,
    Production_W: 2972,
    Consumption_W: 1578,
    Pac_total_W: -1394,
    RSOC: 88,
    USOC: 81,
    ic_status: { nrbatterymodules: 4, statebms: 'ready', secondssincefullcharge: 3720 },
  },
  '/api/v2/battery': {
    cyclecount: 30.0,
    fullchargecapacitywh: 20683.49,
    maximumcelltemperature: 19.95,
    minimumcelltemperature: 18.95,
    maximummoduletemperature: -273.15,
    nominalmoduledcvoltage: 102.4,
    systemdcvoltage: 208.3,
    usableremainingcapacity: 163.6,
  },
  '/api/v2/powermeter': [
    { direction: 'production', kwh_imported: 3969.800048828125, w_total: 609.5 },
    { direction: 'consumption', kwh_imported: 816.5, w_total: 59.29999923706055 },
  ],
});

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * The routes of a battery taking `state.token`: `state.answers` by path,
 * `state.fail[path]` an HTTP status (or a function throwing) instead,
 * `state.hold` a promise every request waits for (a slow battery).
 */
export function battery(overrides = {}) {
  const state = { token: TOKEN, answers: answers(), fail: {}, hold: undefined, ...overrides };
  const routes = {};
  for (const path of Object.keys(state.answers)) {
    routes[path] = async (call) => {
      if (state.hold) await state.hold;
      const failure = state.fail[path];
      if (typeof failure === 'function') return failure(call);
      if (typeof failure === 'number') return json({ error: 'nope' }, failure);
      if (call.init.headers?.['Auth-Token'] !== state.token) {
        return json({ error: 'Unauthorized' }, 401);
      }
      return json(state.answers[path]);
    };
  }
  routes.state = state;
  return routes;
}
