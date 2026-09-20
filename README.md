# Monza circuit branch

This branch recreates the actual Monza GP centerline at 5.793 km. See [geometry sources and limitations](docs/MONZA.md). Kart handling is unchanged; a lap takes about four minutes.

# Fly Racer — Meadow Circuit

A local, split-screen Three.js racing game. Level 1 is a three-lap countryside circuit with Kenney karts and scenery, Rapier ray-cast vehicle physics, and an arcade HUD confined to the bottom of the screen.

## Run

Requires Node.js 22.18+ (developed with Node 24).

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173).

```sh
npm run build
npm test
```

## Play

- Left screen: scripted practice opponent, **not a connected fly simulation**.
- Right screen: human kart.
- W accelerates; A/D steer; S brakes and then reverses; Space jumps while grounded.
- Esc opens the pause menu with Resume, Reset Position, and Restart Race.
- DualSense (standard browser gamepad mapping): left stick steers, R2 accelerates, L2 brakes/reverses, Cross jumps/confirms, Options pauses, Circle resumes, and D-pad or left stick navigates the pause menu.
- Connect over USB or Bluetooth and press a controller button with the game focused. Disconnecting pauses an active race. Keyboard controls remain available. Rumble adds light acceleration feedback and stronger impact/landing pulses where browser and controller support dual-rumble. It stops on pause, loss of focus, or disconnect. Adaptive triggers are not implemented.
- Switching away automatically pauses the race and clears held input.
- Pass all ordered checkpoint gates in order to complete a lap. Reverse crossings, repeated finish-line crossings, and skipping checkpoints do not award laps.
- Three laps finish the human race. Results include placement, total time, best lap, each lap split, recoveries, and the opponent's result (or unfinished status).

## Current scope

This implements the playable racing foundation and race presentation. Both karts use the same vehicle physics and collision geometry. The practice controller supplies the same normalized input interface as the keyboard adapter.

The original PRD is preserved in `Fly-vs-Human-Racing-Game-PRD.md`. Later user instructions override its initial UI and control proposals: equal split views (NPC left, human right), bottom-only Mario Kart World-inspired race typography and position badges, no play instructions on screen, and Space for **jump**, not handbrake. The scene uses direct Three.js and TypeScript rather than React Three Fiber.

The fly vision pipeline, neural simulation, WebSocket bridge, ablations, online multiplayer are future work. No neural activity is simulated or represented by the practice opponent.

## Implementation

- `src/world.ts`: scenery, materials, model loading, and track visuals.
- `src/track.ts`: continuous course, track sampling, and checkpoint gates.
- `src/physics.ts`: shared ground and track boundary colliders.
- `src/vehicle.ts`: Rapier suspension/engine/brakes, arcade yaw assist, jump, recovery, and chase camera.
- `src/race.ts`: ordered crossing detection, lap splits, finish time, and formatting.
- `src/main.ts`: two scissored viewports, input routing, countdown, pause, results, and replay.
- `src/gamepad.ts`: analog controller input, deadzones, button edges, and disconnect detection.

Physics runs at a fixed 60 Hz. Render interpolation and chase-camera smoothing are separate from simulation steps. GLB models and their palette textures are served locally. Google Fonts supplies the optional UI fonts, with local sans-serif fallbacks.

## Verification

`npm test` checks gate direction and width, shortcut rejection, three ordered laps, recovery bookkeeping, time formatting, real Rapier acceleration/reverse/steering/jump behavior, and three complete laps with the practice controller on the same collision course used by the browser.

Development-only `?verify=1` drives both vehicles through the real simulation at 4x simulation speed to inspect the full finish/replay presentation. It does not teleport through gates or fabricate lap times. This mode is disabled by `import.meta.env.DEV` in production. Normal play uses `/`.

## Assets

See [asset credits](docs/ASSETS.md) for source pages and included licenses.

## Experimental DualSense speaker (macOS, USB)

Run `FLY_CONTROLLER_SPEAKER=1 npm run dev` to route only the countdown tones to the controller. This builds a small CoreAudio/IOHID helper using the installed Apple command-line tools. The helper keeps one audio stream and HID connection open; LED on/off follows the audio sample clock with a 30 ms scheduling lead, avoiding per-beep process and device startup. It selects the DualSense output directly; the Mac default output stays unchanged. Engine audio remains in the browser. If the helper is unavailable or fails, countdown audio falls back to the browser. Mute applies to both. This local Vite-only bridge is not part of the production build, and does not support Bluetooth.

The helper sends speaker volume/routing fields only, based on the report layout documented by [dualsensectl](https://github.com/nowrep/dualsensectl). The light bar flashes red for each countdown beep and green for GO, then turns off. It does not change triggers, microphone configuration, or rumble.
