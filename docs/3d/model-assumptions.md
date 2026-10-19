# House model: what it is based on, and what is assumed

The built-in model is a parametric reconstruction from **one dusk photograph of
the garden facade** (described in the project thread) and the written brief. A
single photo can't give real dimensions, the rear and sides, or the roof, so the
model is a plausible first version with every dimension editable under
`three_d.house`. A measured model can replace it (`three_d.model`, GLB/glTF).

## Coordinate system

Metres. `x` runs along the garden facade (left wing at negative `x`, the right
volume at positive `x`, the junction between them at `x = 0`); `z` points out of
the garden facade, with both rear walls at `z = 0`; `y` is up from terrace level.
Room `bounds`, device positions and equipment positions use these coordinates.

```
 z ▲ (garden)
   │            ┌──────────┐  ← right volume front (frame + loggia)  z = Ld + projection
   │ ┌──────────┤          │
   │ │ left wing│  right   │  ← left upper box front                  z = Ld
   │ │  (L)     │  volume  │
   │ │          │  (R)     │
   │ └──────────┴──────────┘  ← rear walls                            z = 0
   └──────────────────────────► x
   -Lw-cantilever      0      Rw
```

## From the photo (kept as described)

- L-shaped plan: two flat-roofed, two-storey volumes; the right volume projects
  into the garden in front of the left one.
- Warm white/cream render, slim black window frames, thin anthracite copings on
  every roof edge.
- **Right volume, upper floor**: a thick rectangular frame (top band ≈ 1.5 m,
  left leg ≈ 0.6 m, right leg ≈ 1.2 m, bottom band ≈ 0.7 m) around a recessed
  loggia ≈ 1.2 m deep; 4-pane floor-to-ceiling glass wall ≈ 4 m wide at the back
  of the loggia, aligned over the ground-floor glazing; frameless glass balustrade
  ≈ 1.1 m; plants on the loggia; the frame overhangs the ground floor slightly.
- **Right volume, ground floor**: 4-pane floor-to-ceiling glazing ≈ 4.2 × 2.6 m,
  narrow pier on the left, wider (≈ 1.4 m) pier on the right; inside: open-riser
  staircase on the left, dining table with pendants, sofa on the right.
- **Right volume, left side wall** (facing the terrace): one tall narrow window
  per floor near the front corner, small wall lights.
- **Left wing, upper floor**: a box cantilevered over the ground floor at the
  front and past it at the left end; a long recessed loggia from near its left
  end to the right volume, full-width frameless glass railing on a slim metal
  channel, two tall dark door units on the back wall, four ceiling downlights,
  a solid band above the opening.
- **Left wing, ground floor**: set back under the cantilever, glazed door and a
  second door, row of soffit downlights.
- Paved terrace along the whole facade with a dark paver edge.
- Lighting: magenta wash in the upper loggia, blue/cyan wash under the
  cantilever, warm interior light, small wall lights. These are drawn as
  architectural lighting zones and can be driven by real light entities.

## Assumed (adjust in `three_d.house`)

| Value                    | Default                                  | Basis                                                                                                                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `floor_height`           | 3.15 m                                   | typical for floor-to-ceiling glazing of ≈ 2.6 m; gives ≈ 7.4 m to the coping, close to the ≈ 7.5 m estimate                                 |
| `parapet`                | 0.75 m                                   | flat roofs with hidden panels need a parapet                                                                                                |
| `left.width`             | 9.6 m                                    | ≈ 1.5 × the right volume's front                                                                                                            |
| `left.depth`             | 9.0 m                                    | not visible in the photo                                                                                                                    |
| `left.ground_setback`    | 1.6 m                                    | depth of the cantilever over the terrace                                                                                                    |
| `left.cantilever_left`   | 0.8 m                                    | overhang past the left end                                                                                                                  |
| `left.loggia_depth`      | 1.7 m                                    |                                                                                                                                             |
| `right.width`            | 6.3 m                                    | "≈ 6 to 6.5 m"                                                                                                                              |
| `right.projection`       | 5.5 m                                    | "very roughly 4 to 7 m" in front of the left wing                                                                                           |
| both roof heights        | equal                                    | the roof lines meet at the junction in the photo                                                                                            |
| rear and side facades    | plausible windows                        | not visible                                                                                                                                 |
| interior layout          | plausible                                | room `bounds` in the example follow the HA areas (Living, Bucătărie, Hol / Matrimonial, Dormitor, Hol Etaj) but their positions are guesses |
| `compass.facade_azimuth` | 180 (south)                              | orientation can't be read from the photo                                                                                                    |
| technical area           | right volume's side wall, under a canopy | not in the photo; move with `inverter.position` / `battery.position`                                                                        |
| grid connection          | meter pillar near the front-right corner | typical BMPT box at the property edge                                                                                                       |

Left out on purpose: neighbouring houses, the gazebo, the cement mixer, sand,
buckets and boards (temporary construction items in the photo).

## Solar panels

No panels are visible in the photo (they sit behind the parapets), so placement
and tilt are **not** taken from it. Defaults: 2 east-facing rows of 9 portrait
panels on the right roof (MPPT1, MPPT2) and 4 south-facing rows of 5 landscape
panels on the left roof (MPPT3, MPPT4, 9 panels each), 15° tilt, 1.134 × 1.722 m
panels. Set the real layout in `three_d.solar.surfaces`.

## Equipment

- Solis S6-EH3P20K-H: ≈ 0.55 × 0.64 × 0.23 m body, display, status LED bar, side
  heatsinks, bottom glands. The status LED and a red halo follow the inverter
  status (Solis status codes from the card).
- Dyness Tower: plinth, stacked modules (count from capacity / 5.12 kWh), control
  unit on top, a 10-segment SOC indicator that animates up while charging and
  down while discharging.

## Replacing the model with a measured one

1. Model the house in metres with the garden facade facing +Z and Y up (Blender:
   export glTF 2.0 with _+Y Up_). Put the rear wall on Z = 0 and the left/right
   junction on X = 0, or use `model.position` / `model.rotation` to align it.
2. Export as `.glb`, copy it to `/config/www/house/house.glb` and set
   `three_d.model.url: /local/house/house.glb`.
3. Set `three_d.house` dimensions to match, so panels, equipment, flows and rooms
   line up with your model.
