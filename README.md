# gladys-sonnen

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**sonnenBatterie**. It reads the battery through its local API v2 (HTTP, read
token, no cloud) every 30 seconds: state of charge, charge and discharge
power, solar power, house consumption, grid exchange, backup state,
temperatures, and the solar production index for the Gladys energy
monitoring. **Read-only**: it never changes the operating mode and never
forces a charge or a discharge.

**Never tested with a real device.** Not affiliated with sonnen.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Requirements: Gladys 5.2.0 or later, the battery on the same network, a read
  token created in its web interface.

## How it works

- Every read: `GET /api/v2/configurations` first (the token check: a read
  token belongs to one battery), then `status`, `latestdata`, `powermeter` and
  `battery`, with the `Auth-Token` header, as the
  [sonnen-api-v2](https://github.com/Katamave/sonnen_api_v2) library (MIT)
  does. Ported to JavaScript, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The solar production meter is the only energy index; it passes the guard of
  gladys-p1-monitor (`src/guard.js`): never 0, jumps and drops held until the
  "Accept the held index" button is clicked twice. The house consumption
  meter is a plain sensor (the main meter of the home already counts it).
- Never a read faster than the interval, across reconnections, saves and
  restarts (`/data`); a refused token stops the reads (kept in `/data`,
  spaced tries); 429 and 5xx pause the reads; the token is never logged.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
```

See [CLAUDE.md](CLAUDE.md) for the project rules, [TODO.md](TODO.md) for the
decisions and what is left to check on a real battery.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
