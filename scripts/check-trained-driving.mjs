const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {mkdir, writeFile} from 'node:fs/promises';

const output = `artifacts/driving-check-${Date.now()}`;
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const samples = [], errors = [];
let metadata = null;
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  if (process.env.FLY_TEST_PORT) await page.addInitScript(port => {
    const NativeSocket = window.WebSocket;
    window.__flyTrainingFrames = [];
    window.WebSocket = class extends NativeSocket {
      constructor(url, protocols) {super(String(url).replace(':8765', `:${port}`), protocols);}
      send(payload) {
        if (ArrayBuffer.isView(payload) && payload.byteLength === 294916) {
          const state = window.__raceDebug;
          const car = state?.cars[0];
          if (car) window.__flyTrainingFrames.push({
            frameId: new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true),
            time: state.time, position: {...car.position}, yaw: car.yaw, speed: car.speed,
          });
        }
        return super.send(payload);
      }
    };
  }, process.env.FLY_TEST_PORT);
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:5173/?opponent=fly&readout=trained&flySeed=${encodeURIComponent(process.env.FLY_TEST_SEED || '64')}`);
  await page.waitForFunction(() => window.__raceDebug?.phase === 'ready');
  await page.locator('[data-action="start"]').click();
  await page.waitForFunction(() => window.__raceDebug?.fly.frames > 5, {}, {timeout: 30000});
  for (let i = 0; i < 1800; i++) {
    const sample = await page.evaluate(() => window.__raceDebug);
    samples.push(sample);
    if (sample.fly.metadata) metadata = sample.fly.metadata;
    if (i % 80 === 0) {
      await page.screenshot({path: `${output}/progress-${i}.png`});
      console.log(JSON.stringify({time: sample.time, car: sample.cars[0]}));
    }
    if (sample.cars[0].progress.lapTimes.length >= 3 || sample.cars[0].resets > 0) break;
    await page.waitForTimeout(250);
  }
  const car = samples.at(-1).cars[0];
  const passed = car.progress.lapTimes.length >= 3 && car.resets === 0 && errors.length === 0;
  await page.screenshot({path: `${output}/final.png`});
  await writeFile(`${output}/results.json`, JSON.stringify({passed, errors, samples}, null, 2));
  await writeFile(`${output}/camera-poses.json`, JSON.stringify({
    metadata,
    frames: await page.evaluate(() => window.__flyTrainingFrames ?? []),
  }));
  console.log(JSON.stringify({passed, output, car}));
  process.exitCode = passed ? 0 : 1;
} finally {
  await browser.close();
}
