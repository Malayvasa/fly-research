export {};
const tracks=['monza','silverstone','spa','interlagos','red-bull-ring','imola'];
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#start')!;
let index=0;let frame:HTMLIFrameElement;
function next(){const track=tracks[index];status.textContent=`Testing ${track} · circuit ${index+1}/6${track==='imola'?' · unseen during training':''}`;frame=document.createElement('iframe');frame.title=`${track} evaluation`;frame.src=`/evaluate90.html?track=${track}&batch=f1-test-a&autostart=1`;document.querySelector('#stage')!.replaceChildren(frame);}
button.onclick=()=>{button.disabled=true;next();};
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;if(event.data.type==='evaluation-error'){status.textContent=`Stopped: ${event.data.error}`;return;}if(event.data.type==='evaluation-complete'){index++;if(index<tracks.length)setTimeout(next,1500);else status.textContent='All evaluations finished. Results include failures; the model was not retrained.';}});
