# Verification

What was run for this version (7.3.3-3d.6), on macOS (Apple M4 Max), Node 24,
Chrome for Testing (headless, GPU WebGL through ANGLE/Metal), a throwaway Home
Assistant Core 2026.10.2 and Marius's own Home Assistant (2026.10.2).

## Build and static checks

| Check                                            | Result                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run build` (Rollup + rpt2 + Babel + Terser) | passes; entry 0.1 KB, core 715 KB (267 KB gzip), 3D scene 895 KB (231 KB gzip), editor 106 KB |
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

52 / 52, using the demo page with Marius's configuration and simulated states:

- WebGL rendering (≈ 220 draw calls at `high` quality); every flow's activity and
  direction for sunny export, evening discharge (40 W import shown as import),
  grid charging, grid outage, MPPT string fault, inverter alarm and unavailable
  or missing sensors; night mode from `sun.sun`.
- String diagnostics: _No voltage_ for a dead string and _Underperforming_ for a
  weak one, only when its same-orientation peer produces.
- Presets (overview, solar with overlay, battery & inverter, room consumption
  with exploded floors and device branches, night), ground/first floor selection
  with semi-transparent upper floors, device detail panel, control with
  confirmation calling `switch.toggle`, and no control for unconfigured devices;
  a running AC shows its mode and action, one that is off shows no mode row.
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
- A DOM walk up from inside the card through `.host` / `parentNode` (what
  card-mod does) terminates.
- The summary tiles fit their longest values ("Disconnected" / "Deconectată")
  at every card width from 390 to 1700 px in both languages, and on the phone
  and tablet layouts no 3D label overlaps another label, the toolbar, the preset
  chips or the legend.

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

## On Marius's Home Assistant

Installed on 2026-10-19 with his approval, then added to the _Energie_ view of
`/home-dashboard` when he asked.

- Files: `/config/www/sunsynk-power-flow-card-3d/` (the four `.js` files of this
  build, byte-identical to `dist/`). Resource:
  `/local/sunsynk-power-flow-card-3d/sunsynk-power-flow-card-3d.js?v=7.3.3-3d.6`
  (module). The HACS resource of the upstream card is unchanged; the resource
  list and the dashboard were backed up first (`audit/` in the HA workspace).
- Dashboard: a full-width _Casa 3D_ section under the existing _Invertor Solis
  S6-EH3P_ and _Acum_ sections; nothing else on the dashboard changed (checked by
  comparing the saved config with the backup). The card config is the example
  one plus the existing card's `inverter_image`, with the TV state taken from
  `media_player.samsung_qn85aa_55_tv_qe55qn85aatxxh` (the DLNA entity is
  unavailable while the TV is off). All 69 entity ids it uses exist.
- The saved view in a browser at 1600 px (desktop) and 390 px (phone): both
  Sunsynk cards render, the 3D view runs (≈ 230 draw calls), no tile text is cut
  off, no label overlaps the overlays, the Daikin panel shows _Stare: Oprit_
  without an untranslated mode row, and the console has no errors.
- Both `custom:sunsynk-power-flow-card` and `custom:sunsynk-power-flow-card-3d`
  register, and the existing Sunsynk card on the _Energie_ view still renders.
- A temporary card (never saved, removed afterwards) with the example
  configuration and the real entities, checked after sunset: solar 0 W with the
  four MPPTs idle (≈ 60–160 V, no fault flagged at night), battery 60 %
  discharging 556 W from the Solis direction sensor, 12.8 kWh to 10 % and
  ≈ 23 h runtime (the same as the classic card), grid _Disconnected_ from the
  grid voltage (no grid animation), home ≈ 400 W, inverter status 3 _Normal_,
  25.7 °C, today's totals matching the classic card, room and device power from
  the real sensors, night mode from `sun.sun`, the balcony and terrace washes
  in the real lights' warm white (`light.lumini_balcoane` and
  `light.lumini_terasa` were on at ≈ 3900 K), no errors in the console.

This found and fixed real bugs:

- With card-mod installed the 3D view crashed with _Maximum call stack size
  exceeded_, because a view property named `host` made card-mod's walk up the
  DOM (which prefers `.host`, the shadow root's host) loop forever. The property
  was renamed and the e2e suite now checks the walk (3d.2).
- At the dashboard's 1310 px card width the eight-tile summary cut off
  _Deconectată_ and _Putere baterie_; tiles now switch to four per row below
  1600 px (3d.3).
- On a phone the solar label sat under the toolbar, then on top of the battery
  label; labels now avoid the overlays and sit beside a label in their way
  (3d.4, 3d.5).
- The AC panel showed a second, untranslated status row (_off · off_); it is now
  a _Mode_ row formatted by Home Assistant, shown only when the device does more
  than on/off (3d.6).

## Not verified

- Solar production, charging or grid export with the real hardware (every check
  on Marius's Home Assistant ran after sunset), and a running AC's mode text.
- Real Solis/Dyness values over a full day, long-term statistics older than the
  test instance, and very long uptimes (memory over days).
- Safari/iOS and the HA companion apps (only Chromium was automated here).
- The house against the photo itself: the photo didn't reach this computer, so
  the model follows a written description of it.
