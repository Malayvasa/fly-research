// Recovery is a game assist, independent of the neural model and its readout.
export class FlyRecovery {
  count = 0;
  private stoppedSeconds = 0;

  observe(dt: number, speed: number, throttle: number, active: boolean): boolean {
    if (!active || !Number.isFinite(dt) || dt <= 0 || dt > 0.25 ||
        !Number.isFinite(speed) || !Number.isFinite(throttle) ||
        throttle <= 0.05 || Math.abs(speed) >= 0.5) {
      this.stoppedSeconds = 0;
      return false;
    }
    this.stoppedSeconds += dt;
    if (this.stoppedSeconds < 1.5) return false;
    this.stoppedSeconds = 0;
    this.count++;
    return true;
  }

  reset() { this.stoppedSeconds = 0; this.count = 0; }
}
