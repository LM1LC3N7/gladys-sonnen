# sonnenBatterie

**Unofficial** integration, not affiliated with sonnen. It reads your
**sonnenBatterie** (eco, 10, hybrid...) on your local network, through its
local API v2 (HTTP), with a read token, without any cloud.

**Never tested with a real device**: the integration was written from the
[sonnen-api-v2](https://github.com/Katamave/sonnen_api_v2) library and the API
documentation the battery serves at `/api/doc.html`, without a sonnenBatterie
at hand. Your feedback is welcome.

## Read-only

The integration **only reads** (GET requests of the read API). It never
changes the operating mode, never forces a charge or a discharge and changes
no setting. A **read** token is enough.

## What you get

One "sonnenBatterie" device (one battery per integration: the one whose token
is entered; the read API gives no serial number):

- usable state of charge (USOC, %, the one of the sonnen app), relative state
  of charge (RSOC), usable energy remaining (kWh);
- charge and discharge power (W), battery power (W, positive when
  discharging), state (0 = idle, 1 = charging, 2 = discharging);
- solar power (W) and **the solar production index** of the production meter
  of the battery, for the Gladys energy monitoring (with its 30-minute
  production, computed by Gladys);
- house consumption (W, average, and a counter in kWh);
- grid exchange (W, positive when the home imports, negative when it
  exports), grid state (0 = on grid, 1 = off grid, backup), voltage and
  frequency;
- backup buffer (%), operating mode (1 = manual, 2 = self-consumption,
  6 = module extension, 10 = time of use), discharge not allowed (0/1);
- cycles, minimum and maximum cell temperatures, DC voltage, full charge
  capacity and installed capacity.

### No double count

The consumption meter of the battery measures the house consumption, which
the main meter of the home (Linky...) already counts in Gladys. It is
therefore published as a **plain sensor**, never as a consumption index:
nothing is billed twice. The integration sends no daily consumption. Only the
**solar production** index feeds the energy monitoring.

**Solar production and inverter**: a sonnenBatterie eco is AC-coupled, with a
separate solar inverter (SMA, Fronius, SolarEdge, Kostal...), and its
production meter measures that inverter. If your inverter already sends its
production to Gladys, **keep only one source**: choose **Sensor only** in
"Solar production" **before** creating the device. The production is then a
plain sensor (kWh, never counted) and the index gets nothing. Changing this
choice after the creation: a created device keeps all its features (none is
removed), only the feature of the current choice gets values; for a clean
device, delete it and create it again. Coming back from "Sensor only" to the
energy monitoring, the first value of the index is **held** as a jump (the
production of the period, already counted by the inverter, is never counted at
once): accept it with the two clicks only if it should be.

## Requirements

- Gladys 5.2.0 or later.
- The battery on the same network as Gladys, its API reachable over HTTP
  (port 80).
- A read token: in the local web interface of the battery
  (`http://<battery-address>`), menu **Software-Integration**, **JSON API**,
  turn on **Read API** and copy the token.

## Configuration

1. Install the integration from the Gladys store.
2. **Battery IP address**: its address on your network (with `:port` only if
   it is not 80). Preferably give it a fixed address in your router.
3. **Read token**: kept by Gladys in its database, never shown again, sent
   only to the battery (in the header of its requests), never logged.
4. **Reading interval**: 30 s by default, 30 to 300 s (five small requests a
   read).
5. After the first read, create the device from the **Discover** tab.

The **Test the connection** button reads the battery once if the interval has
passed; otherwise it shows the last read and when the next one can be.

## Pace of the reads

Nothing reads the battery faster than the interval: not the test button, not
the Discover tab, not a reconnection to Gladys, not a save of an unchanged
configuration, not a restart of the container (the time of the last read is
kept in `/data`, written at most once a minute: after a restart, the first
read waits the interval plus a minute). A new address or a new token is tried
at once.

## Held index

Gladys counts every rise of an index in full. So that no fictive energy is
ever counted, the solar production index goes through a guard:

- a value of 0 is never sent;
- a drop, or a rise faster than 30 kW on average, is **held back**: the last
  accepted value is sent again, and the status of the integration shows it.
  Neither time nor repetition confirms it;
- if it is right, click **Accept the held index** **twice**: the first click
  lists what is held and accepts nothing, the second, 3 seconds to 5 minutes
  later, accepts exactly what was listed (a jump is then counted at once, a
  drop counts nothing). Saving the configuration accepts nothing.

## Errors

- **Token refused** (HTTP 401/403): the reads stop, the status says so.
  Without a change, a new try comes after 15 minutes, then 30, up to 6 hours;
  this stop is kept in `/data` across a restart. A new token saved is tried at
  once. To recognise a refused token after a restart, `/data` keeps a salted
  fingerprint of that refused token only (never of the right one), erased by
  the first successful read.
- An HTTP 429 or 5xx of the configuration pauses the battery from 1 minute to
  6 hours, kept in `/data`. An error of another endpoint only leaves its
  values out: the others are published.
- An unreachable battery is tried again after 1 minute, then 2, up to
  15 minutes, never faster than the interval.
- Only a refusal of the **configuration** is a refused token. If another part
  of the API (meters, modules...) refuses the token while the configuration
  takes it, only its values are missing, the status says so, the reads go on.
- Every read starts with the configuration, with the token: another battery
  taking the address (DHCP) refuses that token and gives nothing. Once per
  start, the integration also asks for the configuration without a token: if
  the battery answers anyway, the status advises a fixed address (only the
  address identifies it then).

## Privacy

Nothing leaves your network: the integration only talks to the battery, over
local HTTP, and follows no redirect. The token travels in clear on your local
network, as for the app of the battery.
