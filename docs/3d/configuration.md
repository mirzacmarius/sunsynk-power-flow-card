# 3D view configuration

The 3D view is part of the same card. Your existing configuration (entities,
`solar`, `battery`, `load`, `grid`, `inverter`) keeps working unchanged and feeds
both views. The fork adds three things:

| Key         | Type              | Default   | What it does                                                                                                     |
| ----------- | ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `type`      | string            | —         | `custom:sunsynk-power-flow-card-3d` (the fork's element name)                                                    |
| `view_mode` | `classic` \| `3d` | `classic` | Which view the card opens with. The toolbar button switches at runtime; editing `view_mode` applies immediately. |
| `three_d`   | object            | `{}`      | Options for the 3D view (below). Every key is optional.                                                          |

A complete, tested example for a Solis S6-EH3P20K-H with 4 MPPTs and a Dyness
battery is in [example-lovelace.yaml](example-lovelace.yaml).

Two optional keys also work in the classic view of the fork (they replace the
`sunsynk-card-extras.js` resource for this card):

| Key                                      | What it does                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `palette: { light: {...}, dark: {...} }` | Colours per HA theme mode. Keys: `solar`, `battery`, `battery_charge`, `load`, `grid`, `grid_off`, `inverter`. |
| `inverter_image`                         | URL of a picture that replaces the inverter image (classic view, `inverter.modern: false`).                    |

## General

| Key                       | Default    | Notes                                                                                                 |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `language`                | `auto`     | `auto` follows the HA user language; `en` or `ro` force a language.                                   |
| `height`                  | adaptive   | Stage height, e.g. `680` (px) or `"70vh"`.                                                            |
| `show_view_toggle`        | `true`     | The "Switch to the classic card" button (and the 3D button on the classic card).                      |
| `quality`                 | `auto`     | `low` (no shadows, pixel ratio 1), `medium`, `high`. `auto` picks from the GPU and device.            |
| `max_fps`                 | `60`       | Frame cap while animating.                                                                            |
| `idle_fps`                | `20`       | Frame cap after `idle_timeout` seconds without interaction.                                           |
| `idle_timeout`            | `90`       | Seconds.                                                                                              |
| `pixel_ratio_max`         | `2`        | Upper bound for high-DPI screens.                                                                     |
| `animation_intensity`     | `1`        | 0…2. Scales flow speed and particle count; `0` keeps flows static.                                    |
| `min_flow_power`          | `10`       | W. Below this a flow is idle (no animation), so sensor noise doesn't move.                            |
| `reduced_motion`          | `auto`     | `auto` follows the OS "reduce motion" setting; `true` shows direction with static glowing paths only. |
| `night_mode`              | `auto`     | `auto` uses `sun_entity` (falls back to the clock); `on` / `off` force it.                            |
| `sun_entity`              | `sun.sun`  | Its `azimuth`/`elevation` also position the sun and shadows.                                          |
| `show_idle_paths`         | `true`     | Faint paths for flows that are currently idle.                                                        |
| `show_labels`             | `true`     | Floating value labels.                                                                                |
| `solar_overlay`           | `false`    | Start with the per-MPPT solar overlay on.                                                             |
| `semi_transparent_floors` | `true`     | Floors above the selected one turn see-through instead of disappearing.                               |
| `default_preset`          | `overview` | `overview`, `solar`, `battery`, `rooms`, `night`.                                                     |
| `colors`                  | see below  | Flow colours.                                                                                         |
| `statistics`              | see below  | Summary tiles and history.                                                                            |

### `camera`

| Key                             | Default    | Notes                                                          |
| ------------------------------- | ---------- | -------------------------------------------------------------- |
| `default_view`                  | `iso`      | `iso`, `front`, `rear`, `left`, `right`, `top`.                |
| `fov`                           | `32`       | Degrees; a narrow field of view gives the near-isometric look. |
| `auto_rotate`                   | `false`    | Slow orbit.                                                    |
| `min_distance` / `max_distance` | `8` / `90` | Zoom limits (m).                                               |
| `transition_ms`                 | `900`      | Camera transition time (0 with reduced motion).                |

### `colors`

`solar` `#ffb020`, `battery_charge` `#22c55e`, `battery_discharge` `#22d3ee`,
`home` `#3b82f6`, `grid_import` `#a855f7`, `grid_export` `#2dd4bf`, `fault`
`#ef4444`, `idle` `#64748b`.

### `statistics`

| Key               | Default | Notes                                                                                                                     |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `summary`         | all     | Order/subset of `solar_now`, `solar_today`, `home_now`, `home_today`, `battery_soc`, `battery_power`, `grid`, `inverter`. |
| `history`         | `true`  | Bottom charts and daily totals.                                                                                           |
| `history_hours`   | `24`    | Chart window.                                                                                                             |
| `daily_days`      | `7`     | Days in the daily totals chart.                                                                                           |
| `refresh_minutes` | `5`     | How often history is re-read from the recorder.                                                                           |

History is read with `hass.callWS` (the card's existing connection): long-term
statistics (5-minute means) where the entity has a `state_class`, otherwise the
state history. Battery and grid history apply the same sign rules as the live
values, including the Solis direction register.

## House model

### `house` — dimensions of the built-in model (metres)

See [model-assumptions.md](model-assumptions.md) for what each value means and
how they were estimated.

```yaml
three_d:
  house:
    floor_height: 3.15
    parapet: 0.75
    left:
      {
        width: 9.6,
        depth: 9.0,
        ground_setback: 1.6,
        cantilever_left: 0.8,
        loggia_depth: 1.7,
      }
    right:
      {
        width: 6.3,
        projection: 5.5,
        frame_top: 1.5,
        frame_left: 0.6,
        frame_right: 1.2,
        glazing_width: 4.2,
      }
```

### `model` — your own GLB/glTF

```yaml
three_d:
  model:
    url: /local/house/house.glb # served by HA from /config/www/house/house.glb
    scale: 1
    position: [-2.05, 0, 7.4] # metres, in house coordinates
    rotation: [0, 0, 0] # degrees
    hide_procedural: true # hide the built-in walls, interiors and fittings
```

Panels, equipment, flows and rooms stay where the house dimensions put them, so
size and place the model to match `house`. Meshopt-compressed files work; Draco
and KTX2 files are not supported because they need decoders downloaded at runtime.

### `compass`

`facade_azimuth` (default `180`): the compass direction the garden facade faces.
Panel azimuths and the sun position use it.

## Solar panels

```yaml
three_d:
  solar:
    panel: { width: 1.134, height: 1.722, thickness: 0.035 } # metres
    surfaces:
      - id: east
        roof: right # left | right flat roof
        offset: [0, -0.6] # metres from the roof centre [x, z]
        azimuth: 90 # direction the panels face
        tilt: 15 # degrees
        rows: 2
        columns: 9
        orientation: portrait # portrait | landscape
        # row_spacing: 2.5      # default from tilt and panel length
        column_gap: 0.02
        mount_height: 0.25
    mppts:
      - {
          id: 1,
          name: MPPT1,
          orientation: East,
          surface: east,
          panels: 9,
          start: 0,
        }
    underperformance_ratio: 0.6 # per-panel output below 60 % of the peer string
    min_compare_power: 150 # W the peer string must produce before comparing
```

- Each MPPT takes `panels` consecutive slots (row by row) from its surface,
  starting at `start` (default: right after the previous MPPT on that surface).
- `energy_today` (per MPPT) and `panel_power` (Wp) are optional.
- Strings are only compared with strings of the same `orientation` (or surface).
  A string at 0 W while its peer produces is `Not producing` (or `No voltage`
  below 50 V); a weaker string is `Underperforming`. At night nothing is flagged.
- Panels never show values of their own; they show their MPPT's readings.

## Equipment

```yaml
three_d:
  inverter:
    model_name: Solis S6-EH3P20K-H
    position: [6.44, 1.3, 9.0] # house coordinates (default: right side wall)
    rotation: 0 # degrees around the vertical axis
    extra_entities: [sensor.solis_s6_eh3p_status_string]
  battery:
    model_name: Dyness Tower
    capacity: 25600 # Wh; default battery.energy
    modules: auto # auto = round(capacity / 5120), 2…8
    position: [6.68, 0, 7.85]
  grid:
    position: [10.9, 0, 14.1] # meter pillar
```

## Rooms and devices

Without `rooms`, the card makes one room per floor from the classic
`load.load1..6` settings; names containing _etaj_, _dormitor_, _matrimonial_,
_first_, _bedroom_ go upstairs, the rest downstairs.

```yaml
three_d:
  rooms:
    - name: Living
      floor: ground # ground | first
      bounds: [0.3, 7.4, 5.7, 6.8] # [x, z, width, depth] in metres; omit for an automatic layout
      power: sensor.living_power # optional; otherwise the sum of its devices
      energy: sensor.living_energy # total; today's value comes from statistics
      energy_today: sensor.living_energy_today # or a daily sensor
      temperature: climate.living # sensor, or a climate entity's current_temperature
      humidity: sensor.living_humidity
      lights: [light.living] # lights the room in 3D (on/off, brightness, colour)
      devices:
        - name: Daikin Parter
          type: ac # ac | tv | light | heater | appliance | boiler | pump | ev | other
          icon: mdi:air-conditioner
          power: sensor.daikin_parter_power
          energy: sensor.daikin_parter_energy
          state: climate.daikin_parter # on/off and status text
          temperature: sensor.daikin_parter_inside_temperature
          position: [1.0, 2.3, -3.2] # optional, metres from the room's floor centre
          control:
            entity: switch.daikin_parter_power
            action: toggle # toggle | turn_on | turn_off
            confirm: true # ask before acting
```

**Control safety.** A device can be switched from the card only when it has a
`control` entry, and only for `light`, `switch`, `input_boolean`, `fan`,
`climate` and `media_player` entities. Sensors never become controls, and the
classic `loadN_switch` stays a status/“more info” link. Everything else opens
Home Assistant's own more-info dialog.

## Exterior lighting

```yaml
three_d:
  exterior_lights:
    - { zone: upper_loggia, entity: light.lumini_balcoane, color: '#d946ef' }
    - { zone: lower_wall, entity: light.lumini_terasa, color: '#22d3ee' }
```

Zones: `upper_loggia`, `lower_wall`, `right_loggia`, `wall_lights`, `terrace`.
With an entity the zone follows the light (including its RGB colour); without
one it is decorative and follows night mode.

## How the values are computed

The 3D view does not re-implement the card's maths. It takes the classic card's
own results (battery power after `invert_power` and the Solis direction flip,
total grid power including three-phase sums and `invert_grid`, essential and
non-essential load) and uses the raw states only to decide availability:

| Shown as     | Rule                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Battery      | + discharging / − charging; `invert_flow: true` swaps the meaning, exactly like the classic card. If the Solis direction sensor is unavailable the battery power is unavailable (its sign is unknown).            |
| Grid         | + import / − export. With `inverter.model: solis` and `grid_voltage`, the grid is _disconnected_ below 50 V; an unreadable voltage is _unknown_, not disconnected. Otherwise `grid_connected_status_194` decides. |
| Home         | The essential load (plus non-essential when `show_nonessential`), never inverter output.                                                                                                                          |
| Units        | W/kW/MW → W, Wh/kWh/MWh → kWh, mV/V, mA/A. An energy sensor configured as power (or the reverse) is flagged and ignored.                                                                                          |
| Missing data | `unknown`, `unavailable`, non-numeric or missing entities show "—" and stop the related animation; they are never read as 0.                                                                                      |
| Balance      | The inverter panel shows sources minus loads over the hub, so double counting is visible.                                                                                                                         |
