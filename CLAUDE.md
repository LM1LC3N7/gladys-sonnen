# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a **sonnenBatterie** through its local API v2 (HTTP, port 80) with a
read token in the `Auth-Token` header: `GET /api/v2/configurations`, `status`,
`latestdata`, `powermeter`, `battery`. The endpoints, keys, units and signs
are ported from [sonnen-api-v2](https://github.com/Katamave/sonnen_api_v2)
(MIT, see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with sonnen.
**Read-only**: never `onSetValue`, never the write API. Siblings:
`gladys-indevolt` (another home battery, its structure and guard),
`gladys-p1-monitor` (the guard), `gladys-air-q` (the refused secret in `/data`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "guard"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        SonnenApp: pace, reads, index, refusal, pauses, buttons
src/sonnen/client.js              the only HTTP access (GET only, bounded body, errors in our words)
src/sonnen/model.js               the answers -> values (pure)
src/guard.js                      plausibility of an energy index, from gladys-p1-monitor (pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, catalog, states (pure)
src/config.js                     address, token and interval, normalized
src/constants.js                  paths, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read-only.** No `onSetValue`, only GET requests of `PATHS`
  (`test/client.test.js` checks it). A command, if one is ever added, is a
  `button` disabled by default behind an option, never a `switch`.
- **The token** is never logged, never shown, never written to `/data` (only
  a salted fingerprint of a REFUSED token, erased by the first success), only
  sent to the configured address; no redirect followed. Its field is
  described as "kept by Gladys in its database, never shown again".
- **Pace**: never a read faster than the interval, whatever asks (test
  button, Discovery, connection, save, restart: `/data` keeps the last
  request, written at most once a minute). A read of an old generation
  publishes nothing and sets no status.
- **Energy monitoring**: the solar production meter is the only index
  (`INDEXES` in `src/devices.js`), through `IndexGuard` (`src/guard.js`, taken
  as it is): never 0, a drop and a jump never confirmed by repetition nor by
  time, only by the `accept_held_index` action clicked twice. The house
  consumption meter is a plain sensor: no `energy-sensor` / `index`, no
  `daily-consumption`, never `publishEnergyConsumption` (no double count
  with the main meter).
- **Errors**: a refused token stops the reads (kept in `/data`, spaced
  tries); 429/5xx of the configuration pause from 1 min to 6 h (kept in
  `/data`); a secondary endpoint failing only leaves its values out.
- **Hostile answers**: bodies bounded to 64 KiB in one buffer, own keys only,
  strict numbers, ranges checked. Never a text of the battery in a message.
- **External ids are forever**: `battery:main`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys. The device published again never loses
  a feature (the whole catalog, always).
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` in the core
  (`test/manifest.test.js`).
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/sonnen-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French), kept in sync. Files
  are UTF-8 without BOM nor control byte (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
