# Installing the 3D fork

The fork registers its own element, `custom:sunsynk-power-flow-card-3d`, so it
runs **next to** the HACS-installed `sunsynk-power-flow-card` without conflicts,
and HACS updates of the upstream card can't overwrite it.

The build is four files; copy all of them:

| File                                          | Loaded                                    |
| --------------------------------------------- | ----------------------------------------- |
| `sunsynk-power-flow-card-3d.js`               | always (tiny entry)                       |
| `sunsynk-power-flow-card-3d-core-<hash>.js`   | always (the card)                         |
| `sunsynk-power-flow-card-3d-scene-<hash>.js`  | only when the 3D view is shown (Three.js) |
| `sunsynk-power-flow-card-3d-editor-<hash>.js` | only in the visual editor                 |

## Manual install (recommended)

1. Copy every `.js` file from `dist/` to `/config/www/sunsynk-power-flow-card-3d/`
   on the Home Assistant host (Samba, SSH or the File editor add-on).
2. Settings → Dashboards → ⋮ → Resources → **Add resource**:
   - URL: `/local/sunsynk-power-flow-card-3d/sunsynk-power-flow-card-3d.js?v=7.3.3-3d.5`
   - Resource type: JavaScript module
3. Reload the browser (or clear the HA app's frontend cache).
4. Add a card (Manual) and paste your configuration with
   `type: custom:sunsynk-power-flow-card-3d` and `view_mode: 3d`. Your existing
   Sunsynk card YAML works as-is apart from the `type`; see
   [example-lovelace.yaml](example-lovelace.yaml).
5. In a sections dashboard the card spans the full width by default
   (`grid_options: columns: full`).

**Updating:** delete the old files in that folder, copy the new ones, and bump
`?v=` in the resource URL. Chunk names contain a content hash, so only the entry
needs the version parameter.

**Rolling back:** change the card's `type` back to
`custom:sunsynk-power-flow-card` — the configuration is compatible — or remove the
resource.

The `sunsynk-card-extras.js` resource only patches the upstream element; the fork
supports its `palette` and `inverter_image` keys natively.

## HACS custom repository (optional)

HACS installs from the default branch or from releases. To use HACS, publish a
release of the fork (or make the 3D branch the fork's default branch), then add
the repository as a custom repository of type _Dashboard_. `hacs.json` already
points at `sunsynk-power-flow-card-3d.js`; HACS must download the whole `dist`
folder (all chunks), which it does for the dist directory and release zips.

## Building from source

```bash
npm install --legacy-peer-deps
npm run build          # dist/
npm test               # unit tests (data adapter)
npm run demo           # http://localhost:5173/demo/ with simulated states
npm run test:e2e       # browser checks against the demo (headless Chrome)
```

`npm install` needs `--legacy-peer-deps` because upstream's ESLint 10 and
`@rollup/plugin-eslint` peer ranges don't overlap.

## Testing against a throwaway Home Assistant

`test/ha/` creates a local Home Assistant Core instance (Python venv, no Docker)
with template entities that use the real Solis entity ids and a scenario selector:

```bash
uv venv --python 3.14 ../ha-test/.venv
uv pip install --python ../ha-test/.venv/bin/python homeassistant==2026.10.2
../ha-test/.venv/bin/python test/ha/generate_config.py ../ha-test/config
../ha-test/.venv/bin/hass --script auth -c ../ha-test/config add sunsynk_test <password>
../ha-test/.venv/bin/hass -c ../ha-test/config        # http://127.0.0.1:8124 (localhost only)
node test/ha/run-ha-check.mjs http://127.0.0.1:8124
```

Log in once through `/auth/login_flow` (or the login page) so the user is
created; afterwards the trusted-network provider logs in from 127.0.0.1 without a
password. The generated HTTP config binds to 127.0.0.1 only.
