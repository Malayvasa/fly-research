import {nearest,point,tangent,TRACK_LENGTH} from './track.ts';
/** Offline corrective labels only. Never called by the learned driving controller. */
export function correctionTeacher(p:{x:number;z:number},yaw:number,speed:number){
 const n=nearest(p.x,p.z),look=point(n.u+(8+Math.abs(speed)*.48)/TRACK_LENGTH);
 const desired=Math.atan2(look.x-p.x,look.z-p.z),error=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));
 let target=25;
 for(const distance of [0,4,8,12,20,30,44,60]){
  const u=n.u+distance/TRACK_LENGTH,a=tangent(u-3/TRACK_LENGTH),b=tangent(u+3/TRACK_LENGTH);
  const curvature=Math.acos(Math.max(-1,Math.min(1,a.dot(b))))/6;
  const corner=Math.max(8,Math.min(25,Math.sqrt(7/Math.max(curvature,.001))));
  target=Math.min(target,Math.sqrt(corner*corner+10*Math.max(0,distance-12)));
 }
 target=Math.min(target,25/(1+Math.abs(error)*1.5));
 if(n.distance>2.5)target=Math.min(target,Math.max(4,18-2*n.distance));
 const diff=target-speed,braking=diff<-.7;
 return {u:n.u,targetSpeed:target,steering:Math.max(-1,Math.min(1,-error*1.9)),throttle:braking?0:Math.max(0,Math.min(1,.2+diff*.45)),brake:braking?Math.min(1,-diff*.22):0,jump:false};
}
