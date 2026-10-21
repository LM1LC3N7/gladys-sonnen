# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real sonnenBatterie (ideally an eco 8
      or 10 with a production meter): read token, test button, device
      creation, the solar index in the energy monitoring.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real battery (built without one)

- [ ] That every read endpoint (`configurations`, `status`, `latestdata`,
      `powermeter`, `battery`) asks for the read token (`/api/doc.html`): the
      configuration is the token check of every read.
- [ ] The path in the web interface to create the read token
      (Software-Integration, JSON API, Read API) on recent software.
- [ ] The `direction` of the meters (`production`, `consumption`) on the
      software in the field; a battery without a production meter (no solar).
- [ ] The sign of `GridFeedIn_W` (export > 0, the library) and of
      `Pac_total_W` (discharge > 0).
- [ ] Whether a software update or a meter change resets `kwh_imported` of
      the production meter (the guard holds it until the user accepts).
- [ ] The cascade of several batteries (`CN_CascadingRole`): which one
      answers for the whole system.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-sonnen:0.1.0`), as
  for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: sonnen-api-v2 (Katamave, MIT, 0.5.15, `main` at commit
  4b0d6a3, LICENSE checked: MIT, "Copyright (c) 2022 Vaclav Silhan"), cloned
  read-only in `_ref/sonnen-api-v2`, ported to JavaScript: the endpoints, the
  `Auth-Token` header, the keys, units and signs, the usable remaining
  energy. The library is not very active: the API documentation the battery
  serves (`/api/doc.html`) is the reference. The SDK stays the only runtime
  dependency. Structure, guard (identical to gladys-indevolt's
  `src/guard.js`: the approved guard of gladys-p1-monitor with `maxKw` as a
  parameter) and two-click acceptance from gladys-indevolt; the fingerprint of
  a refused secret from gladys-air-q. The template's demo files were removed
  (`git rm`).
- **Read-only (v1)**: no `onSetValue`, no operating mode, no charge or
  discharge set point, no write API (the client has no method for it,
  tested). A read token is enough; the docs say so.
- **One battery, external id `battery:main`**: the read API gives no serial
  number (only the legacy `system_data` of a logged-in session, not used).
  The address is a param (`SONNEN_ADDRESS`); a new address keeps the device
  and its history.
- **Identity at every read**: the configuration is asked first, with the
  token; a read token belongs to one battery, so another battery at the
  address (DHCP) answers 401 (the read stops, nothing published, the refusal
  shown). A non-sonnen answer (no key of a configuration) is
  `unknown_answer`. No fingerprint of the hardware (modules, capacity): an
  extension of the battery would have blocked every read, and the token
  already decides.
- **Energy (lot 6 rules, no double count)**: the solar production meter
  (`powermeter`, `direction` production, `kwh_imported`) is the only index
  (`energy-production-sensor` / `index`, its `thirty-minutes-production`
  declared with UUID v5 ids), through the IndexGuard with its own margin
  `INDEX_LIMITS.pv`: 30 kW (the meter measures the whole solar installation,
  whatever the battery model) and `slackKwh` 0.5; the same margin bounds the
  second click. The consumption meter measures the house consumption, already
  counted by the main meter: a plain sensor (`unknown`, kWh in the name),
  never `energy-sensor` / `index`, no `daily-*`, never
  `publishEnergyConsumption` (tested). No energy is ever made up from a
  power (the API has no battery nor grid counter).
- **Grid**: `GridFeedIn_W` (export > 0) is published as `grid-sensor` /
  `power` with the sign of the core (import > 0), the only form the battery
  reports (never `input-power` and `output-power` too).
- **Powers**: charge and discharge from the sign of `Pac_total_W` (< 0
  charging); the BMS draw (about 25 W) shows as a small charge, as in the
  status of the battery. The library's estimate of the BMS draw is not
  ported (a guess on the cell temperature).
- **Meters**: chosen by `direction`; without any direction and exactly two
  meters, the first is the production (the library's order).
- **Pace (lot 11)**: one read = five GETs, 30 s by default (30-300 s). The
  timer looks every 5 s whether a read is due; nothing reads sooner than the
  last request + the interval (monotonic clock): not the test button, not
  Discovery (it only republishes the device), not a (re)connection, not a
  save of an unchanged form, not a restart (the last request is written to
  `/data` at most once a minute, so after a restart the first read waits that
  instant + one minute + the interval). A new address or a new token is read
  at once. A read running is never doubled, whatever its generation; a read
  that ends after a restart or a new configuration publishes nothing and sets
  no status (a pause or a refusal of the same address and token is still
  kept).
- **Token refused (401/403)**: a stop `{ until, count, status, fp }` in
  `/data`, tried again after 15 min doubled up to 6 h, never in a loop; the
  test button may try once per click when the interval has passed. `fp` is a
  salted scrypt fingerprint (random salt per file) of the refused token
  only, to know after a restart whether the configured token is the refused
  one; erased by the first success: nothing in `/data` can confirm a working
  token. The token is never logged nor shown (tested), only sent to the
  configured address, no redirect followed.
- **429 / 5xx**: of the configuration (or a 429 anywhere): pause
  `{ until, count, code, status }` in `/data`, from Retry-After or 1 min
  doubled, 1 min - 6 h, at least the interval, end capped when read back. A
  5xx or an odd answer of a secondary endpoint only leaves its values out
  (shown in the status); a network failure stops the remaining requests of
  the read.
- **Unreachable**: 1 min (never faster than a read), doubled up to 15 min.
- **Only the configuration refuses a token** (review 1, point 1): a 401/403
  of a secondary endpoint, after the configuration took the token, only
  leaves that endpoint out (`denied`, a note in the status); the reads go on
  at their pace and no refusal nor fingerprint is written (the token is good).
- **Solar production option** (review 1, point 2): `pv_index`, "Energy
  monitoring" (default: the guarded index) or "Sensor only" (the same meter as
  the plain sensor `pv_energy_total`, never counted), chosen before creating
  the device, as in gladys-engie-belgium: an AC-coupled sonnenBatterie eco has
  a separate inverter that may already send the same production to Gladys.
  A created device never loses a feature: the feature of the other choice
  stays declared and gets no value. Docs fr/en warn about the double count.
- **Check without a token** (review 1, point 3): once per start and address,
  after the first good read, one `GET /api/v2/configurations` without
  `Auth-Token`; if it answers as a sonnenBatterie, the status advises a fixed
  address (the token then identifies nothing). Never a fingerprint of the
  hardware.
- **401 wording** (review 1, point 4): the status says the address may no
  longer be the battery (DHCP), before telling the user to check the token.
- **Stand-by readings** (review 1, point 5): production, consumption and its
  average from -200 W to 0 are 0 (an inverter at night), never the last value
  of the day; further below, left out.
- **Status after a restart** (review 1, point 6): a battery read before,
  without refusal, pause nor error, is shown connected, "next read at ...",
  until its first read (interval + 1 minute).
- **New address clears the pause** (review 1, point 7, kept on purpose): a
  pause (429/5xx) and a refusal belong to an address; saving another address
  (even the host name of the same battery) starts afresh and reads at once.
  It takes a gesture of the user, one request per save, and a pause asked by
  the battery is then asked again if still needed.
- **Generation after every await** (review 1, point 8): checked between the
  Discovery and the status of a read, and in `publishLast`.
- **States per minute**: a sliding budget of 270 states over 60 s, taken
  before each publication (two publications at once never both pass).
- **Device created**: it gets the values of the last read at once (if fresh:
  two intervals), never a new request.
- **Hostile answers**: bodies bounded to 64 KiB, read into one buffer (no
  buffer per chunk, no concatenation), JSON parsed once, own keys only,
  strict numbers, ranges checked; firmware checked by pattern before being
  shown.
- **No custom User-Agent**, no imitation: Node's own fetch, the requests of
  the library. No Bluetooth. No network discovery (the battery is typed).
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- Several batteries (one address and token each) if users ask.
- The time to full charge / to the reserve (computed by the library).
- Commands (operating mode, charge set point) as buttons behind options
  disabled by default, the return to self-consumption never blocked, once
  tested on a real battery with a write token.
