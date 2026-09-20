import type { VehicleInput } from "./vehicle.ts";
export type Pad = Pick<
  Gamepad,
  "index" | "connected" | "mapping" | "axes" | "buttons"
>;
export const deadzone = (value: number, zone = 0.14) =>
  Math.abs(value) <= zone
    ? 0
    : Math.sign(value) * Math.min(1, (Math.abs(value) - zone) / (1 - zone));
export class ControllerInput {
  private index: number | null = null;
  private held = new Set<string>();
  private nextNavigation = 0;
  poll(pads: readonly (Pad | null)[], now = performance.now()) {
    const old = this.index;
    let pad = pads.find(
      (p) => p?.connected && p.index === old && p.mapping === "standard",
    );
    const disconnected = old !== null && !pad;
    if (!pad) pad = pads.find((p) => p?.connected && p.mapping === "standard");
    if (pad?.index !== old) this.held.clear();
    this.index = pad?.index ?? null;
    const value = (i: number) => pad?.buttons[i]?.value ?? 0;
    const pressed = (i: number) => pad?.buttons[i]?.pressed ?? false;
    const down = new Set<string>();
    if (pressed(0)) down.add("confirm");
    if (pressed(1)) down.add("back");
    if (pressed(9)) down.add("pause");
    if (pressed(12) || (pad?.axes[1] ?? 0) < -0.45) down.add("up");
    if (pressed(13) || (pad?.axes[1] ?? 0) > 0.45) down.add("down");
    if (pressed(14) || (pad?.axes[0] ?? 0) < -0.45) down.add("left");
    if (pressed(15) || (pad?.axes[0] ?? 0) > 0.45) down.add("right");
    const tapped = (name: string) => down.has(name) && !this.held.has(name);
    const navigation = down.has("up") ? "up" : down.has("down") ? "down" : null;
    const navigate =
      navigation !== null && (tapped(navigation) || now >= this.nextNavigation);
    if (navigate) this.nextNavigation = now + (tapped(navigation!) ? 380 : 150);
    if (!navigation) this.nextNavigation = 0;
    const actions = {
      confirm: tapped("confirm"),
      left: tapped("left"),
      right: tapped("right"),
      back: tapped("back"),
      pause: tapped("pause"),
      up: navigate && navigation === "up",
      down: navigate && navigation === "down",
    };
    this.held = down;
    const brake = Math.max(0, deadzone(value(6), 0.04));
    const input: VehicleInput = {
      steering: deadzone(pad?.axes[0] ?? 0),
      throttle: brake > 0 ? 0 : Math.max(0, deadzone(value(7), 0.04)),
      brake,
      jump: actions.confirm,
    };
    return {
      input,
      actions,
      connected: !!pad,
      disconnected,
      index: this.index,
    };
  }
}
