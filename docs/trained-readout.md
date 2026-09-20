# Trained fly steering readout

Status: experimental, not yet reliable track following. The user authorized a
supervised readout on 2026-09-20. Do not present the scripted practice controller
as neural driving or silently fall back to it.

The tested checkpoint is packaged at `brain/models/meadow-visual-readout.npz`,
with its hash, two passing race summaries, and limitations in the adjacent JSON
manifest. See `brain/models/README.md` for the runnable baseline. The historical
experiments below explain both its successes and its known failures.

The overlay now distinguishes **Learned visual driver** from **Fly motor
output**. Successful learned-driver laps do not validate motor-circuit control.
A renewed motor-only audit (`artifacts/motor-path-audit`, two seeds, 150 ticks
per trial) found repeatable visual influence and identical disconnected-input
controls. However, neither seed produced opposing mean steering signs for the
mirrored stimuli. This short synthetic-stimulus check is not a track-following
test, and does not establish useful motor steering. The motor adapter has a
regression test verifying that it ignores any learned steering field.

## Boundary

The pinned MaleCNS simulation and its synaptic weights stay fixed. A separate
ridge or small MLP readout learns steering from spatial pools of simulated
photoreceptor activity and membrane state. It does not read track position,
waypoints, checkpoints, or expert actions at runtime. This is an engineered
early-visual readout, not evidence that biological descending neurons learned
to drive. The panel's descending-pool meters remain real diagnostics but do not
directly produce the learned steering value.

Throttle is an explicit 0.3 assist with an 8 m/s speed cutoff. A six-second
low-speed stall triggers the existing game recovery and is counted visibly.
Recovery is not neural behavior and disqualifies a reliability run.

## Training

Install `brain/requirements-training.txt` in the existing virtual environment.
The capture script needs Playwright with Chrome; set `PLAYWRIGHT_MODULE` to an
installed Playwright module path if it is not a local dependency.

```sh
npx vite --config scripts/vite-training.config.mjs --port 5174 --strictPort
node scripts/collect-training.mjs
.venv/bin/python -m brain.train --features membrane-change --settle-ticks 10 --output artifacts/training-settled
.venv/bin/python -m brain.train_mlp --data artifacts/training-settled
```

Capture produces 1,800 deterministic camera poses around this circuit, with
lateral offsets up to 6 m and heading offsets up to 0.55 radians. Expert targets
use 12 m lookahead only during dataset generation. Five neural observations are
recorded per pose. Optional settling discards artificial pose-jump transients.

The default split holds out entire track sectors. `train_mlp --split frame`
instead holds out camera poses across the known circuit, grouping all five
ticks from a pose together. These answer different questions; do not compare
them as the same benchmark. Repeatedly inspected test sets are exploratory,
not a fresh final evaluation. Models, frames, reports and images stay in ignored
`artifacts/`; trained weights are not currently distributed in Git.

## Running and checking

```sh
.venv/bin/python -m brain.server --fly64 .cache/fly64 --readout artifacts/training-settled/readout-1000.npz
npm run dev -- --port 5173 --strictPort
node scripts/check-trained-driving.mjs
```

Choose the actual candidate filename from the training report; the path above
is an example, not a validated winner. Open
`http://127.0.0.1:5173/?opponent=fly&readout=trained` for the labeled mode.
The service advertises the model file SHA-256. Missing files and readout-mode
mismatches fail closed. The driving check requires three ordered laps with zero
recoveries and records screenshots plus full telemetry in a timestamped folder.
Further reliability evidence should include repeated runs, varied starting
poses, neural seeds, and sensory interventions.

## Results so far

The first activity/voltage ridge readout achieved about 76% steering-sign
agreement on held-out sectors. In Chrome it passed 12 checkpoints, then stalled
at the tight S-bend and needed two recoveries. A reset-corrected membrane-change
ridge readout also reached 12 checkpoints and needed two recoveries by 64.9 s.
Neither completed a lap. Nonlinear candidates overfit the training observations;
low training error is not a success criterion. Settled-input training is the
next experiment, not an established fix.

Settled-input follow-up: ten discarded ticks per random camera jump improved
ridge held-out steering-sign agreement to 84.4%. Its physical run completed a
lap in 89.25 seconds with one recovery, then needed a second recovery at the
same S-bend on lap two. The known-circuit MLP completed a lap in 88.45 seconds,
also with one recovery. Both fail the zero-recovery gate. Full replay evidence
is in `artifacts/driving-check-1789876752785` and
`artifacts/driving-check-1789876935624` respectively.

An additional capture mismatch was found: the original dataset omitted shadows,
while the live renderer enables PCF soft shadows. Simply enabling shadows in the
collector is insufficient because FlyVision reuses a previously rendered shadow
map. The intermediate `artifacts/training-shadows` dataset lacked this prepass
and its training run was deliberately stopped. Do not use it. The collector now
renders a world prepass before capturing eyes; corrected data is recorded in
`artifacts/training-shadow-baked`. All 1,800 poses match the original dataset;
the file is 530,841,600 bytes. Comparison at every thirtieth pose shows only
0.268% of pixels change by more than five RGB levels, with mean absolute change
0.0895/255. Thus shadows are not supported as the primary failure explanation.
The next targeted experiment should use the actual off-center and misaligned
states in the S-bend replays, rather than only random near-track poses.

## Failure-replay iteration

The collector accepts `TRAINING_REPLAY=/path/to/results.json` and captures 1,800
jittered examples around moving states in sectors spanning u=0.48 to 0.73.
Targets use nearest-track lookahead at each exact captured position and heading.
The resulting `artifacts/training-replay` dataset was encoded with ten settling
ticks and five recorded ticks per image. Its features were combined with the
original settled dataset using:

```sh
.venv/bin/python -m brain.train_mlp --data artifacts/training-replay --append artifacts/training-settled --split frame
```

The combined readout trained on 18,000 neural observations and achieved 88.3%
held-out steering-sign agreement. Nearby replay jitters make this an optimistic
offline measure, not independent evidence of driving reliability. The fresh run
in `artifacts/driving-check-1789878030994` failed after 12 checkpoints with one
recovery, before finishing a lap. The benchmark now stops on the first recovery.
This candidate is not a validated upgrade.

Next: record the exact neural features and matching camera-frame poses during
live driving. The current static, settled-image encoding does not reproduce
the temporal visual activity present during turns. Test that distribution
mismatch with recorded data rather than assuming more static poses will fix it.

## First zero-recovery race

The same replay-combined model subsequently passed a full three-lap check in
`artifacts/driving-check-1789878276476`: 79.6833, 78.3500, and 90.8833 seconds,
60 ordered checkpoints, zero resets, and no browser errors. This is a verified
successful run, not yet a repeatable reliability result: the same model failed
in the previous run. Neural seed was 64. Repeat with other seeds using
`FLY_TEST_SEED=65` in the browser benchmark; the browser exposes `flySeed` in the
query string and validates its range before the normal seed handshake.

The optional service `--record artifacts/live-neural` captured 11,674 exact
neural feature vectors linked to 2,321 camera-frame poses in that run. Logging
is bounded, local, and off by default; it does not change the controls. Use
`scripts/label-camera-poses.mjs` to compute expert targets offline, then
`brain.prepare_live` to join by frame ID and verify model, dataset, and seed
provenance. New recordings also carry a unique session identifier to prevent
mixing identical-model sessions. The first prepared live dataset is
`artifacts/training-live`; no samples were truncated. Its frame IDs, rather than
an assumed five ticks per frame, define grouped training splits.

Repeat check: seed 65 also completed three laps with zero resets and no browser
errors in `artifacts/driving-check-1789878821177`. Splits were 79.9333, 77.0167,
and 78.3833 seconds, with 60 ordered checkpoints. The readout and assists were
unchanged. The unique-session join produced `artifacts/training-live-seed65`
with 11,039 observations from 2,194 camera poses and no truncation. Thus there
are two successful three-lap checks across seeds 64 and 65, as well as recorded
earlier failures. This is evidence for the learned visual driver only; it must
not be attributed to independent fly motor-circuit control.

For the first successful run, recomputing the model on the captured live
features gave steering-target MAE 0.2689 and sign agreement 78.66%, versus the
88.26% held-out score from static training. These datasets have different state
distributions, so the comparison is diagnostic rather than a controlled causal
test. It reinforces the need for closed-loop driving checks.
