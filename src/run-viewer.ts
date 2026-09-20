import {samples as track} from './track';
import './run-viewer.css';
type Sample={episode?:number;x:number;z:number;yaw:number;speed:number;time:number;resets:number;distance?:number;u?:number};
type Run={map?:{x:number;z:number}[];track?:string;gateCount?:number;requiredLaps?:number;id:string;name:string;kind:string;status:string;note?:string;samples:Sample[];final?:{brakingSteps?:number;physicsSteps?:number;time:number;resets:number;passed:number;lapTimes:number[]}};
const root=document.querySelector('#runs')!,connection=document.querySelector('#connection')!;
const live=document.createElement('aside');live.id='training-status';live.setAttribute('aria-live','polite');root.before(live);
const cards=new Map<string,{element:HTMLElement,canvas:HTMLCanvasElement}>();
function draw(canvas:HTMLCanvasElement,run:Run){
 const path=run.map ?? track;
 const minX=Math.min(...path.map(p=>p.x))-14,maxX=Math.max(...path.map(p=>p.x))+14;
 const minZ=Math.min(...path.map(p=>p.z))-14,maxZ=Math.max(...path.map(p=>p.z))+14;
 const ctx=canvas.getContext('2d')!;const w=640,h=400;canvas.width=w;canvas.height=h;
 const scale=Math.min((w-36)/(maxX-minX),(h-36)/(maxZ-minZ));
 const px=(x:number)=>w/2+(x-(minX+maxX)/2)*scale,pz=(z:number)=>h/2+(z-(minZ+maxZ)/2)*scale;
 ctx.fillStyle='#f2f5ef';ctx.fillRect(0,0,w,h);
 ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(px(p.x),pz(p.z)):ctx.moveTo(px(p.x),pz(p.z)));ctx.closePath();ctx.strokeStyle='#d8e0d5';ctx.lineWidth=Math.max(3,20*scale);ctx.lineJoin='round';ctx.stroke();
 ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);
 const valid=run.samples.filter(s=>Number.isFinite(s.x)&&Number.isFinite(s.z));
 ctx.beginPath();valid.forEach((s,i)=>i && s.episode===valid[i-1].episode?ctx.lineTo(px(s.x),pz(s.z)):ctx.moveTo(px(s.x),pz(s.z)));ctx.strokeStyle='#3c8b79';ctx.lineWidth=2;ctx.stroke();
 const s=valid.at(-1);if(!s)return;
 ctx.save();ctx.translate(px(s.x),pz(s.z));ctx.rotate(-s.yaw);ctx.fillStyle='#e99849';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(-6,-6);ctx.lineTo(6,-6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 ctx.fillStyle='#506257';ctx.font='12px system-ui';ctx.fillText('TOP VIEW · ACTUAL TRAJECTORY',14,20);
}
async function refresh(){
 try{
 const response=await fetch('/training-runs');if(!response.ok)throw Error('Disconnected');const all:Run[]=await response.json();const batch=new URLSearchParams(location.search).get('batch');const runs=all.filter(run=>!batch||run.id.startsWith(batch+'-'));
 const workers=runs.filter(run=>run.kind==='Neural encoding worker');
 live.replaceChildren();live.hidden=!workers.length;
 for(const worker of workers){const row=document.createElement('div');const title=document.createElement('strong');title.textContent=`${worker.name} · ${worker.status}`;const detail=document.createElement('p');detail.textContent=worker.note || '';row.append(title,detail);live.append(row);}
 if(workers.length){const explanation=document.createElement('p');explanation.className='explanation';explanation.textContent='Maps below show recorded training examples. Cars move again during driving evaluation; neural processing and fitting happen without a live car.';live.append(explanation);}
 connection.textContent=`Updated ${new Date().toLocaleTimeString()}`;
 if(!runs.length)root.textContent='Waiting for training runs. Each run will appear here as it produces samples.';
 for(const run of runs.filter(run=>run.kind!=='Neural encoding worker')){
  if(!cards.has(run.id)){
   if(!cards.size)root.textContent='';
   const element=document.createElement('section');element.innerHTML='<header><h2></h2><span></span></header><p></p><canvas></canvas><footer></footer>';root.append(element);cards.set(run.id,{element,canvas:element.querySelector('canvas')!});
  }
  const {element,canvas}=cards.get(run.id)!;element.querySelector('h2')!.textContent=run.name;element.querySelector('header span')!.textContent=run.status==='captured'?'Recorded':run.status;element.querySelector('p')!.textContent=run.kind;
  const last=run.samples.at(-1);let laps=0;for(let i=1;i<run.samples.length;i++)if((run.samples[i-1].u??0)>.9&&(run.samples[i].u??0)<.1)laps++;
  element.querySelector('footer')!.textContent=run.note?run.note:last?`${(last.speed*3.6).toFixed(0)} km/h · ${last.time.toFixed(1)} s · ${run.kind.includes('episodes')?'sampled episodes':`${run.final?.lapTimes.length ?? 0}/3 completed laps`} · ${run.final?.resets ?? last.resets} resets`:'Waiting for samples';
  if(run.final && run.kind.includes('Learned')){element.querySelector('footer')!.textContent=`${run.final.lapTimes.length}/${run.requiredLaps ?? 3} completed laps · ${run.final.passed} checkpoints · ${run.final.resets} resets · ${run.final.time.toFixed(1)} s${run.final.physicsSteps ? ` · braking ${(100*(run.final.brakingSteps??0)/run.final.physicsSteps).toFixed(0)}% of steps` : ''}${run.status==='failed'?' · FAILED':''}`;}
  canvas.hidden=run.kind==='Neural encoding worker';if(!canvas.hidden)draw(canvas,run);
 }
 }catch{connection.textContent='Waiting for training server…';}
 setTimeout(refresh,1000);
}
void refresh();

if(new URLSearchParams(location.search).get('batch')==='meadow90-b'){
 const controls=document.createElement('section');controls.style.marginBottom='20px';
 const start=document.createElement('button');start.textContent='Run meadow driving tests';start.style.cssText='margin:16px;padding:10px 18px;font:inherit';
 controls.append(start);root.before(controls);
 start.onclick=()=>{start.disabled=true;start.textContent='Driving tests running here';const runner=document.createElement('iframe');runner.title='Live meadow driving test';runner.style.cssText='width:100%;height:610px;border:0';runner.src='/evaluate90.html?track=meadow&batch=meadow90-b-test&autostart=1';controls.append(runner);
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==runner.contentWindow)return;if(event.data.type==='evaluation-complete')start.textContent='Driving tests finished — results below';if(event.data.type==='evaluation-error')start.textContent=`Test stopped: ${event.data.error}`;});};
}

if(new URLSearchParams(location.search).get('batch')==='meadow90-c'){
 const panel=document.createElement('section');panel.style.marginBottom='20px';const start=document.createElement('button');start.textContent='Collect braking corrections and test';start.style.cssText='margin:16px;padding:10px 18px;font:inherit';panel.append(start);root.before(panel);
 start.onclick=()=>{start.disabled=true;const runner=document.createElement('iframe');runner.title='Braking correction and driving test';runner.style.cssText='width:100%;height:610px;border:0';runner.src='/training90.html?track=meadow&batch=meadow90-c-replay&replay=1&autostart=1';panel.append(runner);start.textContent='Reconstructing failed approaches';
 async function waitForModel(){try{const response=await fetch('/meadow90-c-ready.json',{cache:'no-store'});if(response.ok && (await response.json()).ready){start.textContent='Testing corrected candidate';runner.src='/evaluate90.html?track=meadow&batch=meadow90-c-test&autostart=1';return;}}catch{}setTimeout(waitForModel,3000);}
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==runner.contentWindow)return;if(event.data.type==='capture-complete'){start.textContent='Encoding and fitting braking corrections';void waitForModel();}if(event.data.type==='evaluation-complete')start.textContent='Driving tests finished — see results below';if(['capture-failed','evaluation-error'].includes(event.data.type))start.textContent=`Stopped: ${event.data.error}`;});};
}

if(new URLSearchParams(location.search).get('batch')==='meadow90-d'){
 const panel=document.createElement('section');panel.style.marginBottom='20px';const start=document.createElement('button');start.textContent='Retrain with matched game environment';start.style.cssText='margin:16px;padding:10px 18px;font:inherit';panel.append(start);root.before(panel);
 start.onclick=async()=>{start.disabled=true;let index=0;const runner=document.createElement('iframe');runner.title='Fresh meadow training and evaluation';runner.style.cssText='width:100%;height:610px;border:0';panel.append(runner);
 function capture(){start.textContent=`Fresh capture ${index+1}/6 · matched game environment`;runner.src=`/training90.html?track=meadow&batch=meadow90-d-${index}&episodes=1&corrected=1&seed=${131+index*173}&autostart=1`;}
 async function waitForModel(){try{const response=await fetch('/meadow90-d-ready.json',{cache:'no-store'});if(response.ok && (await response.json()).ready){start.textContent='Testing newly trained candidate';runner.src='/evaluate90.html?track=meadow&batch=meadow90-d-test&autostart=1';return;}}catch{}setTimeout(waitForModel,3000);}
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==runner.contentWindow)return;if(event.data.type==='capture-complete'){index++;if(index<6)capture();else{start.textContent='Fresh captures complete · encoding and fitting';void waitForModel();}}if(event.data.type==='evaluation-complete')start.textContent='Tests finished — see results below';if(['capture-failed','evaluation-error'].includes(event.data.type))start.textContent=`Stopped: ${event.data.error}`;});
 const saved:Run[]=await (await fetch('/training-runs')).json();
 while(index<6 && saved.some(run=>run.id===`meadow90-d-${index}-meadow` && run.status==='captured'))index++;
 if(index===6){start.textContent='Captures already complete · waiting for candidate';void waitForModel();}else capture();};
}
