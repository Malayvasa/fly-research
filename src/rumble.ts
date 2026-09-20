export type RumbleMotor = {
  effects?: readonly string[];
  playEffect(
    type: "dual-rumble",
    options: {
      duration: number;
      startDelay: number;
      strongMagnitude: number;
      weakMagnitude: number;
    },
  ): Promise<unknown>;
  reset(): Promise<unknown>;
};
type Motion = {
  speed: number;
  verticalSpeed: number;
  grounded: boolean;
  throttle: number;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Short, renewable effects ensure vibration cannot outlive a stalled frame loop. */
export class RaceRumble {
  private motor: RumbleMotor | null = null;
  private previous: Motion | null = null;
  private nextEffect = 0;
  private pulseUntil = 0;
  private failed = false;
  private playing = false;

  stop() {
    if (this.playing && this.motor) {
      try {
        void this.motor.reset().catch(() => {});
      } catch {
        /* Optional hardware. */
      }
    }
    this.playing = false;
    this.previous = null;
    this.nextEffect = this.pulseUntil = 0;
  }

  update(
    now: number,
    motor: RumbleMotor | null,
    active: boolean,
    motion: Motion,
  ) {
    if (motor !== this.motor) {
      this.stop();
      this.motor = motor;
      this.failed = false;
    }
    if (
      !active ||
      !motor ||
      this.failed ||
      (motor.effects && !motor.effects.includes("dual-rumble"))
    ) {
      this.stop();
      return;
    }
    const old = this.previous;
    this.previous = { ...motion };
    // Abrupt horizontal speed loss, above ordinary braking, approximates a collision.
    const impact = old
      ? clamp((Math.abs(old.speed) - Math.abs(motion.speed) - 1.8) / 7)
      : 0;
    const landing =
      old && !old.grounded && motion.grounded
        ? clamp((-old.verticalSpeed - 1) / 7)
        : 0;
    const hit = Math.max(impact, landing);
    if (hit > 0.05) {
      this.pulseUntil = now + 240;
      this.play(0.55 + hit * 0.45, 0.5 + hit * 0.5, 240);
      this.nextEffect = this.pulseUntil;
    } else if (now >= this.nextEffect && now >= this.pulseUntil) {
      const energy = motion.grounded
        ? clamp(Math.abs(motion.speed) / 27) * clamp(motion.throttle)
        : 0;
      if (energy > 0.03) {
        this.play(0.18 + 0.32 * energy, 0.3 + 0.4 * energy, 160);
        this.nextEffect = now + 110;
      } else if (this.playing) {
        try {
          void motor.reset().catch(() => {});
        } catch {
          /* Optional hardware. */
        }
        this.playing = false;
      }
    }
  }
  private play(
    strongMagnitude: number,
    weakMagnitude: number,
    duration: number,
  ) {
    const motor = this.motor!;
    this.playing = true;
    try {
      void motor
        .playEffect("dual-rumble", {
          duration,
          startDelay: 0,
          strongMagnitude,
          weakMagnitude,
        })
        .catch(() => {
          if (this.motor === motor) {
            this.failed = true;
            this.stop();
          }
        });
    } catch {
      this.failed = true;
      this.stop();
    }
  }
}
