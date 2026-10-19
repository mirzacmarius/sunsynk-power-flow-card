/**
 * Checks the card inside a real (throwaway) Home Assistant instance:
 * resource loading, card registration, live state updates through hass,
 * scenario changes, device control through a real service call, recorder
 * history over hass.callWS, the classic view and the visual editor.
 *
 *   node test/ha/run-ha-check.mjs [http://127.0.0.1:8124]
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HA = process.argv[2] ?? 'http://127.0.0.1:8124';
const shots = join(root, 'test/e2e/screenshots');
mkdirSync(shots, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()) {
      const app = join(
        cache,
        dir,
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      );
      if (existsSync(app)) return app;
    }
  }
  return undefined;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && /sunsynk|three|3d/i.test(m.text()))
    errors.push(m.text());
});

// helpers evaluated in the page: find the card through HA's nested shadow roots
const helpers = () => {
  window.__deep = (sel, rootNode = document) => {
    const stack = [rootNode];
    while (stack.length) {
      const n = stack.pop();
      const hit = n.querySelector?.(sel);
      if (hit) return hit;
      const all = n.querySelectorAll ? n.querySelectorAll('*') : [];
      for (const el of all) if (el.shadowRoot) stack.push(el.shadowRoot);
    }
    return null;
  };
  window.__card = () => window.__deep('sunsynk-power-flow-card-3d');
  window.__view = () =>
    window.__card()?.shadowRoot?.querySelector('sunsynk-3d-view');
  window.__hass = () => document.querySelector('home-assistant')?.hass;
};

try {
  await page.goto(`${HA}/lovelace/energy-3d`);
  await page.waitForFunction(
    () => !!document.querySelector('home-assistant')?.hass,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(helpers);
  await page.waitForFunction(
    () => window.__view?.()?.debugInfo?.().stats,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2500);

  const reg = await page.evaluate(() => ({
    defined: !!customElements.get('sunsynk-power-flow-card-3d'),
    picker: (window.customCards || []).some(
      (c) => c.type === 'sunsynk-power-flow-card-3d',
    ),
    version: window.__hass()?.config?.version,
  }));
  check(
    'card registered as a Lovelace custom card',
    reg.defined && reg.picker,
    `HA ${reg.version}`,
  );
  let info = await page.evaluate(() => window.__view().debugInfo());
  check(
    '3D view renders inside Home Assistant',
    info.stats.calls > 50,
    `${info.stats.calls} draw calls`,
  );
  const live = await page.evaluate(() => {
    const h = window.__hass();
    const text = window.__view().shadowRoot.textContent;
    return {
      home: h.states['sensor.consum_casa']?.state,
      solar: h.states['sensor.solis_s6_eh3p_total_pv_power']?.state,
      text,
    };
  });
  check(
    'HA template entities exist with the real entity ids',
    live.home !== undefined && live.solar !== undefined,
    `consum_casa=${live.home} W, pv=${live.solar} W`,
  );
  await page.screenshot({ path: join(shots, 'ha-01-dashboard.png') });

  const select = (option) =>
    page.evaluate(
      (o) =>
        window.__hass().callService('input_select', 'select_option', {
          entity_id: 'input_select.sim_scenario',
          option: o,
        }),
      option,
    );
  const flow = (i, id) => i.flows.find((f) => f.id === id);

  await select('grid_outage');
  await page.waitForTimeout(7000);
  info = await page.evaluate(() => window.__view().debugInfo());
  let text = await page.evaluate(() => window.__view().shadowRoot.textContent);
  check(
    'scenario change reaches the card through hass (grid outage)',
    !flow(info, 'grid').active && text.includes('Disconnected'),
  );
  await page.screenshot({ path: join(shots, 'ha-02-grid-outage.png') });

  await select('evening_discharge');
  await page.waitForTimeout(7000);
  info = await page.evaluate(() => window.__view().debugInfo());
  check(
    'battery discharge direction from the Solis direction sensor',
    flow(info, 'battery').active && flow(info, 'battery').direction === 1,
  );

  await select('unavailable');
  await page.waitForTimeout(7000);
  info = await page.evaluate(() => window.__view().debugInfo());
  text = await page.evaluate(() => window.__view().shadowRoot.textContent);
  check(
    'unavailable HA states are shown as unavailable, not 0',
    !flow(info, 'battery').active && text.includes('—'),
  );
  await select('sunny_export');
  await page.waitForTimeout(6000);

  // real service call through the card's explicit control
  const before = await page.evaluate(
    () => window.__hass().states['switch.daikin_parter_power'].state,
  );
  await page.evaluate(() =>
    window.__view().debugSelect('device:living_daikin_parter'),
  );
  await page.waitForTimeout(800);
  const clickToggle = () =>
    page.evaluate(() =>
      [...window.__view().shadowRoot.querySelectorAll('.btn.primary')]
        .find((b) => b.textContent.includes('Toggle'))
        ?.click(),
    );
  await clickToggle();
  await page.waitForTimeout(300);
  await clickToggle(); // confirm
  await page.waitForTimeout(2500);
  const after = await page.evaluate(
    () => window.__hass().states['switch.daikin_parter_power'].state,
  );
  check(
    'configured device control toggles the real switch',
    before !== after,
    `${before} → ${after}`,
  );
  await page.screenshot({ path: join(shots, 'ha-03-device-control.png') });
  await clickToggle();
  await page.waitForTimeout(300);
  await clickToggle();
  await page.waitForTimeout(1500);

  // recorder history over hass.callWS
  await page.evaluate(() => window.__view().loadHistory());
  await page.waitForTimeout(3000);
  const hist = await page.evaluate(() => {
    const h = window.__view().history;
    const count = (s) => (s ? s.v.filter((x) => x !== null).length : 0);
    return h
      ? {
          solar: count(h.solar),
          home: count(h.home),
          battery: count(h.battery),
          grid: count(h.grid),
        }
      : null;
  });
  check(
    'history comes from the HA recorder',
    hist && hist.home > 0 && hist.solar > 0,
    JSON.stringify(hist),
  );

  // visual editor loads in HA (ha-form is available there). It is mounted inside HA's
  // element tree, because HA's pickers get their translations from a context provider.
  const editor = await page.evaluate(async () => {
    const Card = customElements.get('sunsynk-power-flow-card-3d');
    const el = await Card.getConfigElement();
    el.hass = window.__hass();
    el.setConfig(window.__card()._config);
    document.querySelector('home-assistant').shadowRoot.appendChild(el);
    await new Promise((r) => setTimeout(r, 1500));
    const form = el.shadowRoot?.querySelector('ha-form');
    const ok =
      !!form && JSON.stringify(form.schema ?? []).includes('view_mode');
    el.remove();
    return ok;
  });
  check('visual editor renders with the view_mode option', editor);

  // classic view of the same config in HA
  await page.goto(`${HA}/lovelace/classic`);
  await page.waitForFunction(
    () => !!document.querySelector('home-assistant')?.hass,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(helpers);
  await page.waitForFunction(
    () => window.__card?.()?.shadowRoot?.querySelector('svg'),
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);
  const classic = await page.evaluate(() => ({
    svg: !!window.__card().shadowRoot.querySelector('svg'),
    view: !!window.__view(),
    toggle: !!window.__card().shadowRoot.querySelector('.s3d-toggle'),
  }));
  check(
    'classic view_mode renders the original card in HA',
    classic.svg && !classic.view && !classic.toggle,
  );
  await page.screenshot({ path: join(shots, 'ha-04-classic.png') });
  check(
    'no card errors in the browser console',
    errors.length === 0,
    errors.join(' | '),
  );
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} Home Assistant checks passed`,
);
process.exit(failed.length ? 1 : 0);
