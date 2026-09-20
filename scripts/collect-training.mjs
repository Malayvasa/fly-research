const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import {mkdir,writeFile,open,readFile} from 'node:fs/promises';
const output = process.env.TRAINING_DIR || 'artifacts/training';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const file=await open(`${output}/frames.rgb`,'w');
const labels=[];
const replay = process.env.TRAINING_REPLAY ? JSON.parse(await readFile(process.env.TRAINING_REPLAY,'utf8')).samples
 .map(s=>s.cars[0]).filter(car=>car.nearU>.48&&car.nearU<.73&&car.speed>1) : null;
if (replay && replay.length===0) throw new Error('Replay contains no moving S-bend states');
try {
 const page=await browser.newPage({viewport:{width:960,height:600}});
 await page.goto('http://127.0.0.1:5174/');await page.waitForFunction(()=>window.__raceDebug?.phase==='ready');
 await page.evaluate(async()=>{
  window.requestAnimationFrame=()=>0;
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {scene}=await import('/src/world.ts');const track=await import('/src/track.ts');
  const {FlyVision}=await import('/src/fly-vision.ts');
  const r=new THREE.WebGLRenderer();r.setSize(128,128);r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=.95;
  r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
  const vision=new FlyVision();const hidden=new THREE.Group();
  // Hide both starting-grid vehicles; training covers the full static circuit.
  for(const o of scene.children)if(o.isGroup&&o.position.y>.3&&o.position.y<2)o.visible=false;
  // FlyVision reuses the shadow map, just as it does after a live world render.
  const prepass=new THREE.PerspectiveCamera(60,1,.1,600);
  prepass.position.set(0,20,100);prepass.lookAt(0,0,0);r.render(scene,prepass);
  const capture=(position,yaw,label)=>{
   const u=track.nearest(position.x,position.z).u;
   const look=track.point(u+12/track.TRACK_LENGTH);
   const desired=Math.atan2(look.x-position.x,look.z-position.z);
   const error=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));
   const rgb=vision.capture(r,scene,position,yaw,hidden);
   let bytes='';for(let start=0;start<rgb.length;start+=8192)bytes+=String.fromCharCode(...rgb.subarray(start,start+8192));
   return {label:{...label,u,steering:Math.max(-1,Math.min(1,-error*1.9))},pixels:btoa(bytes)};
  };
  window.captureExample=(u,offset,heading)=>{
   const p=track.pose(u,offset);p.position.y=.606;
   return capture(p.position,p.yaw+heading,{offset,heading});
  };
  window.captureReplay=(car,dx,dz,dyaw)=>{
   const position=new THREE.Vector3(car.position.x+dx,car.position.y,car.position.z+dz);
   return capture(position,car.yaw+dyaw,{replay:true,x:position.x,z:position.z,yaw:car.yaw+dyaw});
  };
 });
 let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<1800;i++){
  const u=random(),offset=(random()*2-1)*6,heading=(random()*2-1)*.55;
  const result=replay ? await page.evaluate(([car,dx,dz,dh])=>window.captureReplay(car,dx,dz,dh),
   [replay[i%replay.length],(random()-.5)*1.2,(random()-.5)*1.2,(random()-.5)*.3]) :
   await page.evaluate(([u,o,h])=>window.captureExample(u,o,h),[u,offset,heading]);
  await file.write(Buffer.from(result.pixels,'base64'));labels.push(result.label);
  if(i%100===0){console.log(`captured ${i}/1800`);await writeFile(`${output}/labels.json`,JSON.stringify(labels));}
 }
 await writeFile(`${output}/labels.json`,JSON.stringify(labels));
}finally{await file.close();await browser.close();}
