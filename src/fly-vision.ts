import * as THREE from 'three';

const FACE = 128;
// Local coordinates: right, up, forward. Matches Fly64's six-face atlas.
const directions = [[0,0,1],[1,0,0],[0,0,-1],[-1,0,0],[0,1,0],[0,-1,0]];
const ups = [[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,0,-1],[0,0,1]];

export class FlyVision {
  readonly rgb = new Uint8Array(384 * 256 * 3);
  private rgba = new Uint8Array(FACE * FACE * 4);
  private camera = new THREE.PerspectiveCamera(90, 1, 0.1, 600);
  private target = new THREE.WebGLRenderTarget(FACE, FACE, {depthBuffer: true});

  constructor() { this.target.texture.colorSpace = THREE.SRGBColorSpace; }

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: THREE.Vector3,
          yaw: number, hidden: THREE.Object3D): Uint8Array {
    const previousTarget = renderer.getRenderTarget();
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const visible = hidden.visible;
    const shadows = renderer.shadowMap.autoUpdate;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const localToWorld = (v: number[]) => right.clone().multiplyScalar(v[0])
      .add(new THREE.Vector3(0, v[1], 0)).addScaledVector(forward, v[2]);
    this.camera.position.copy(position).add(new THREE.Vector3(0, 0.8, 0));
    try {
      hidden.visible = false;
      // Build the sensor shadow map with the observed car hidden.
      // Never inherit a stale spectator shadow of that same car.
      renderer.shadowMap.autoUpdate = true;
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, FACE, FACE);
      for (let face = 0; face < 6; face++) {
        this.camera.up.copy(localToWorld(ups[face]));
        this.camera.lookAt(this.camera.position.clone().add(localToWorld(directions[face])));
        renderer.render(scene, this.camera);
        renderer.shadowMap.autoUpdate = false;
        renderer.readRenderTargetPixels(this.target, 0, 0, FACE, FACE, this.rgba);
        for (let y = 0; y < FACE; y++) for (let x = 0; x < FACE; x++) {
          const source = ((FACE - 1 - y) * FACE + x) * 4;
          const dest = ((Math.floor(face / 3) * FACE + y) * 384 + (face % 3) * FACE + x) * 3;
          this.rgb[dest] = this.rgba[source];
          this.rgb[dest + 1] = this.rgba[source + 1];
          this.rgb[dest + 2] = this.rgba[source + 2];
        }
      }
      return this.rgb;
    } finally {
      hidden.visible = visible;
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.shadowMap.autoUpdate = shadows;
      renderer.shadowMap.needsUpdate = true;
    }
  }

  dispose() { this.target.dispose(); }
}
