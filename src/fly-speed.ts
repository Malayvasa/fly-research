import type {VehicleInput} from './vehicle.ts';

/** Assisted throttle/brake servo; steering and target speed come from the readout. */
export function applyLearnedSpeed(input: VehicleInput, target: number | null, speed: number, active: boolean): VehicleInput {
  if (!active || target === null || !Number.isFinite(target) || target < 0 || target > 25 || !Number.isFinite(speed)) {
    return {steering:0,throttle:0,brake:0,jump:false};
  }
  const error = target - speed;
  return {...input,
    throttle: error < -.7 ? 0 : Math.max(0,Math.min(1,.2+error*.45)),
    brake: error < -.7 ? Math.min(1,-error*.22) : 0,
  };
}
