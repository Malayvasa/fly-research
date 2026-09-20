import * as THREE from 'three';
import {FlyVision} from './fly-vision';
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(320,200);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color('white');scene.add(new THREE.HemisphereLight(0xffffff,0x555555,1));
const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,8,2);light.castShadow=true;light.shadow.mapSize.set(1024,1024);scene.add(light);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0xaaaaaa}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
const car=new THREE.Mesh(new THREE.BoxGeometry(2,2,3),new THREE.MeshStandardMaterial({color:0xff0000}));car.position.set(0,1,0);car.castShadow=true;scene.add(car);
const camera=new THREE.PerspectiveCamera(60,1.6,.1,100);camera.position.set(8,10,8);camera.lookAt(0,0,0);
const sensor=new FlyVision(),position=new THREE.Vector3(0,.6,0);
renderer.render(scene,camera);const first=sensor.capture(renderer,scene,position,0,car).slice();
// Change only the spectator shadow history, not the scene visible to the sensor.
car.position.set(4,1,4);renderer.shadowMap.autoUpdate=true;renderer.render(scene,camera);
renderer.setScissorTest(true);renderer.setViewport(30,10,200,100);renderer.setScissor(40,15,160,80);
const second=sensor.capture(renderer,scene,position,0,car).slice();
const changed=first.reduce((n,v,i)=>n+Number(v!==second[i]),0);
const viewport=renderer.getViewport(new THREE.Vector4());const restored=renderer.getScissorTest() && viewport.equals(new THREE.Vector4(30,10,200,100)) && car.visible;
document.querySelector('#result')!.textContent=`${changed===0 && restored?'PASS':'FAIL'}: ${changed} changed RGB bytes after changing spectator shadow history. Renderer state restored: ${restored}.`;
sensor.dispose();renderer.dispose();
