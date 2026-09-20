import {applyLearnedSpeed} from './fly-speed';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {circuit,TRACK_LENGTH} from './track';
import {drawTrainingMap,trackMap} from './training-map';
const {buildWorld,scene,prototypes}=await import(circuit ? './training-world' : './world');
import {createPhysicsWorld} from './training-physics';
import {Kart,emptyInput} from './vehicle';
import {FlyClient} from './fly-client';
import {FlyVision} from './fly-vision';
import {trackBorder,gates} from './track';
import {advanceProgress} from './race';
const attempt = Date.now();
const params=new URLSearchParams(location.search);
const singleSeed = params.get('seed');
const batch=params.get('batch');
const round = batch || (params.get('round') === 'recovery' ? 'recovery' : 'initial');
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#start')!;
await Promise.all([RAPIER.init(),buildWorld((text:string)=>status.textContent=text)]);
const world=createPhysicsWorld();const kart=new Kart(world,prototypes.get('cars/race')!,2.7);scene.add(kart.visual);
const human=new Kart(world,prototypes.get('cars/hatchback-sports')!,-2.7);scene.add(human.visual);
const mats=[0xf1ecd8,0x829276].map(color=>new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));
for(const side of [-1,1]){const rail=new THREE.Mesh(trackBorder(side*10.1,.25,0,.5,960,12),mats);rail.castShadow=rail.receiveShadow=true;scene.add(rail);}
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(1,1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const camera=new THREE.PerspectiveCamera(60,1,.1,600);camera.position.set(0,10,0);
const canvas=document.querySelector<HTMLCanvasElement>('#view')!;const vision=new FlyVision();renderer.render(scene,camera);renderer.shadowMap.autoUpdate=false;drawTrainingMap(canvas,{...kart.body.translation(),yaw:kart.yaw});
status.textContent='Ready: learned steering and speed; 90 km/h ceiling; no automatic recovery.';button.disabled=false;
async function evaluate(seed:number,requiredLaps=3){
 kart.reset(true);human.reset(true);let time=0,accumulator=0,previous=performance.now(),lastCapture=-1000,lastSample=0,lastSave=0,staleFrames=0;
 const samples:Record<string,unknown>[]=[];let lastInput=emptyInput(),brakingSteps=0,physicsSteps=0,countdown=3.5;
 const client=new FlyClient({url:batch?.startsWith('meadow90-d')?'ws://127.0.0.1:18773':batch?.startsWith('meadow90-c')?'ws://127.0.0.1:18772':batch?'ws://127.0.0.1:18771':'ws://127.0.0.1:18770',seed,controller:{readout:'combined',steeringDeadzone:0,smoothingSeconds:.05}});
 client.connect();let lastProgress=0,passed=0;
 const start=performance.now();
 const report=(state:string)=>({environmentVersion:'shared-physics-sensor-shadows-v2',unseen:circuit?.id==='imola',requiredLaps,track:circuit?.id ?? 'meadow',map:trackMap,gateCount:gates.length,final:{time,brakingSteps,physicsSteps,resets:kart.resets,passed:kart.progress.passed,lapTimes:[...kart.progress.lapTimes]},id:`${round}-${circuit?.id ?? "meadow"}-${seed}-${requiredLaps}lap-${attempt}`,name:`${circuit?.name ?? "Meadow"} · seed ${seed} · ${requiredLaps} lap test${circuit?.id === "imola" ? " · unseen" : ""}`,kind:'Learned steering + speed · full connectome',status:state,samples,metadata:client.metadata});
 return await new Promise<boolean>((resolve,reject)=>{
  function frame(stamp:number){
   const dt=Math.min((stamp-previous)/1000,.05);previous=stamp;
   if(!client.metadata&&client.status==='offline'&&stamp-lastCapture>1000){lastCapture=stamp;client.connect();}
   if(client.metadata)accumulator+=dt;
   if(client.status!=='ready')staleFrames++;
   while(accumulator>=1/60){
    accumulator-=1/60;const active=countdown<=0;if(active)time+=1/60;else countdown-=1/60;
    const input=applyLearnedSpeed(client.input(1/60,active),client.targetSpeed,kart.speed,active&&client.status==='ready');
    lastInput=input;physicsSteps++;if(input.brake>.05)brakingSteps++;
    kart.step(1/60,input,active&&client.status==='ready');human.step(1/60,emptyInput(),false);world.step();
    const p=kart.body.translation();if(active)advanceProgress(kart.progress,{x:p.x,z:p.z},gates,time,requiredLaps);
   }
   kart.render(dt,1);human.render(dt,1);if(stamp-lastCapture>=100)drawTrainingMap(canvas,{...kart.body.translation(),yaw:kart.yaw});
   if(stamp-lastCapture>=100&&['ready','stale'].includes(client.status)){
    lastCapture=stamp;client.sendFrame(vision.capture(renderer,scene,new THREE.Vector3().copy(kart.body.translation()),kart.yaw,kart.visual),performance.now());
   }
   if(time-lastSample>=.2){lastSample=time;const p=kart.body.translation();samples.push({steering:lastInput.steering,throttle:lastInput.throttle,brake:lastInput.brake,x:p.x,z:p.z,yaw:kart.yaw,speed:kart.speed,time,resets:kart.resets,distance:kart.distance,u:kart.nearU,passed:kart.progress.passed,lapTimes:[...kart.progress.lapTimes],targetSpeed:client.targetSpeed,status:client.status,staleFrames});}
   if(kart.progress.passed>passed){passed=kart.progress.passed;lastProgress=time;}
   status.textContent=`Seed ${seed} · ${(kart.speed*3.6).toFixed(1)} km/h · lap ${kart.progress.lapTimes.length+1}/${requiredLaps} · ${client.status} · brake ${(lastInput.brake*100).toFixed(0)}% · target ${((client.targetSpeed??0)*3.6).toFixed(0)} km/h · offset ${kart.distance.toFixed(1)} m`;
   if(time-lastSave>2){lastSave=time;void fetch('/training-result',{method:'POST',body:JSON.stringify(report('running'))});}
   const complete=kart.progress.lapTimes.length>=requiredLaps;
   const fail=kart.resets>0||time-lastProgress>45||time>Math.max(240,TRACK_LENGTH/8*3)||performance.now()-start>Math.max(360000,TRACK_LENGTH/8*3*2000);
   if(complete||fail){const result=report(complete?'passed':'failed');void fetch('/training-result',{method:'POST',body:JSON.stringify(result)}).then(response=>{if(!response.ok)throw Error('Could not save evaluation');client.close();resolve(complete);}).catch(error=>{client.close();reject(error);});return;}
   requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
 });
}
button.onclick=async()=>{button.disabled=true;try{
 if(batch?.startsWith('meadow90-')){
  const first=await evaluate(64,1);await new Promise(resolve=>setTimeout(resolve,1000));
  const second=await evaluate(65,1);
  if(first&&second){await new Promise(resolve=>setTimeout(resolve,1000));await evaluate(64,3);await new Promise(resolve=>setTimeout(resolve,1000));await evaluate(65,3);}
 }else if(singleSeed==='64'||singleSeed==='65')await evaluate(Number(singleSeed));
 else{await evaluate(64);await new Promise(resolve=>setTimeout(resolve,1000));await evaluate(65);}
 status.textContent='Evaluation finished. Failed screening candidates skip longer tests. See run comparison for results.';parent.postMessage({type:'evaluation-complete',track:circuit?.id},location.origin);
}catch(error){status.textContent=String(error);parent.postMessage({type:'evaluation-error',error:String(error)},location.origin);}};
if(params.has('autostart'))button.click();
