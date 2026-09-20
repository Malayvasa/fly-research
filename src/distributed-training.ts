export {};
const tracks=['monza','silverstone','interlagos','spa','red-bull-ring'];
const status=document.querySelector('#status')!,button=document.querySelector<HTMLButtonElement>('#start')!;
const batch=new URLSearchParams(location.search).get('batch') || `f1-${Date.now()}`;let next=Math.max(0,tracks.indexOf(new URLSearchParams(location.search).get('from') || tracks[0]));let frame:HTMLIFrameElement;
function launch(){const track=tracks[next];status.textContent=`Collecting ${track} · ${next+1}/5 · neural workers process completed captures`;frame=document.createElement('iframe');frame.title=`${track} training map`;frame.src=`/training90.html?track=${track}&batch=${batch}&episodes=1&autostart=1`;document.querySelector('#stage')!.replaceChildren(frame);}
button.onclick=()=>{button.disabled=true;launch();};
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;if(event.data.type==='capture-failed'){status.textContent=`Collection stopped: ${event.data.error}`;return;}if(event.data.type==='capture-complete'){next++;if(next<tracks.length)launch();else status.textContent='Five captures complete. Neural workers are encoding the data before the combined fit.';}});
