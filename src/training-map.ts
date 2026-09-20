import {samples} from './track';
export const trackMap = samples.filter((_,i)=>i%4===0).map(p=>({x:p.x,z:p.z}));
export function drawTrainingMap(canvas:HTMLCanvasElement, car:{x:number;z:number;yaw:number}, trail:{x:number;z:number}[]=[]){
 const ctx=canvas.getContext('2d')!;const w=640,h=400;canvas.width=w;canvas.height=h;
 const xs=trackMap.map(p=>p.x),zs=trackMap.map(p=>p.z);const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
 const scale=Math.min((w-50)/(maxX-minX),(h-50)/(maxZ-minZ));
 const x=(v:number)=>w/2+(v-(minX+maxX)/2)*scale,z=(v:number)=>h/2+(v-(minZ+maxZ)/2)*scale;
 ctx.fillStyle='#f2f5ef';ctx.fillRect(0,0,w,h);ctx.lineJoin='round';ctx.beginPath();trackMap.forEach((p,i)=>i?ctx.lineTo(x(p.x),z(p.z)):ctx.moveTo(x(p.x),z(p.z)));ctx.closePath();ctx.strokeStyle='#b9c8b8';ctx.lineWidth=Math.max(3,16*scale);ctx.stroke();
 ctx.beginPath();trail.forEach((p,i)=>i?ctx.lineTo(x(p.x),z(p.z)):ctx.moveTo(x(p.x),z(p.z)));ctx.strokeStyle='#398877';ctx.lineWidth=2;ctx.stroke();
 ctx.save();ctx.translate(x(car.x),z(car.z));ctx.rotate(-car.yaw);ctx.fillStyle='#df833a';ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(-5,-5);ctx.lineTo(5,-5);ctx.closePath();ctx.fill();ctx.restore();
}
