# 3D view: architecture and implementation plan

This fork adds an optional `view_mode: 3d` to the Sunsynk Power Flow Card. The
classic SVG card stays untouched and remains the default (`view_mode: classic`).

## What the inspection found (upstream v7.3.3)

| Question            | Finding                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card registration   | `src/index.ts`: `@customElement('sunsynk-power-flow-card')` on a `LitElement`, plus a `window.customCards` entry. The visual editor (`src/editor.ts`) is lazy-loaded by `getConfigElement()`.                                                                                                                                   |
| Component structure | `render()` builds one large `DataDto` from the config and `hass`, then hands it to pure template functions: `fullCard()` / `compactCard()` in `src/cards/`, which compose `src/components/{full,compact}/*` SVG fragments.                                                                                                      |
| Entity processing   | `getEntity()` wraps a `hass.states` entry in a `CustomEntity` (`toPower()` handles W/kW/MW, `toNum()`, `isValid()`...). All derived values (essential load, non-essential, three-phase sums, Solis battery direction flip, grid status from grid voltage, battery runtime, autarky) are computed once per render in `index.ts`. |
| Update path         | The `hass` setter coalesces bursts into one update per animation frame. `shouldUpdate()` re-renders only when a tracked entity's state string changes. IntersectionObserver + `visibilitychange` pause work while hidden.                                                                                                       |
| Existing animations | SVG `animateMotion` dots along fixed paths; speed comes from `animation_speed` scaled by power / `max_power`; direction from `invert_flow` and the sign of the power.                                                                                                                                                           |
| Build / deploy      | Rollup + rollup-plugin-typescript2 + Babel + Terser into one ESM file, published through HACS (`hacs.json`). The current toolchain no longer built: picomatch 4 stopped matching rpt2's default `*.ts+(                                                                                                                         | x)`glob, so every`.ts`file was skipped. Fixed with an explicit`include`. |

## Integration point

`render()` keeps computing the same `DataDto`. When the effective view mode is
`3d`, it does not call `fullCard()`; it passes the `DataDto`, the merged config
and `hass` to a new `<sunsynk-3d-view>` element instead. Everything classic
(sensor bindings, sign conventions, Solis quirks, unit handling) is reused, not
re-implemented.

```
hass ──► SunsynkPowerFlowCard.render()
             │  (existing calculations → DataDto)
             ├─ view_mode classic ─► fullCard()/compactCard()  (unchanged)
             └─ view_mode 3d ──────► buildEnergySnapshot(DataDto, hass, config)   ← pure, unit-tested
                                        │
                                        ▼
                                  <sunsynk-3d-view>  (lazy-loaded chunk with Three.js)
                                   ├─ Lit UI: summary bar, side panel, history, toolbar
                                   └─ SceneManager (Three.js): update(snapshot) changes
                                      uniforms/materials only, never rebuilds the scene
```

The 3D chunk is loaded with a dynamic `import()` the first time 3D is shown, so a
classic-only dashboard never downloads Three.js. Switching views (toolbar button,
or editing `view_mode`) re-renders in place; the scene disposes all GPU resources,
listeners, observers and animation frames when it leaves the DOM.

## Modules (`src/three-d/`)

| Module                                     | Responsibility                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `config.ts`                                | `three_d:` option types, defaults, validation messages                                       |
| `data/units.ts`                            | W/kW/MW, Wh/kWh/MWh, mV/V, mA/A normalisation; `unknown`/`unavailable`/missing handling      |
| `data/energy-adapter.ts`                   | DataDto + hass → `EnergySnapshot` (MPPTs, battery, grid, house, inverter, rooms, flows)      |
| `data/history.ts`                          | Recorder statistics/history for the bottom charts through `hass.callWS` (no extra websocket) |
| `scene/scene-manager.ts`                   | Renderer, camera, controls, render-on-demand loop, FPS caps, resize, visibility, dispose     |
| `scene/house-builder.ts` + `house-spec.ts` | Parametric house built from editable dimensions; optional GLB/glTF replacement               |
| `scene/materials.ts`, `environment.ts`     | PBR materials, procedural textures, sun from `sun.sun`, night mode                           |
| `scene/solar-array.ts`                     | 36 instanced panels on configurable roof surfaces, grouped by MPPT                           |
| `scene/equipment.ts`                       | Solis inverter, Dyness tower battery with SOC segments, grid connection point                |
| `scene/flows.ts`                           | Glowing paths + particles; speed/brightness/density from measured power; reduced motion      |
| `scene/rooms.ts`                           | Room volumes, devices, floating indicators, controllable lights                              |
| `scene/interaction.ts`, `camera-rig.ts`    | Raycast hover/click, highlight, camera presets and smooth transitions                        |
| `ui/*`                                     | Lit panels, SVG charts, glass styles, English/Romanian strings                               |

## Rules the adapter follows

- No invented values: a missing or `unavailable` entity is shown as unavailable, never as 0.
- Power and energy are kept apart; an energy entity configured as power is flagged.
- Battery and grid signs come from the same config flags the classic card uses
  (`invert_power`, `invert_flow`, `invert_grid`, Solis `battery_current_direction`).
- Grid "disconnected" (status entity / grid voltage) is a different state from 0 W exchange.
- House consumption is the card's essential load (plus non-essential when shown), never inverter output.
- Per-panel values are never fabricated: panels show their MPPT's readings.

## Deployment model

The fork registers its own element, `custom:sunsynk-power-flow-card-3d`, built to
`dist/sunsynk-power-flow-card-3d.js` (+ a lazy 3D chunk). It can live next to the
HACS-installed upstream card without conflicts, and HACS updates of upstream can't
overwrite it. Existing YAML works after changing only the `type`.

## Testing plan

1. `npm run build`, ESLint on changed files, `tsc`, Vitest unit tests for the adapter.
2. Browser demo (`demo/`) with simulated `hass` states and scenarios (sunny export,
   evening discharge, grid outage, grid charging, missing/unavailable sensors, themes, en/ro).
3. A throwaway Home Assistant Core instance (Python venv, no Docker) with template
   sensors using the real entity IDs, loading the card as a Lovelace resource.
