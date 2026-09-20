import {correctionTeacher} from './training-teacher';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {circuit} from './track';
import {drawTrainingMap,trackMap} from './training-map';
const {buildWorld,scene,prototypes}=await import(circuit ? './training-world' : './world');
import {createPhysicsWorld} from './training-physics';
import {Kart,emptyInput} from './vehicle';
import {nearest, point, tangent, TRACK_LENGTH, trackBorder, pose} from './track';
import {FlyVision} from './fly-vision';
const status = document.querySelector('#status')!;
const button = document.querySelector<HTMLButtonElement>('#start')!;
await Promise.all([RAPIER.init(), buildWorld((text:string) => status.textContent = text)]);
const world = createPhysicsWorld();
const materials = [0xf1ecd8,0x829276].map(color=>new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}));
for(const side of [-1,1]){const rail=new THREE.Mesh(trackBorder(side*10.1,.25,0,.5,960,12),materials);rail.castShadow=rail.receiveShadow=true;scene.add(rail);}
const kart = new Kart(world, prototypes.get('cars/race')!, 2.7);scene.add(kart.visual);
const human=new Kart(world,prototypes.get('cars/hatchback-sports')!,-2.7);scene.add(human.visual);
const renderer = new THREE.WebGLRenderer({antialias:false});
renderer.setSize(1,1);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const vision=new FlyVision();
const canvas=document.querySelector<HTMLCanvasElement>('#training-view')!;
const overhead=new THREE.PerspectiveCamera(60,1,.1,600);overhead.position.set(0,10,0);
function expert(){
 if(new URLSearchParams(location.search).has("corrected"))return correctionTeacher(kart.body.translation(),kart.yaw,kart.speed);
 const p=kart.body.translation(),n=nearest(p.x,p.z);
 const look=point(n.u+(8+Math.abs(kart.speed)*.48)/TRACK_LENGTH);
 const desired=Math.atan2(look.x-p.x,look.z-p.z);
 const error=Math.atan2(Math.sin(desired-kart.yaw),Math.cos(desired-kart.yaw));
 let target=25;
 for(const distance of [0,6,12,20,30,44]){
  const u=n.u+distance/TRACK_LENGTH;
  const curvature=Math.acos(THREE.MathUtils.clamp(tangent(u-3/TRACK_LENGTH).dot(tangent(u+3/TRACK_LENGTH)),-1,1))/6;
  const corner=THREE.MathUtils.clamp(Math.sqrt(11/Math.max(curvature,.001)),12,25);
  target=Math.min(target,Math.sqrt(corner*corner+14*Math.max(0,distance-5)));
 }
 target=Math.min(target,25/(1+Math.abs(error)*.8));if(n.distance>4)target=Math.min(target,Math.max(8,20-n.distance*1.5));
 const diff=target-kart.speed,braking=diff<-.7;
 return {u:n.u,targetSpeed:target,steering:THREE.MathUtils.clamp(-error*1.9,-1,1),throttle:braking?0:THREE.MathUtils.clamp(.2+diff*.45,0,1),brake:braking?THREE.MathUtils.clamp(-diff*.22,0,1):0,jump:false};
}
renderer.render(scene,overhead);renderer.shadowMap.autoUpdate=false;drawTrainingMap(canvas,{...kart.body.translation(),yaw:kart.yaw});
button.disabled=false;status.textContent='Ready: 90 km/h straight-line target, curvature-based braking teacher.';
button.onclick=async()=>{
 button.disabled=true;
 try{
 const params=new URLSearchParams(location.search);const batch=params.get('batch');const episodic=params.has('episodes');const trajectory:Record<string,unknown>[]=[];let trail:{x:number;z:number}[]=[];
 type ReplaySample={x:number;z:number;yaw:number;speed:number;time:number};
 const replay=params.has('replay') ? await (await fetch('/meadow-brake-replays.json')).json() as {source:string;samples:ReplaySample[]}[] : null;
 if(replay && !replay.length)throw Error('Missing failure trajectories');
 const recovery = new URLSearchParams(location.search).has('recovery');
 let seed=Number(params.get('seed') || 773);const phase=(seed%1000)/1000;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let index=0;index<1800;index++){
  if(episodic && index%30===0){
   kart.reset(true);const episode=index/30;const focus=!circuit && (batch || "").startsWith("meadow90-b-") && Number((batch || "").split("-").at(-1))>=3;const u=focus && episode%2===0 ? .665+random()*.11 : (episode*.61803398875+phase)%1;const p=pose(u,Math.sin(episode*2.4+phase*6.28)*4);p.position.y=.7;
   kart.yaw=p.yaw; kart.body.setTranslation(p.position,true);kart.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw),true);
   const speed=12+((episode+Math.floor(phase*10))%5)*3; kart.body.setLinvel({x:Math.sin(p.yaw)*speed,y:0,z:Math.cos(p.yaw)*speed},true);kart.speed=speed;kart.lastPosition.copy(p.position);trail=[];
  }
  let sourceSample:ReplaySample|undefined;
  if(replay){
   const episode=Math.floor(index/30),part=index%30,run=replay[episode%replay.length];
   // Re-render recorded model poses in order. Later episodes add small pose perturbations.
   const start=Math.floor(episode/replay.length)%Math.max(1,run.samples.length-15);
   sourceSample=run.samples[Math.min(run.samples.length-1,start+Math.floor(part/2))];
   const jitter=episode<replay.length?0:Math.sin(episode*2.4)*.5;
   const p=new THREE.Vector3(sourceSample.x+jitter,.606,sourceSample.z);
   kart.body.setTranslation(p,true);kart.yaw=sourceSample.yaw+(episode<replay.length?0:Math.sin(episode)*.035);
   kart.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),kart.yaw),true);
   kart.speed=sourceSample.speed;kart.lastPosition.copy(p);kart.distance=nearest(p.x,p.z).distance;kart.resets=0;
  } else if(recovery){
   const p=pose(random(),(random()*2-1)*6);const yaw=p.yaw+(random()*2-1)*.5;p.position.y=.606;
   kart.body.setTranslation(p.position,true);kart.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),true);
   kart.yaw=yaw;kart.speed=12+random()*13;kart.lastPosition.copy(p.position);kart.resets=0;
  } else {
  for(let tick=0;tick<6;tick++){
   const input=expert();
   // Small, deterministic steering disturbances produce recovery examples.
   input.steering=THREE.MathUtils.clamp(input.steering+.055*Math.sin((index*6+tick)*.017),-1,1);
   kart.step(1/60,input,true);human.step(1/60,emptyInput(),false);world.step();
  }
  }
  kart.render(.1,1);human.render(.1,1);trail.push({...kart.body.translation()});if(index%3===0)drawTrainingMap(canvas,{...kart.body.translation(),yaw:kart.yaw},trail);
  const label={environmentVersion:'shared-physics-sensor-shadows-v2',...(replay?correctionTeacher(kart.body.translation(),kart.yaw,kart.speed):expert()),trainingOnly:!!replay,sourceTime:sourceSample?.time,track:circuit?.id ?? "meadow",episode:episodic||replay?Math.floor(index/30):0,index,speed:kart.speed,distance:kart.distance,resets:kart.resets,x:kart.body.translation().x,z:kart.body.translation().z,yaw:kart.yaw,time:(index+1)/10};
  if(kart.resets>0)throw Error('Teacher needed a reset; reject this dataset');
  const frame=vision.capture(renderer,scene,kart.renderPosition,kart.yaw,kart.visual);
  const result=await fetch('/training-capture',{method:'POST',headers:{'x-training-label':JSON.stringify(label),'x-training-run':batch?`${batch}-${circuit?.id ?? 'meadow'}`:'legacy'},body:new Uint8Array(frame)});
  if(!result.ok)throw Error(await result.text());
  trajectory.push(label);
  if(batch && (index%30===29 || index===1799))await fetch('/training-result',{method:'POST',body:JSON.stringify({id:`${batch}-${circuit?.id ?? 'meadow'}`,name:circuit?.name ?? 'Meadow',track:circuit?.id ?? 'meadow',map:trackMap,kind:replay?'Corrected recorded failure poses · training only':'Scripted teacher · short driving episodes',status:index===1799?'captured':'recording',samples:trajectory})});
  if(index%10===0)status.textContent=`Captured ${index+1}/1800 · ${(kart.speed*3.6).toFixed(1)} km/h · road offset ${kart.distance.toFixed(1)} m`;
 }
 status.textContent='Collection complete: 1800 frames saved.';parent.postMessage({type:'capture-complete',track:circuit?.id ?? 'meadow'},location.origin);
 }catch(error){status.textContent=`FAILED: ${error}`;parent.postMessage({type:'capture-failed',error:String(error)},location.origin);}
};

if(new URLSearchParams(location.search).has("autostart"))button.click();
