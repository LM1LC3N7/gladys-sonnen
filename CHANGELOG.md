# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.3] - 2026-10-23

## [0.1.2] - 2026-10-22

### Fixed

- Coming back from "Sensor only" to the energy monitoring on an existing
  device, the first value of the solar production index is held as a jump
  (accepted only with the two clicks): the production of the period, already
  counted by the inverter, is no longer counted at once.

## [0.1.1] - 2026-10-21

### Added

- Local reading of a sonnenBatterie through its API v2 (HTTP, read token in
  the `Auth-Token` header), as the sonnen-api-v2 library does: configuration,
  status, latest data, meters and battery modules, every 30 s by default (30
  to 300 s). Read-only: no operating mode, no charge or discharge is ever
  sent.
- One device: usable and relative state of charge, usable energy remaining,
  charge and discharge power, battery power and state, solar power, house
  consumption (power, average, counter), grid exchange as `grid-sensor` /
  `power`, grid state (on grid / off grid), voltage, frequency, backup
  buffer, operating mode, discharge not allowed, cycles, cell temperatures,
  DC voltage, full charge and installed capacity.
- The solar production meter as the only energy index (with its 30-minute
  production), through the guard of gladys-p1-monitor: never 0, jumps and
  drops held until the "Accept the held index" button is clicked twice. The
  house consumption counter stays a plain sensor: no double count with the
  main meter.
- Never a read faster than the interval: not the test button, Discovery, a
  reconnection, a save of an unchanged configuration nor a restart (the last
  request is kept in `/data`, written at most once a minute). A read that
  ends after a restart or a new configuration publishes nothing.
- A refused token stops the reads, kept in `/data` (a salted fingerprint of
  the refused token only, erased by the first success), tried again after
  15 minutes doubled up to 6 hours; a new token is tried at once. HTTP 429
  and 5xx of the configuration pause the reads from 1 minute to 6 hours; an
  error of another endpoint only leaves its values out. Answers bounded to
  64 KiB, no redirect followed, the token never logged.
- "Test the connection" and "Accept the held index" buttons.
- A "Solar production" option, chosen before creating the device: the
  production meter as the energy index (default) or as a plain sensor only,
  when the solar inverter already sends its production to Gladys (no double
  count); the docs warn about it.
- Only a refusal of the configuration stops the reads: a secondary endpoint
  refusing the token only leaves its values out, with a note in the status.
- Once per start, the configuration is asked without a token: a battery that
  answers anyway is noted in the status (give it a fixed address).
- A 401 status says the address may no longer be the battery; production and
  consumption from -200 W to 0 read 0; after a restart, a battery read before
  is shown connected until its next read.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (MIT notice of sonnen-api-v2), shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-sonnen/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/LM1LC3N7/gladys-sonnen/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-sonnen/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-sonnen/releases/tag/v0.1.1
