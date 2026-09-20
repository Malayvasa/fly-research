import * as THREE from 'three';
import {FlyClient} from './fly-client';
import {FlyVision} from './fly-vision';
import {FlyRecovery} from './fly-recovery';
import {FlyControlInstruments} from './fly-controls';
import {emptyInput} from './vehicle';
import './fly-panel.css';

export class FlyDriver {
  enabled = new URLSearchParams(location.search).get('opponent') === 'fly';
  frames = 0;
  eyeFrames = 0;
  input = emptyInput();
  readonly client: FlyClient;
  readonly combined = new URLSearchParams(location.search).get('readout') === 'combined';
  readonly motorInputs = new URLSearchParams(location.search).get('motorInputs') === 'mean' ? 'mean' : 'live';
  readonly plasticMotor = new URLSearchParams(location.search).get('readout') === 'plastic-motor';
  readonly hybrid = new URLSearchParams(location.search).get('readout') === 'hybrid';
  readonly trainedMotor = new URLSearchParams(location.search).get('motorReadout') === 'trained';
  readonly trained = this.combined || this.hybrid || new URLSearchParams(location.search).get('readout') === 'trained';
  readonly recovery = new FlyRecovery();
  private vision = new FlyVision();
  private lastCapture = -Infinity;
  private running = false;
  private panel = document.createElement('aside');
  private status: HTMLOutputElement;
  private controls = new FlyControlInstruments();

  constructor(onModeChange: () => void) {
    this.panel.className = 'fly-panel';
    this.panel.setAttribute('aria-label', 'Fly nervous system');
    this.panel.innerHTML = `<header><select aria-label="Opponent controller"><option value="practice">Practice opponent</option><option value="fly">Fly · neural steering</option></select><output class="fly-status">offline</output></header><div class="fly-details"><div class="fly-eyes"><canvas width="256" height="128" aria-label="Live left and right fly-eye views"></canvas><span>LEFT EYE</span><span>RIGHT EYE</span></div><div class="fly-neurons"><div><label>DNg100 <small>Forward</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div><div><label>DNa02 / DNg13 <small>Left</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div><div><label>DNa02 / DNg13 <small>Right</small></label><meter min="0" max="50" value="0"></meter><output>0.0 Hz</output></div></div><footer><span>ASSISTED THROTTLE</span><output class="fly-controls">Steer 0.00 · Power 0.00</output></footer><button type="button">Reconnect</button></div>`;
    document.body.append(this.panel);
    const recoveryLabel = document.createElement('output');
    recoveryLabel.className = 'fly-recoveries';
    recoveryLabel.value = 'Assisted recoveries: 0';
    this.panel.querySelector('footer')!.append(recoveryLabel);
    this.status = this.panel.querySelector('.fly-status')!;
    this.panel.querySelector('.fly-controls')!.remove();
    this.panel.querySelector('.fly-eyes')!.after(this.controls.element);
    const context = this.panel.querySelector('canvas')!.getContext('2d')!;
    const pixels = context.createImageData(256, 128);
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    const groups = Array.from(this.panel.querySelectorAll('.fly-neurons > div'));
    this.panel.querySelector('option[value="fly"]')!.textContent = this.combined ? 'Learned visual + motor driver' : this.plasticMotor ? 'Trained motor connections' : this.hybrid ? 'Hybrid motor + visual' : this.trained ? 'Learned visual driver' : 'Fly motor output';
    const motorEffect = document.createElement('output');
    if (this.combined) {
      motorEffect.value = this.motorInputs === 'mean' ? 'Motor inputs masked' : 'Motor steering effect: —';
      motorEffect.title = 'Change in steering when motor inputs are used. A nonzero effect does not prove better driving.';
      this.panel.querySelector('footer')!.append(motorEffect);
    }
    if (this.hybrid) {
      const mix = document.createElement('span');
      mix.textContent = this.trainedMotor ? 'LEARNED MOTOR 50% / VISUAL 50%' : 'MOTOR 50% / VISUAL 50%';
      this.panel.querySelector('footer')!.append(mix);
    }
    if (this.trained) {
      this.panel.querySelector('footer > span')!.textContent = 'ASSISTED THROTTLE · 8 M/S LIMIT';
    }
    if (this.plasticMotor) this.panel.querySelector('footer > span')!.textContent = 'MOTOR STEERING + THROTTLE · EXPERIMENT';
    const seed = Number(new URLSearchParams(location.search).get('flySeed') ?? 64);
    this.client = new FlyClient({url: 'ws://127.0.0.1:8765',
      seed: Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32 ? seed : 64,
      controller: this.plasticMotor ? {readout: 'plastic-motor', throttleMode: 'neural'} : this.trained ? {readout: this.combined ? 'combined' : this.hybrid ? 'hybrid' : 'trained', motorInputs: this.motorInputs, motorReadout: this.trainedMotor ? 'trained' : 'rates', steeringDeadzone: 0, smoothingSeconds: 0.05} : {},
      onStatus: status => {
        this.status.value = status; this.panel.dataset.status = status;
        if (status !== 'ready') {
          if (this.combined && this.motorInputs === 'live') motorEffect.value = 'Motor steering effect: —';
          this.input = emptyInput();
          this.controls.update(this.input);
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
      onActivity: rates => {
        if (this.combined && this.motorInputs === 'live') motorEffect.value = `Motor steering effect: ${(rates.motorEffect ?? 0).toFixed(3)}`;
        [rates.forwardHz, rates.leftHz, rates.rightHz].forEach((rate, i) => {
        groups[i].querySelector('meter')!.value = rate;
        groups[i].querySelector('output')!.value = `${rate.toFixed(1)} Hz`;
        });
      },
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
    this.recovery.reset();
    this.panel.querySelector<HTMLOutputElement>('.fly-recoveries')!.value = 'Assisted recoveries: 0';
    this.client.close();
    this.running = false;
    this.frames = this.eyeFrames = 0;
    this.input = emptyInput();
    this.controls.update(this.input);
    this.lastCapture = -Infinity;
  }

  step(dt: number, active: boolean, speed = 0) {
    this.input = this.client.input(dt, active && this.enabled);
    if (this.trained && speed > 8) this.input.throttle = 0;
    this.controls.update(this.input);
    return this.input;
  }

  recoverIfStuck(dt: number, speed: number, active: boolean) {
    const recover = this.recovery.observe(dt, speed, this.input.throttle,
      active && this.enabled && this.client.status === 'ready');
    this.panel.querySelector<HTMLOutputElement>('.fly-recoveries')!.value = `Assisted recoveries: ${this.recovery.count}`;
    return recover;
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
