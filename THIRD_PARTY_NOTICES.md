# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## sonnen-api-v2 (Katamave/sonnen_api_v2)

<https://github.com/Katamave/sonnen_api_v2>, the Python library of the
sonnenBatterie API v2 (published on PyPI as `sonnen-api-v2`, used by the Home
Assistant integration sonnenBackup). Version 0.5.15 (`__init__.py`), branch
`main` at commit 4b0d6a3 (2025-12-11). MIT License.

Ported to JavaScript in `src/sonnen/client.js` and `src/sonnen/model.js`: the
read endpoints of the local API v2 (`/api/v2/configurations`, `status`,
`latestdata`, `powermeter`, `battery`), the `Auth-Token` header of the read
token, the 401/403 answer of a refused token, the meaning of the keys and
their units (`sonnen_api_v2/const.py`, `sonnen.py`), the sign of the battery
power and of the grid feed-in, the production and consumption meters, the
usable remaining energy (usable remaining capacity × module voltage), the
operating modes (1, 2, 6, 10). The test answers of `test/fixtures/sonnen.js`
are shortened from its `tests/mock_sonnenbatterie_v2_charging.py`. Changed
here: read-only (nothing of the write API is ported), the token is never
logged (the library writes it in an error message), a missing or odd value is
never read as 0, the meters are chosen by their `direction`, and the answers
are bounded.

Its license notice, reproduced as it appears in its `LICENSE` file:

```
MIT License

Copyright (c) 2022 Vaclav Silhan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-indevolt, gladys-p1-monitor and gladys-air-q

The plausibility guard of the energy index (`src/guard.js`, the approved guard
of gladys-p1-monitor with its margin as a parameter, taken from
gladys-indevolt), the structure of the integration, the address parser
(`src/config.js`) and the two-click acceptance come from the sibling
integrations [gladys-indevolt](https://github.com/LM1LC3N7/gladys-indevolt)
and [gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor); the
fingerprint of a refused secret kept in `/data` (`src/store.js`) from
[gladys-air-q](https://github.com/LM1LC3N7/gladys-air-q). Same project,
Apache-2.0.
