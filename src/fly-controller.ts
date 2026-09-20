import type {VehicleInput} from './vehicle.ts';

// Rates are spikes per cell per second, not Fly64's spikes per cell per tick.
export type NeuralSample = {
  sequence: number;
  frameId: number;
  forwardHz: number;
  leftHz: number;
  rightHz: number;
};

export type FlyControllerConfig = {
  steeringGain: number;
  steeringDeadzone: number;
  invertSteering: boolean;
  smoothingSeconds: number;
  staleMs: number;
  throttleMode: 'fixed' | 'neural';
  fixedThrottle: number;
  maxThrottle: number;
  forwardThresholdHz: number;
  forwardFullScaleHz: number;
};

const defaults: FlyControllerConfig = {
  steeringGain: 1100 / (50 * 70),
  steeringDeadzone: 8 / 70,
  invertSteering: false,
  smoothingSeconds: -0.02 / Math.log(0.78),
  staleMs: 250,
  throttleMode: 'fixed',
  fixedThrottle: 0.3,
  maxThrottle: 0.5,
  forwardThresholdHz: 0.4,
  forwardFullScaleHz: 2.15,
};

const neutral = (): VehicleInput => ({steering: 0, throttle: 0, brake: 0, jump: false});
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export class FlyController {
  readonly config: Readonly<FlyControllerConfig>;
  private sample: NeuralSample | null = null;
  private receivedAtMs = -Infinity;
  private lastSequence = -1;
  private lastFrameId = -1;
  private steering = 0;
  private throttle = 0;

  constructor(config: Partial<FlyControllerConfig> = {}) {
    const c = {...defaults, ...config};
    const numbers = [c.steeringGain, c.steeringDeadzone, c.smoothingSeconds,
      c.staleMs, c.fixedThrottle, c.maxThrottle, c.forwardThresholdHz, c.forwardFullScaleHz];
    if (!numbers.every(Number.isFinite) || c.steeringGain < 0 ||
        c.steeringDeadzone < 0 || c.steeringDeadzone >= 1 || c.smoothingSeconds < 0 ||
        c.staleMs <= 0 || c.fixedThrottle < 0 || c.fixedThrottle > 1 ||
        c.maxThrottle < 0 || c.maxThrottle > 1 || c.forwardThresholdHz < 0 ||
        c.forwardFullScaleHz <= c.forwardThresholdHz ||
        typeof c.invertSteering !== 'boolean' || !['fixed', 'neural'].includes(c.throttleMode)) {
      throw new RangeError('Invalid fly controller configuration');
    }
    this.config = Object.freeze(c);
  }

  // Use the browser's local monotonic clock; never subtract clocks on two Macs.
  accept(value: unknown, receivedAtMs: number): boolean {
    if (!value || typeof value !== 'object' || !Number.isFinite(receivedAtMs) ||
        receivedAtMs < 0 || receivedAtMs < this.receivedAtMs) return false;
    const s = value as NeuralSample;
    if (!Number.isSafeInteger(s.sequence) || s.sequence <= this.lastSequence ||
        !Number.isSafeInteger(s.frameId) || s.frameId < 0 || s.frameId < this.lastFrameId ||
        ![s.forwardHz, s.leftHz, s.rightHz].every(n => Number.isFinite(n) && n >= 0 && n <= 50)) return false;
    this.sample = {...s};
    this.receivedAtMs = receivedAtMs;
    this.lastSequence = s.sequence;
    this.lastFrameId = s.frameId;
    return true;
  }

  step(dtSeconds: number, nowMs: number, active = true): VehicleInput {
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(nowMs) ||
        !active || !this.sample || nowMs < this.receivedAtMs ||
        nowMs - this.receivedAtMs >= this.config.staleMs) {
      this.steering = this.throttle = 0;
      return neutral();
    }
    const c = this.config;
    const sign = c.invertSteering ? -1 : 1;
    const targetSteering = clamp((this.sample.rightHz - this.sample.leftHz) * c.steeringGain * sign, -1, 1);
    const targetThrottle = c.throttleMode === 'fixed' ? c.fixedThrottle :
      clamp((this.sample.forwardHz - c.forwardThresholdHz) /
        (c.forwardFullScaleHz - c.forwardThresholdHz), 0, 1) * c.maxThrottle;
    const alpha = c.smoothingSeconds === 0 ? 1 : 1 - Math.exp(-dtSeconds / c.smoothingSeconds);
    this.steering += alpha * (targetSteering - this.steering);
    this.throttle += alpha * (Math.min(targetThrottle, c.maxThrottle) - this.throttle);
    return {
      steering: Math.abs(this.steering) < c.steeringDeadzone ? 0 : this.steering,
      throttle: this.throttle,
      brake: 0,
      jump: false,
    };
  }

  // Call on disconnect, a new session, and race reset. The caller owns reconnects.
  reset(): void {
    this.sample = null;
    this.receivedAtMs = -Infinity;
    this.lastSequence = this.lastFrameId = -1;
    this.steering = this.throttle = 0;
  }
}
