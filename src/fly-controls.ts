import type {VehicleInput} from './vehicle';

/** Read-only instruments for the controls actually applied to the fly's car. */
export class FlyControlInstruments {
  readonly element = document.createElement('div');
  private wheel: HTMLElement;
  private brake: HTMLElement;
  private throttle: HTMLElement;

  constructor() {
    this.element.className = 'fly-instruments';
    this.element.innerHTML = `<div class="fly-instrument"><div class="fly-wheel" role="img" aria-label="Steering centered"><i></i><i></i><i></i><b></b></div><span>STEERING</span></div><div class="fly-instrument"><div class="fly-pedal fly-brake" role="meter" aria-label="Brake" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><span>BRAKE</span></div><div class="fly-instrument"><div class="fly-pedal fly-throttle" role="meter" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><span>THROTTLE</span></div>`;
    this.wheel = this.element.querySelector('.fly-wheel')!;
    this.brake = this.element.querySelector('.fly-brake')!;
    this.throttle = this.element.querySelector('.fly-throttle')!;
  }

  update(input: VehicleInput) {
    const angle = Math.round(input.steering * 120);
    this.wheel.style.transform = `rotate(${angle}deg)`;
    this.wheel.setAttribute('aria-label', angle === 0 ? 'Steering centered' :
      `Steering ${Math.abs(angle)} degrees ${angle > 0 ? 'right' : 'left'}`);
    for (const [pedal, value] of [[this.brake, input.brake], [this.throttle, input.throttle]] as const) {
      const amount = Math.max(0, Math.min(1, value));
      pedal.style.setProperty('--pressure', String(amount));
      pedal.setAttribute('aria-valuenow', String(Math.round(amount * 100)));
    }
  }
}
