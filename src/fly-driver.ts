import * as THREE from 'three';
import {FlyClient} from './fly-client';
import {FlyVision} from './fly-vision';
import {emptyInput} from './vehicle';
import './fly-panel.css';

export class FlyDriver {
  enabled = new URLSearchParams(location.search).get('opponent') === 'fly';
  frames = 0;
  eyeFrames = 0;
  input = emptyInput();
  readonly client: FlyClient;
  private vision = new FlyVision();
  private lastCapture = -Infinity;
  private running = false;
  private panel = document.createElement('aside');
  private status: HTMLOutputElement;
  private controls: HTMLOutputElement;

  constructor(onModeChange: () => void) {
    this.panel.className = 'fly-panel';
    this.panel.setAttribute('aria-label', 'Fly nervous system');
    this.panel.innerHTML = `<header><select aria-label="Opponent controller"><option value="practice">Practice opponent</option><option value="fly">Fly · neural steering</option></select><output class="fly-status">offline</output></header><div class="fly-details"><div class="fly-eyes"><canvas width="256" height="128" aria-label="Live left and right fly-eye views"></canvas><span>LEFT EYE</span><span>RIGHT EYE</span></div><div class="fly-neurons"><div><label>DNg100 <small>Forward</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div><div><label>DNa02 / DNg13 <small>Left</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div><div><label>DNa02 / DNg13 <small>Right</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div></div><footer><span>ASSISTED THROTTLE</span><output class="fly-controls">Steer 0.00 · Power 0.00</output></footer><button type="button">Reconnect</button></div>`;
    document.body.append(this.panel);
    this.status = this.panel.querySelector('.fly-status')!;
    this.controls = this.panel.querySelector('.fly-controls')!;
    const context = this.panel.querySelector('canvas')!.getContext('2d')!;
    const pixels = context.createImageData(256, 128);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    const groups = Array.from(this.panel.querySelectorAll('.fly-neurons > div'));
    this.client = new FlyClient({url: 'ws://127.0.0.1:8765',
      onStatus: status => {
        this.status.value = status; this.panel.dataset.status = status;
        if (status !== 'ready') {
          this.input = emptyInput();
          this.controls.value = 'Steer 0.00 · Power 0.00';
          groups.forEach(group => {group.querySelector('meter')!.value = 0; group.querySelector('output')!.value = '—';});
        }
      },
      onEyes: eyes => {
        for (let i = 0; i < eyes.rgb.length / 3; i++) {
          pixels.data[i * 4] = eyes.rgb[i * 3];
          pixels.data[i * 4 + 1] = eyes.rgb[i * 3 + 1];
          pixels.data[i * 4 + 2] = eyes.rgb[i * 3 + 2];
        }
        context.putImageData(pixels, 0, 0);
        this.eyeFrames++;
      },
      onActivity: rates => [rates.forwardHz, rates.leftHz, rates.rightHz].forEach((rate, i) => {
        groups[i].querySelector('meter')!.value = rate;
        groups[i].querySelector('output')!.value = `${rate.toFixed(1)} Hz`;
      }),
    });
    const select = this.panel.querySelector('select')!;
    select.value = this.enabled ? 'fly' : 'practice';
    this.panel.dataset.enabled = String(this.enabled);
    select.onchange = () => {
      this.enabled = select.value === 'fly';
      this.panel.dataset.enabled = String(this.enabled);
      this.reset();
      onModeChange();
    };
    this.panel.querySelector('button')!.onclick = () => {this.reset();};
  }

  reset() {
    this.client.close();
    this.running = false;
    this.frames = this.eyeFrames = 0;
    this.input = emptyInput();
    this.lastCapture = -Infinity;
  }

  step(dt: number, active: boolean) {
    this.input = this.client.input(dt, active && this.enabled);
    this.controls.value = `Steer ${this.input.steering.toFixed(2)} · Power ${this.input.throttle.toFixed(2)}`;
    return this.input;
  }

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: THREE.Vector3,
          yaw: number, hidden: THREE.Object3D, active: boolean) {
    if (!this.enabled || !active) {
      if (this.running) {this.client.close(); this.running = false;}
      return;
    }
    if (!this.running) {this.client.connect(); this.running = true;}
    const now = performance.now();
    if (now - this.lastCapture < 100 || !['ready', 'stale'].includes(this.client.status)) return;
    this.lastCapture = now;
    const rgb = this.vision.capture(renderer, scene, position, yaw, hidden);
    if (this.client.sendFrame(rgb, now)) this.frames++;
  }
}
