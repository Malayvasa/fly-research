import * as THREE from 'three';

/** Measured MaleCNS coordinates rendered in a rotating 3D point cloud. */
export class FlyAnatomy {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1.5 * 288 / 250, 1.5 * 288 / 250, 1.5, -1.5, .1, 10);
  private points?: THREE.Points;
  private ids = new Uint32Array();
  private selected = {value: 0};
  private caption: HTMLElement;
  private sensors = new Int32Array();
  private inputColors?: THREE.BufferAttribute;
  private groups = new Uint8Array();
  private target = new Float32Array();
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  private activity?: THREE.BufferAttribute;
  constructor(canvas: HTMLCanvasElement, caption: HTMLElement) {
    this.caption = caption;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
    this.renderer.setClearColor('#f7faf7');
    this.camera.position.z = 4;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(288, 250, false);
    void this.load(caption).catch(() => {caption.textContent = 'Measured anatomy unavailable';});
  }
  private async load(caption: HTMLElement) {
    const buffers = await Promise.all(['/neural/positions.bin?v=uniform-upright', '/neural/ids.bin', '/neural/groups.bin?v=broader-annotations', '/neural/photoreceptors.bin'].map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Anatomy unavailable');
      return response.arrayBuffer();
    }));
    const positions = new Float32Array(buffers[0]);
    this.ids = new Uint32Array(buffers[1]);
    if (positions.length !== this.ids.length * 3) throw new Error('Invalid anatomy');
    this.groups = new Uint8Array(buffers[2]);
    if (this.groups.length !== this.ids.length) throw new Error('Invalid neuron groups');
    this.sensors = new Int32Array(buffers[3]);
    if (this.sensors.length !== this.ids.length) throw new Error('Invalid photoreceptor mapping');
    const geometry = new THREE.BufferGeometry();
    this.inputColors = new THREE.BufferAttribute(new Float32Array(this.ids.length * 3), 3);
    geometry.setAttribute('inputColor', this.inputColors);
    geometry.setAttribute('isSensor', new THREE.BufferAttribute(Float32Array.from(this.sensors, value => value >= 0 ? 1 : 0), 1));
    geometry.setAttribute('groupId', new THREE.BufferAttribute(Float32Array.from(this.groups), 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    geometry.translate(-sphere.center.x, -sphere.center.y, -sphere.center.z);
    geometry.scale(1.2 / sphere.radius, 1.2 / sphere.radius, 1.2 / sphere.radius);
    this.target = new Float32Array(this.ids.length);
    this.activity = new THREE.BufferAttribute(new Float32Array(this.ids.length), 1);
    geometry.setAttribute('activity', this.activity);
    const material = new THREE.ShaderMaterial({
      uniforms: {selected: this.selected, pixelRatio: {value: this.pixelRatio}},
      vertexShader: `attribute float activity; attribute vec3 inputColor; attribute float isSensor; varying vec3 sampledColor; varying float sensor; attribute float groupId; uniform float selected; uniform float pixelRatio; varying float rate; varying float kind; void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        float included = selected == 0. || abs(groupId - selected) < .1 ? 1. : 0.;
        rate = activity * included * (abs(groupId - 1.) < .1 && isSensor < .5 ? 0. : 1.);
        kind = groupId; sampledColor = inputColor; sensor = isSensor;
        gl_PointSize = pixelRatio * mix(.7, groupId < .5 ? 1.1 : 2.8, smoothstep(0., .7, rate));
      }`,
      fragmentShader: `varying vec3 sampledColor; varying float sensor; varying float rate; varying float kind; void main() {
        float d = distance(gl_PointCoord, vec2(.5)) * 2.;
        if (d > 1.) discard;
        vec3 signalColor = kind > 1.5 ? vec3(.94,.36,.12) : kind > .5 ? vec3(.02,.55,.69) : vec3(.52,.32,.77);
        if (sensor > .5) signalColor = sampledColor;
        float edge = 1. - smoothstep(.45, 1., d);
        float emphasis = kind < .5 ? .12 : 1.;
        gl_FragColor = vec4(mix(vec3(.32,.43,.39), signalColor, smoothstep(0., .25, rate)), mix(.025, .95 * emphasis, rate) * edge);
      }`, transparent: true, depthTest: true, depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.rotation.x = 0;
    this.scene.add(this.points);
    this.select(this.selected.value);
    let previous = 0;
    const started = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.renderer.setAnimationLoop((time: number) => {
      if (document.hidden) {previous = time; return;}
      const dt = Math.min((time - previous) / 1000, .05);
      previous = time;
      const values = this.activity!.array as Float32Array;
      for (let i = 0; i < values.length; i++) {
        // Ease into new samples, then release slowly across telemetry frames.
        const tau = this.target[i] > values[i] ? .10 : .38;
        values[i] += (this.target[i] - values[i]) * (1 - Math.exp(-dt / tau));
      }
      this.activity!.needsUpdate = true;
      if (!reduced.matches) this.points!.rotation.y = (time - started) * .00018;
      this.renderer.render(this.scene, this.camera);
    });
  }
  select(group: number) {
    if (![0, 1, 2].includes(group)) return;
    this.selected.value = group;
    const count = group === 0 ? this.ids.length : this.groups.filter(value => value === group).length;
    this.caption.textContent = `${count.toLocaleString()} measured ${['neurons', 'visual-system neurons', 'motor / descending neurons'][group]} · input color + activity`;
    this.renderer.render(this.scene, this.camera);
  }
  update(values: Uint8Array, colors?: Uint8Array) {
    if (!this.activity || this.ids.some(id => id >= values.length)) return;
    for (let i = 0; i < this.ids.length; i++) {
      this.target[i] = values[this.ids[i]] / 255;
      const sensor = this.sensors[i];
      if (colors && sensor >= 0 && sensor * 3 + 2 < colors.length) {
        this.inputColors!.setXYZ(i, colors[sensor * 3] / 255, colors[sensor * 3 + 1] / 255, colors[sensor * 3 + 2] / 255);
      }
    }
    if (colors) this.inputColors!.needsUpdate = true;
  }
  clear() {
    if (!this.activity) return;
    this.target.fill(0);
    (this.activity.array as Float32Array).fill(0);
    this.activity.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
