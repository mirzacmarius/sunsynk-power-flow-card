/**
 * End-to-end checks of the card in a real browser (headless Chrome with GPU WebGL),
 * against the demo page's simulated Home Assistant states.
 *
 *   npm run build && npm run test:e2e
 *
 * CHROME_PATH can point at any Chrome/Chromium; by default the Playwright cache or a
 * system Chrome is used. Screenshots go to test/e2e/screenshots/.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const shots = join(root, 'test/e2e/screenshots');
mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 5174);
const BASE = `http://localhost:${PORT}/demo/`;

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
  const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return existsSync(sys) ? sys : undefined;
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
}

const server = spawn(process.execPath, [join(root, 'scripts/serve-demo.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: [
    '--enable-gpu',
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader',
  ],
});

async function open(query = '', viewport = { width: 1440, height: 900 }, init) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/favicon|404/.test(m.text()) &&
      errors.push(m.text()),
  );
  if (init) await page.addInitScript(init);
  await page.goto(`${BASE}?jitter=0&${query}`);
  await page.waitForFunction(
    () => {
      const card = document.querySelector('sunsynk-power-flow-card-3d');
      const view = card?.shadowRoot?.querySelector('sunsynk-3d-view');
      return (
        (view && view.debugInfo?.().stats) ||
        card?.shadowRoot?.querySelector('svg')
      );
    },
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(1200);
  return { page, errors };
}

/** Visible 3D labels that overlap a toolbar group, a preset chip or the legend. */
const labelClashes = (page) =>
  page.evaluate(() => {
    const root = document
      .querySelector('sunsynk-power-flow-card-3d')
      .shadowRoot.querySelector('sunsynk-3d-view').shadowRoot;
    const stage = root.querySelector('.stage').getBoundingClientRect();
    const rects = (sel) =>
      [...root.querySelectorAll(sel)]
        .map((e) => [e, e.getBoundingClientRect()])
        .filter(
          ([, r]) =>
            r.width > 0 &&
            r.right > stage.left &&
            r.left < stage.right &&
            r.bottom > stage.top &&
            r.top < stage.bottom,
        );
    const overlays = rects('.toolbar .group, .presets .chip, .legend');
    const out = [];
    for (const [l, a] of rects('.labels .label'))
      for (const [o, b] of overlays)
        if (
          a.left < b.right - 1 &&
          a.right > b.left + 1 &&
          a.top < b.bottom - 1 &&
          a.bottom > b.top + 1
        )
          out.push(`${l.dataset.id} × ${o.className}`);
    return out;
  });

const info = (page) =>
  page.evaluate(() =>
    document
      .querySelector('sunsynk-power-flow-card-3d')
      .shadowRoot.querySelector('sunsynk-3d-view')
      ?.debugInfo(),
  );
const flow = (i, id) => i.flows.find((f) => f.id === id);
const viewText = (page) =>
  page.evaluate(
    () =>
      document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view')?.shadowRoot?.textContent ??
      '',
  );
const shot = (page, name) =>
  page.screenshot({ path: join(shots, `${name}.png`) });
async function clickIn3d(page, selector, text) {
  return page.evaluate(
    ([sel, txt]) => {
      const root = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view').shadowRoot;
      const el = [...root.querySelectorAll(sel)].find(
        (e) => !txt || e.textContent.includes(txt),
      );
      el?.click();
      return !!el;
    },
    [selector, text],
  );
}

try {
  // 1. Sunny day: directions and activity of every flow
  {
    const { page, errors } = await open('scenario=sunny_export');
    const i = await info(page);
    check(
      '3D view renders with WebGL',
      i?.stats?.calls > 50,
      `${i?.stats?.calls} draw calls, quality ${i?.quality}`,
    );
    check(
      'MPPT flows active towards the inverter',
      ['mppt1', 'mppt2', 'mppt3', 'mppt4'].every(
        (id) => flow(i, id)?.active && flow(i, id)?.direction === 1,
      ),
    );
    check(
      'battery charging flows inverter → battery',
      flow(i, 'battery').active && flow(i, 'battery').direction === -1,
    );
    check(
      'grid export flows inverter → grid',
      flow(i, 'grid').active && flow(i, 'grid').direction === -1,
    );
    check(
      'home flow active at 1.2 kW',
      flow(i, 'home').active && flow(i, 'home').powerW === 1200,
    );
    await shot(page, '01-overview-day');
    check('no console errors (sunny)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  // 2. Evening: discharge, small import, night mode from sun.sun
  {
    const { page } = await open('scenario=evening_discharge');
    const i = await info(page);
    check(
      'battery discharging flows battery → inverter',
      flow(i, 'battery').active && flow(i, 'battery').direction === 1,
    );
    check(
      'small grid import is shown as import',
      flow(i, 'grid').active &&
        flow(i, 'grid').direction === 1 &&
        flow(i, 'grid').powerW === 40,
    );
    const night = await page.evaluate(
      () =>
        document
          .querySelector('sunsynk-power-flow-card-3d')
          .shadowRoot.querySelector('sunsynk-3d-view').manager.env.isNight,
    );
    check('night mode follows sun.sun below the horizon', night);
    await page.waitForTimeout(1500);
    await shot(page, '02-evening-night');
    await page.close();
  }
  // 3. Grid outage vs zero exchange
  {
    const { page } = await open('scenario=grid_outage');
    const i = await info(page);
    const text = await viewText(page);
    check('grid outage: no grid flow animation', !flow(i, 'grid').active);
    check('grid outage shown as Disconnected', text.includes('Disconnected'));
    await shot(page, '03-grid-outage');
    await page.close();
  }
  // 4. String fault + solar preset with overlay
  {
    const { page } = await open('scenario=string_fault');
    await clickIn3d(page, '.chip', 'Solar');
    await page.waitForTimeout(1500);
    const text = await viewText(page);
    check('string without voltage flagged', text.includes('No voltage'));
    check(
      'weak string flagged as underperforming',
      text.includes('Underperforming'),
    );
    const i = await info(page);
    check(
      'solar preset turns the overlay on',
      i.scene.overlay === true && i.preset === 'solar',
    );
    await shot(page, '04-solar-string-fault');
    await page.close();
  }
  // 5. Unavailable / missing sensors
  {
    const { page, errors } = await open('scenario=unavailable');
    const i = await info(page);
    const text = await viewText(page);
    check(
      'unavailable battery direction → no battery animation',
      !flow(i, 'battery').active,
    );
    check(
      'missing entities reported as configuration notes',
      i.issues.includes('missing_entity'),
    );
    check('unavailable values render as —', text.includes('—'));
    check(
      'no console errors (unavailable)',
      errors.length === 0,
      errors.join(' | '),
    );
    await shot(page, '05-unavailable');
    await page.close();
  }
  // 6. Inverter alarm
  {
    const { page } = await open('scenario=inverter_alarm');
    const text = await viewText(page);
    check('inverter alarm status shown', text.includes('Alarm'));
    await page.close();
  }
  // 7. Presets, floors, exploded view, selection and device control
  {
    const { page, errors } = await open('scenario=evening_discharge');
    await clickIn3d(page, '.chip', 'Room consumption');
    await page.waitForTimeout(1600);
    let i = await info(page);
    check(
      'room preset explodes floors and shows device branches',
      i.scene.exploded && i.scene.deviceFlows && i.scene.heat,
    );
    await shot(page, '06-rooms-exploded');
    await clickIn3d(page, '.chip', 'Battery');
    await page.waitForTimeout(1600);
    await shot(page, '07-battery-inverter');
    await clickIn3d(page, '.chip', 'Night mode');
    await page.waitForTimeout(1800);
    await shot(page, '08-night-preset');
    await clickIn3d(page, '.chip', 'Energy overview');
    await page.waitForTimeout(800);
    await clickIn3d(page, '.tool', 'Ground');
    await page.waitForTimeout(800);
    i = await info(page);
    check('ground floor selection', i.scene.floor === 'ground');
    const firstVisible = await page.evaluate(() => {
      const m = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view').manager;
      let ghosted = 0;
      m.house.groups.first.traverse(
        (o) => o.userData.origMaterial && ghosted++,
      );
      return { visible: m.house.groups.first.visible, ghosted };
    });
    check(
      'upper floor becomes semi-transparent',
      firstVisible.visible && firstVisible.ghosted > 0,
      JSON.stringify(firstVisible),
    );
    await shot(page, '09-ground-floor');
    await page.evaluate(() =>
      document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view')
        .debugSelect('device:living_daikin_parter'),
    );
    await page.waitForTimeout(1200);
    let text = await viewText(page);
    check(
      'device detail panel opens',
      text.includes('Daikin Parter') && text.includes('Toggle'),
    );
    await clickIn3d(page, '.btn.primary', 'Toggle');
    await page.waitForTimeout(200);
    text = await viewText(page);
    check('control asks for confirmation first', text.includes('Confirm'));
    const before = await page.evaluate(() => window.mock.serviceLog.length);
    await clickIn3d(page, '.btn.primary', 'Toggle');
    await page.waitForTimeout(300);
    const log = await page.evaluate(() => window.mock.serviceLog);
    check(
      'confirmed control calls switch.toggle',
      log.length === before + 1 &&
        log.at(-1).domain === 'switch' &&
        log.at(-1).service === 'toggle' &&
        log.at(-1).data.entity_id === 'switch.daikin_parter_power',
    );
    await page.evaluate(() =>
      document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view')
        .debugSelect('device:matrimonial_tv'),
    );
    await page.waitForTimeout(600);
    text = await viewText(page);
    check(
      'no control offered without explicit config',
      text.includes('TV') && !text.includes('Toggle'),
    );
    await shot(page, '10-device-detail');
    check(
      'no console errors (interactions)',
      errors.length === 0,
      errors.join(' | '),
    );
    await page.close();
  }
  // 8. Classic ↔ 3D switching without reload, and GPU cleanup
  {
    const { page, errors } = await open('scenario=sunny_export');
    await clickIn3d(page, '.tool', 'Switch to the classic card');
    await page.waitForTimeout(800);
    const classic = await page.evaluate(() => {
      const r = document.querySelector('sunsynk-power-flow-card-3d').shadowRoot;
      return {
        svg: !!r.querySelector('svg'),
        toggle: !!r.querySelector('.s3d-toggle'),
        view: !!r.querySelector('sunsynk-3d-view'),
      };
    });
    check(
      'toolbar switches to the classic card in place',
      classic.svg && classic.toggle && !classic.view,
      JSON.stringify(classic),
    );
    await shot(page, '11-classic-from-3d');
    await page.evaluate(() =>
      document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('.s3d-toggle')
        .click(),
    );
    await page.waitForTimeout(1500);
    const back = await info(page);
    check('3D button switches back without reload', back?.stats?.calls > 50);
    // repeated config switches must not leak contexts or throw
    for (let k = 0; k < 6; k++) {
      await page.selectOption('#view', k % 2 ? '3d' : 'classic');
      await page.waitForTimeout(500);
    }
    const canvases = await page.evaluate(() => {
      const v = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view');
      return v ? v.shadowRoot.querySelectorAll('canvas').length : -1;
    });
    check(
      'one canvas after repeated switching',
      canvases === 1,
      `canvases: ${canvases}`,
    );
    check(
      'no console errors (switching)',
      errors.length === 0,
      errors.join(' | '),
    );
    await page.close();
  }
  // 9. Classic-only configs stay untouched and never load Three.js
  {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(`${BASE}?jitter=0&view=classic`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const c = structuredClone(window.card._config);
      delete c.view_mode;
      window.card.setConfig(c);
    });
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => {
      const r = document.querySelector('sunsynk-power-flow-card-3d').shadowRoot;
      return {
        svg: !!r.querySelector('svg'),
        toggle: !!r.querySelector('.s3d-toggle'),
      };
    });
    check(
      'classic config renders the original card without a 3D button',
      st.svg && !st.toggle,
    );
    check(
      'classic config does not download the 3D chunk',
      !requests.some((u) => u.includes('-scene-')),
    );
    await page.close();
  }
  // 10. WebGL unavailable → classic fallback with a notice
  {
    const { page } = await open('scenario=sunny_export', undefined, () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return /webgl/.test(type) ? null : orig.call(this, type, ...rest);
      };
    });
    const st = await page.evaluate(() => {
      const r = document.querySelector('sunsynk-power-flow-card-3d').shadowRoot;
      return {
        svg: !!r.querySelector('svg'),
        notice: r.querySelector('.s3d-notice')?.textContent ?? '',
      };
    });
    check(
      'no WebGL → classic card with a notice',
      st.svg && /WebGL/.test(st.notice),
      st.notice,
    );
    await page.close();
  }
  // 11. Themes, language and responsive layouts
  {
    const { page } = await open('scenario=sunny_export&theme=light&lang=ro');
    const text = await viewText(page);
    check(
      'Romanian UI strings',
      text.includes('Solar acum') && text.includes('Baterie'),
    );
    await shot(page, '12-light-ro');
    await page.close();
    const m = await open('scenario=evening_discharge&width=390', {
      width: 390,
      height: 844,
    });
    const overflow = await m.page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(
      'phone layout has no horizontal overflow',
      overflow <= 1,
      `overflow ${overflow}px`,
    );
    check(
      'phone: 3D labels stay clear of the toolbar and preset chips',
      (await labelClashes(m.page)).length === 0,
      (await labelClashes(m.page)).join(', '),
    );
    await shot(m.page, '13-phone');
    await m.page.close();
    // summary tiles fit the longest values ("Disconnected" / "Deconectată") at every width
    for (const lang of ['en', 'ro']) {
      const f = await open(`scenario=grid_outage&lang=${lang}`, {
        width: 1800,
        height: 1000,
      });
      const cut = [];
      for (const w of [
        1700, 1600, 1500, 1310, 1100, 900, 820, 700, 600, 521, 390,
      ]) {
        cut.push(
          ...(await f.page.evaluate(async (w) => {
            document.getElementById('frame').style.maxWidth = `${w}px`;
            await new Promise((r) => setTimeout(r, 600)); // the demo animates max-width
            const root = document
              .querySelector('sunsynk-power-flow-card-3d')
              .shadowRoot.querySelector('sunsynk-3d-view').shadowRoot;
            return [...root.querySelectorAll('.kpi .lbl, .kpi .val')]
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => `${w}px "${el.textContent.trim()}"`);
          }, w)),
        );
      }
      check(
        `summary tile text fits at every width (${lang})`,
        cut.length === 0,
        cut.join(', '),
      );
      await f.page.close();
    }
    const tb = await open('scenario=sunny_export&width=820', {
      width: 820,
      height: 1180,
    });
    check(
      'tablet: 3D labels stay clear of the toolbar and preset chips',
      (await labelClashes(tb.page)).length === 0,
      (await labelClashes(tb.page)).join(', '),
    );
    await shot(tb.page, '14-tablet');
    await tb.page.close();
  }
  // 12. Hover tooltip, offscreen pause, disposal, custom model, light entities, classic palette
  {
    const { page, errors } = await open('scenario=sunny_export');
    const pt = await page.evaluate(() => {
      const view = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view');
      const m = view.manager;
      const a = m.anchors.get('inverter');
      const v = a.obj.localToWorld(a.local.clone());
      v.y -= 0.6;
      v.project(m.camera);
      const r = m.renderer.domElement.getBoundingClientRect();
      return {
        x: r.left + ((v.x + 1) / 2) * r.width,
        y: r.top + ((1 - v.y) / 2) * r.height,
      };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(600);
    const tip = await page.evaluate(
      () =>
        document
          .querySelector('sunsynk-power-flow-card-3d')
          .shadowRoot.querySelector('sunsynk-3d-view')
          .shadowRoot.querySelector('.tooltip')?.textContent ?? '',
    );
    check(
      'hover tooltip shows live inverter values',
      /S6-EH3P20K-H/.test(tip) && /W/.test(tip),
      tip.replace(/\s+/g, ' ').trim().slice(0, 80),
    );
    await page.evaluate(() => {
      document.body.style.paddingBottom = '3000px';
      window.scrollTo(0, 2600);
    });
    await page.waitForTimeout(800);
    const paused = await page.evaluate(
      () =>
        document
          .querySelector('sunsynk-power-flow-card-3d')
          .shadowRoot.querySelector('sunsynk-3d-view').manager.running,
    );
    check('render loop pauses when the card is off-screen', paused === false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    const disposed = await page.evaluate(async () => {
      const card = document.querySelector('sunsynk-power-flow-card-3d');
      const view = card.shadowRoot.querySelector('sunsynk-3d-view');
      const m = view.manager;
      const gl = m.renderer.getContext();
      view.shadowRoot
        .querySelector('.tool[title="Switch to the classic card"]')
        .click();
      await new Promise((r) => setTimeout(r, 600));
      return {
        disposed: m.disposed,
        running: m.running,
        lost: gl.isContextLost(),
        canvas: m.renderer.domElement.isConnected,
      };
    });
    check(
      'leaving 3D disposes renderer, loop and canvas',
      disposed.disposed &&
        !disposed.running &&
        disposed.lost &&
        !disposed.canvas,
      JSON.stringify(disposed),
    );
    const classic = await page.evaluate(() => {
      const svg = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('svg');
      return svg ? svg.innerHTML.includes('#FFA500') : false;
    });
    check('classic view applies the dark palette colours', classic);
    await page.evaluate(() =>
      document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('.s3d-toggle')
        .click(),
    );
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const c = structuredClone(window.card._config);
      c.three_d = {
        ...c.three_d,
        model: {
          url: '/demo/assets/test-model.gltf',
          position: [-2.05, 0, 7.4],
        },
      };
      window.card.setConfig(c);
    });
    await page.waitForTimeout(2500);
    const model = await page.evaluate(() => {
      const m = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view').manager;
      return {
        loaded: !!m.customModel,
        procedural: m.house.groups.groundArch.visible,
      };
    });
    check(
      'GLB/glTF model loads and replaces the procedural house',
      model.loaded && !model.procedural,
      JSON.stringify(model),
    );
    await shot(page, '15-custom-model');
    check(
      'no console errors (lifecycle)',
      errors.length === 0,
      errors.join(' | '),
    );
    await page.close();
  }
  {
    const { page } = await open('scenario=evening_discharge');
    const lit = () =>
      page.evaluate(
        () =>
          document
            .querySelector('sunsynk-power-flow-card-3d')
            .shadowRoot.querySelector('sunsynk-3d-view').manager.house.washes
            .upperLoggia.material.opacity,
      );
    await page.waitForTimeout(1500);
    const on = await lit();
    await page.evaluate(() => {
      const s = window.mock.states['light.lumini_balcoane'];
      window.mock.overrides['light.lumini_balcoane'] = { ...s, state: 'off' };
      window.mock.refresh();
    });
    await page.waitForTimeout(1500);
    const off = await lit();
    check(
      'loggia wash follows light.lumini_balcoane',
      on > 0.3 && off < 0.05,
      `on ${on.toFixed(2)} / off ${off.toFixed(2)}`,
    );
    await page.evaluate(() => {
      const s = window.mock.states['light.lumini_matrimonial'];
      window.mock.overrides['light.lumini_matrimonial'] = { ...s, state: 'on' };
      window.mock.refresh();
    });
    await page.waitForTimeout(1500);
    const room = await page.evaluate(() => {
      const r = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view')
        .manager.rooms.rooms.get('matrimonial');
      return { level: r.lightLevel, light: r.light ? r.light.intensity : null };
    });
    check(
      'room lighting follows its light entity',
      room.level > 0.5,
      JSON.stringify(room),
    );
    await page.close();
  }
  // card-mod walks up the DOM preferring `.host` (ShadowRoot.host); that walk must terminate
  {
    const { page } = await open('scenario=sunny_export');
    const steps = await page.evaluate(() => {
      const view = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view');
      let n =
        view.shadowRoot.querySelector('.canvas-host canvas') ??
        view.shadowRoot.querySelector('.label');
      let i = 0;
      while (n && n !== document && i < 1000) {
        n = n.host || n.parentNode;
        i++;
      }
      return i;
    });
    check(
      'DOM walk through the card terminates (card-mod compatibility)',
      steps < 1000,
      `${steps} steps`,
    );
    await page.close();
  }
  // 13. Reduced motion: no particles moving
  {
    const { page } = await open('scenario=sunny_export&motion=true');
    const moving = await page.evaluate(() => {
      const m = document
        .querySelector('sunsynk-power-flow-card-3d')
        .shadowRoot.querySelector('sunsynk-3d-view').manager;
      let n = 0;
      m.flows.group.traverse(
        (o) =>
          o.isPoints &&
          (n +=
            o.geometry.drawRange.count === Infinity
              ? 0
              : o.geometry.drawRange.count),
      );
      return n;
    });
    check(
      'reduced motion stops particles',
      moving === 0,
      `particles ${moving}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
process.exit(failed.length ? 1 : 0);
