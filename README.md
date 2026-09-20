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
- Start, pause/resume, recovery, and replay are available in the bottom bar.
- Switching away automatically pauses the race and clears held input.
- Pass all 20 checkpoint gates in order to complete a lap. Reverse crossings, repeated finish-line crossings, and skipping checkpoints do not award laps.
- Three laps finish the human race. Results include placement, total time, best lap, each lap split, recoveries, and the opponent's result (or unfinished status).

## Current scope

This implements the playable racing foundation and race presentation. Both karts use the same vehicle physics and collision geometry. The practice controller supplies the same normalized input interface as the keyboard adapter.

The original PRD is preserved in `Fly-vs-Human-Racing-Game-PRD.md`. Later user instructions override its initial UI and control proposals: equal split views (NPC left, human right), bottom-only Mario Kart World-inspired race typography and position badges, no play instructions on screen, and Space for **jump**, not handbrake. The scene uses direct Three.js and TypeScript rather than React Three Fiber.

The fly vision pipeline, neural simulation, WebSocket bridge, ablations, online multiplayer, gamepad controls, and audio are future work. No neural activity is simulated or represented by the practice opponent.

## Implementation

- `src/world.ts`: scenery, materials, model loading, and track visuals.
- `src/track.ts`: continuous course, track sampling, and checkpoint gates.
- `src/physics.ts`: shared ground and track boundary colliders.
- `src/vehicle.ts`: Rapier suspension/engine/brakes, arcade yaw assist, jump, recovery, and chase camera.
- `src/race.ts`: ordered crossing detection, lap splits, finish time, and formatting.
- `src/main.ts`: two scissored viewports, keyboard input, countdown, pause, results, and replay.

Physics runs at a fixed 60 Hz. Render interpolation and chase-camera smoothing are separate from simulation steps. GLB models and their palette textures are served locally. Google Fonts supplies the optional UI fonts, with local sans-serif fallbacks.

## Verification

`npm test` checks gate direction and width, shortcut rejection, three ordered laps, recovery bookkeeping, time formatting, real Rapier acceleration/reverse/steering/jump behavior, and three complete laps with the practice controller on the same collision course used by the browser.

Development-only `?verify=1` drives both vehicles through the real simulation at 4x simulation speed to inspect the full finish/replay presentation. It does not teleport through gates or fabricate lap times. This mode is disabled by `import.meta.env.DEV` in production. Normal play uses `/`.

## Assets

See [asset credits](docs/ASSETS.md) for source pages and included licenses.
