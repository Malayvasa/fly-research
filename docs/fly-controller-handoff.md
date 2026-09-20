# NPC and fly controller implementation brief

Read against the PRD on 2026-09-20. Studio owns the neural service, decoder,
experiments and protocol. MacBook owns rendering, camera capture, vehicle physics,
race UI and connecting the browser client. This document specifies the proposed
integration contract. The local WebSocket service now runs the measured graph;
browser camera capture and the client connection remain to be integrated.

## Current state

Both machines share https://github.com/Malayvasa/fly-research. The Studio's
`codex/mac-studio` branch is based on the MacBook's committed racing prototype
(`dfa1e1a`). Controller changes can be reviewed and merged through Git; there is
no live folder synchronization. Keep rendering work on the MacBook and controller
work on the Studio's branch, and fetch before integrating shared changes.

`Kart.npcInput()` uses nearest-track position, a speed-dependent lookahead and
heading error. It is a scripted practice opponent. Preserve it as an explicitly
named baseline. Neural mode must receive camera pixels, not track coordinates,
waypoints, checkpoints, rewards or the practice controller's suggested action.
On neural-service failure, expose offline state; do not silently use the NPC.

`src/fly-controller.ts` implements the readout adapter only, with validated rates,
bounded outputs, time-based smoothing, dead zone, packet ordering and a local
250 ms watchdog. It returns the existing `VehicleInput`, including `jump: false`.
It has no network connection and makes no claim of simulating neurons.

## Source findings

Inspected Fly64 commit `f2f4114e53eaa326e54129f27a5383f93c6957af`:

- [Model](https://github.com/ornata/fly/blob/f2f4114e53eaa326e54129f27a5383f93c6957af/fly64/model.py)
  exposes a simulation independent of Mario through `FlyModel.step(rgb)`.
- [Retina](https://github.com/ornata/fly/blob/f2f4114e53eaa326e54129f27a5383f93c6957af/fly64/retina.py)
  expects a top-down RGB atlas, 384 x 256 pixels, with six 128 x 128 faces.
  Rows are front/right/back and left/up/down. A single chase-camera image is
  incompatible with this encoder.
- [Technical notes](https://github.com/ornata/fly/blob/f2f4114e53eaa326e54129f27a5383f93c6957af/docs/technical-notes.md)
  report 166,700 modeled cells and 25,582,938 retained connections. These are
  upstream counts, not a local performance measurement. Dynamics run at 50 Hz;
  images at 10 Hz; readout uses a 13-tick window. The model adds tonic drive and
  seeded noise, so blank imagery need not produce zero movement.
- Upstream pools: DNg100 forward, DNa02/DNg13 left/right, DNp01/DNp10 jump.
  Upstream rates are spikes/cell/tick. Multiply by 50 to send Hz. Pool activity
  must be exposed before Mario-specific stick rounding and filtering.
- [MaleCNS downloads](https://male-cns.janelia.org/download/) provide annotations,
  transmitter predictions and a roughly 1.1 GB connection table under CC-BY.
  The inspected Fly64 checkout has no top-level license file. Resolve source
  reuse terms before vendoring/distributing it; data licensing is separate.

## Proposed browser/service contract

One isolated model state per race session. Negotiate protocol version 1 and
backend identity (`malecns` or explicitly `synthetic-fixture`) before accepting
controls. Include dataset hash, controller version, seed and experiment mode in
the session metadata. A fixture must never be labeled as the biological graph.

Browser sends a binary frame: 4-byte little-endian unsigned frame ID followed by
294,912 tightly packed RGB8 bytes for the atlas above. Start IDs at zero for each
connection; reconnect before unsigned rollover. Record local `performance.now()`
at capture for each pending ID. At 10 Hz the raw payload is about 2.95 MB/s.
Avoid unbounded queues: keep one pending latest frame and apply backpressure.

Render at car eye height with level horizon and vehicle-relative heading. Hide
the car's own mesh and HUD. Convert WebGL's bottom-up rows to top-down and verify
face orientations with directional markers before wiring up neural input.
The displayed eye preview must derive from the exact transmitted pixels.

Service runs a fixed 20 ms neural step, reusing the latest complete frame. It
returns JSON with these fields at each completed step:

```json
{
  "sequence": 0,
  "frameId": 0,
  "forwardHz": 1.2,
  "leftHz": 0.8,
  "rightHz": 1.1
}
```

`sequence` increases per neural tick; repeated `frameId` is expected between
captures. Do not compare monotonic timestamps from two machines. The browser
measures capture-to-reply age using the echoed ID and its own capture clock.
Reject unknown frame IDs and responses whose source image is over 500 ms old
before calling `accept()`. Even fresh packets can refer to a stalled camera.
The adapter's 250 ms watchdog independently protects against lost responses.
These are starting thresholds to tune after measuring latency.

Browser integration at the physics boundary:

```ts
const fly = new FlyController();
// After session, frame-ID and source-frame-age validation:
fly.accept(JSON.parse(message.data), performance.now());
// Each physics tick:
const input = fly.step(dt, performance.now(), raceIsActive);
// On close, reset or session change:
fly.reset();
```

Catch malformed JSON in the transport. On pause stop capture and neural stepping;
on resume start a fresh seeded session, or explicitly record continuation state.
Only apply outputs while racing. Recovery remains a separate, labeled game assist
and must appear in telemetry. Coordinate TLS/origin handling before remote browser
hosting; initially use an SSH tunnel to a loopback service on the Studio.

## Motor mapping decisions

Begin with neural steering and fixed 0.3 throttle, capped at 0.5. Label the mode
as assisted throttle. Optional neural throttle uses DNg100 with configurable
threshold and full-scale rate. All constants are engineering hypotheses.
Right-minus-left maps to positive steering, which the existing physics test
identifies as a right turn. Verify with camera stimuli; support inversion.

No inferred biological brake pool is implemented. Current `Kart.step()` treats
brake as reverse at low speed and prioritizes throttle over brake. A sustained
brake fallback would reverse the car. The adapter therefore returns neutral on
failure (coasting, not an immediate stop); the game can explicitly disable the
kart through its `active` argument to apply its existing hold brake.
Jump defaults off for racing. Stuck detection and resets are not neural outputs.

## Next feasibility experiment

Initial experiments and run commands are recorded in
[the Studio feasibility report](brain-feasibility.md). Visual influence was
measured; consistent directional steering has not been established.

1. Resolve reuse terms; prepare a provenance-recorded MaleCNS cache or implement
   against the licensed data directly. Do not substitute a random graph silently.
2. Profile initialization, memory and actual neural step time on this M1 Max.
   A 50 Hz target is not yet a verified capability of this machine.
3. Present mirrored high-contrast bend stimuli with identical seeds, duration
   and initial state. Compare raw left/right pools and unclamped differential,
   before the decoder's dead zone hides small effects.
4. Repeat with blank, frozen and spatially shuffled frames, and multiple seeds.
   Reset dynamics, retina history and readout history between paired conditions.
5. Log full config, dataset hash, exact input frames, per-step rates and controls.
   Report direction consistency, control effect size and latency. Differences
   alone do not establish useful steering or biological fidelity.
6. Add a specified seeded graph shuffle as a separate topology experiment after
   live-vs-blank testing. Document which degree/sign/weight properties it preserves.

The phase-0 gate is repeatable visual influence on descending activity at usable
latency. Consistent steering direction is a further gate before claiming the car
can follow bends. No lap completion or trained racing ability is assumed.
