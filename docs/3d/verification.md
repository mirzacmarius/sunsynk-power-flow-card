# Verification

What was run for this version (7.3.3-3d.1), on macOS (Apple M4 Max), Node 24,
Chrome for Testing (headless, GPU WebGL through ANGLE/Metal) and Home Assistant
Core 2026.10.2.

## Build and static checks

| Check                                            | Result                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run build` (Rollup + rpt2 + Babel + Terser) | passes; entry 0.1 KB, core 715 KB (267 KB gzip), 3D scene 894 KB (232 KB gzip), editor 106 KB |
| `npm run typecheck` (`tsc --noEmit`)             | 0 errors                                                                                      |
| ESLint + Prettier on all new and changed files   | 0 errors (upstream components keep their existing formatting warnings)                        |
| `npm test` (Vitest, data adapter)                | 21 / 21                                                                                       |

The unit tests cover kW→W and Wh→kWh normalisation, MPPT shares, the Solis
battery direction register (and its unavailability), `invert_flow`, runtime and
remaining-energy maths, missing capacity, grid disconnected vs. zero exchange
vs. unknown, non-Solis status entities, home = essential load, the energy
balance, energy-as-power unit mismatches, rooms derived from classic loads,
control only for configured entities of allowed domains, today's energy from
statistics, and night mode from `sun.sun`.

## Browser checks against simulated states (`npm run test:e2e`)

45 / 45, using the demo page with Marius's configuration and simulated states:

- WebGL rendering (≈ 220 draw calls at `high` quality); every flow's activity and
  direction for sunny export, evening discharge (40 W import shown as import),
  grid charging, grid outage, MPPT string fault, inverter alarm and unavailable
  or missing sensors; night mode from `sun.sun`.
- String diagnostics: _No voltage_ for a dead string and _Underperforming_ for a
  weak one, only when its same-orientation peer produces.
- Presets (overview, solar with overlay, battery & inverter, room consumption
  with exploded floors and device branches, night), ground/first floor selection
  with semi-transparent upper floors, device detail panel, control with
  confirmation calling `switch.toggle`, and no control for unconfigured devices.
- Classic ↔ 3D switching in place (toolbar, 3D button, repeated `view_mode`
  changes) with exactly one canvas left; leaving 3D disposes the renderer
  (context lost), stops the loop and removes the canvas; the loop pauses when
  the card is off-screen.
- Classic-only configs render the original card and never download the 3D chunk;
  without WebGL the classic card is shown with a notice.
- Hover tooltip with live inverter values, palette colours in the classic view,
  a glTF model replacing the built-in house, the loggia wash following
  `light.lumini_balcoane`, room lighting following its light entity, reduced
  motion (no particles), Romanian strings, light theme, phone layout without
  horizontal overflow, tablet layout.

Screenshots: [screenshots/](screenshots/).

## Inside Home Assistant (`node test/ha/run-ha-check.mjs`)

11 / 11 on a throwaway Home Assistant Core 2026.10.2 (Python venv, bound to
127.0.0.1) with template entities using the real Solis entity ids:

- The card loads as a Lovelace resource (`/local/...`) and is registered in the
  card picker; the 3D view renders in a sections dashboard.
- Changing `input_select.sim_scenario` reaches the card through `hass`
  (grid outage → _Disconnected_ and no grid animation; evening → battery
  discharging from the Solis direction sensor; unavailable states → "—").
- The configured Daikin control toggles the real `switch.daikin_parter_power`.
- History for the bottom charts comes from the recorder over `hass.callWS`.
- The visual editor renders with the new `view_mode` option.
- A `view_mode: classic` card renders the original card.
- No card errors in the browser console.

This run found and fixed one real integration bug: with a cache-busting query on
the resource URL (`?v=`, HACS's `?hacstag=`) the lazily loaded 3D chunk imported
the entry module under a different URL, so the card module ran twice and the
custom element failed to register. The build now uses a facade entry and a
shared core chunk.

## Not verified

- Your real Home Assistant, dashboards and devices: nothing was installed there.
- Real Solis/Dyness hardware values over a full day, long-term statistics older
  than the test instance, and very long uptimes (memory over days).
- Safari/iOS and the HA companion apps (only Chromium was automated here).
- The house against the photo itself: the photo didn't reach this computer, so
  the model follows a written description of it.
