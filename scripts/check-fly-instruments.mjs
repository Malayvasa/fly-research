const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 if (process.env.FLY_TEST_PORT) await page.addInitScript(port => {
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
   constructor(url, protocols) {super(String(url).replace(':8765', `:${port}`), protocols);}
  };
 }, process.env.FLY_TEST_PORT);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:5173/?opponent=fly&readout=trained');
 await page.waitForFunction(()=>window.__raceDebug?.phase==='ready');
 await page.locator('[data-action="start"]').click();
 await page.waitForFunction(()=>window.__raceDebug?.fly.frames>40,{}, {timeout:30000});
 const transforms=new Set();
 for(let i=0;i<10;i++) {transforms.add(await page.locator('.fly-wheel').getAttribute('style'));await page.waitForTimeout(200);}
 assert.ok(transforms.size>1,'steering instrument must move');
 assert.equal(await page.locator('.fly-controls').count(),0);
 const bounds=await page.evaluate(()=>{
  const eyes=document.querySelector('.fly-eyes').getBoundingClientRect();
  const controls=document.querySelector('.fly-instruments').getBoundingClientRect();
  const neurons=document.querySelector('.fly-neurons').getBoundingClientRect();
  return {eyesBottom:eyes.bottom,controlsTop:controls.top,controlsBottom:controls.bottom,neuronsTop:neurons.top};
 });
 assert.ok(bounds.controlsTop>=bounds.eyesBottom && bounds.neuronsTop>=bounds.controlsBottom);
 await page.screenshot({path:'artifacts/fly-instruments-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
 assert.equal(await page.locator('.fly-instruments').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 await page.screenshot({path:'artifacts/fly-instruments-mobile.png'});
 await page.locator('[aria-label="Opponent controller"]').selectOption('practice');
 assert.equal(await page.locator('.fly-throttle').getAttribute('aria-valuenow'),'0');
 assert.equal(await page.locator('.fly-wheel').getAttribute('aria-label'),'Steering centered');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,steeringStates:transforms.size,bounds,errors}));
} finally {await browser.close();}
