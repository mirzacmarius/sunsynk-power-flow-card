# 3D view: features and known limitations

## Implemented

**Card integration**

- `view_mode: classic | 3d` on the same card; existing YAML works unchanged
  (only the fork's `type`). In-card toggle both ways, no reload; editing
  `view_mode` applies live; visual editor has the option and basic 3D settings.
- Live values come from the classic card's own calculations (DataDto), so both
  views always agree; raw states decide availability.
- Lazy 3D chunk (classic-only dashboards never load Three.js); WebGL detection
  with the classic card as fallback; WebGL context-loss handling.
- Own element name, so it coexists with the HACS card; `palette` and
  `inverter_image` supported natively for the classic view.
- English and Romanian (3D UI, plus a Romanian translation of the classic card).

**Scene**

- Parametric model of the house from the photo description: L-shaped plan,
  framed upper loggia with glass wall and balustrade, cantilevered left wing with
  the long loggia and glass railing, black frames, copings, terrace, planting,
  interiors (staircase, dining, sofa, kitchen, bedrooms), architectural lighting
  washes, downlights, wall lights and bollards. Optional GLB/glTF replacement.
- PBR materials with procedural textures (no external assets), image-based
  reflections, sun light from `sun.sun` azimuth/elevation with soft shadows,
  contact shadow, night mode (auto from the sun, or forced).
- 36 panels as individual instances on two configurable flat-roof surfaces,
  grouped by MPPT (2 × East, 2 × South), with racks.
- Solis inverter (status LED, fault halo), Dyness tower (modules from capacity,
  animated 10-segment SOC indicator), meter pillar (connection lamp),
  distribution board.
- Energy flows along plausible cable routes (roof → wall → inverter, inverter ↔
  battery, meter trench ↔ inverter, inverter → board, board → devices): glowing
  tubes plus particles; speed, brightness and particle count from measured power;
  direction from the sign; stop at zero; faint x-ray where a cable is hidden;
  reduced-motion mode.

**Interaction**

- Orbit, zoom, pan, reset; front/rear/left/right/top/isometric views with smooth
  transitions; roof toggle; ground/first floor with semi-transparent floors
  above; exploded view.
- Click to select (with camera focus and a highlight box) and hover tooltips with
  live values for MPPT strings, inverter, battery, grid, home, rooms and devices.
- Presets: Energy overview, Solar production (with the per-MPPT overlay),
  Battery & inverter, Room consumption (exploded floors, heat tint, device
  branches), Night mode.

**Data and dashboard**

- Summary tiles: solar now/today, home now/today, battery SOC and power, grid,
  inverter status.
- Side panel: battery (SOC, state, remaining energy, runtime to shutdown or time
  to full, capacity, daily charge/discharge, V/A/T/SOH), grid (state, connection
  source, import/export today, phases), MPPT table and detail (W, V, A, share,
  % of nameplate, status with peer comparison), devices and rooms (power, energy
  today via statistics, temperature, state, lights, 24 h history), inverter
  diagnostics (status code, phases, temperatures, energy balance, every bound
  entity with more-info).
- Bottom: 24 h solar, consumption, battery and grid charts and 7-day totals from
  the recorder over the existing `hass` connection.
- Device control only when `control` is configured (toggle/turn_on/turn_off,
  optional confirmation, limited to light/switch/input_boolean/fan/climate/
  media_player).
- Responsive layout (desktop, tablet, phone), dark-first glass styling that also
  follows light HA themes, accessible buttons and labels.
- Performance: render on demand, FPS caps with an idle rate, pause off-screen and
  in background tabs, merged static geometry (~220 draw calls), pixel-ratio cap,
  quality presets, full GPU cleanup on removal.

## Known limitations

- The house is reconstructed from a description of one photo; proportions,
  rear/side facades, interior layout, room positions, panel placement/tilt and
  the technical area are assumptions (see [model-assumptions.md](model-assumptions.md)).
- Per-panel values don't exist (only MPPT readings); panels show their string.
- Underperformance detection needs two strings with the same orientation; with
  one string per orientation it can only show production, not compare.
- History charts need recorder data; on a fresh install they fill in over time.
  Long-term statistics (5-minute means) need `state_class` on the sensors.
- The visual editor exposes the common 3D options only; rooms, devices and panel
  surfaces are edited in YAML.
- Automated checks ran in Chromium only (not Safari/iOS or the companion apps).
- GLB support excludes Draco/KTX2 compression (no runtime decoder downloads).
- Battery 2 is supported in data and drawn as a second tower; three or more
  batteries are not.

## Next improvements

1. Calibrate the model against the real photo (camera match of the photo view)
   and measured dimensions, or import a measured GLB.
2. Set the real panel layout, tilt and azimuths, and the real technical-room
   location.
3. Map more rooms/devices (thermostats, lights per room) and add device-level
   energy sensors where missing.
4. Optional bloom/ambient-occlusion post-processing on `high` quality.
5. A UI editor for rooms and devices.
