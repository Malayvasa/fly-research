# Learned visual + motor driver

This controller receives both simulated visual-cell features and simulated
motor-cell features. The complete original fly graph keeps running. The decoder
may assign zero weight to the direct motor inputs; this is intentional and was
explicitly accepted for this experiment. A running motor circuit is not, by
itself, evidence that its output improves driving.

## Implementation

The input has 768 visual features plus two features per ordered motor cell
(currently 20 motor features). Both feature sets are extracted from the same
neural tick, with separate reset-corrected voltage-change histories. No track
coordinates enter the runtime controller.

The proven visual decoder supplies a frozen 768-128-64-1 backbone. The new
motor inputs add trainable rows to its first layer, yielding 788-128-64-1 for
this graph. This permits nonlinear interaction in the shared hidden layers.
It does not force a 50/50 blend, modify the graph, or use the failed synapse
patch from the separate motor-only experiment. Only the added decoder weights
are trained in this version.

Training fits those rows against offline expert steering labels at three
regularization strengths. Validation compares them with an explicit zero-row
candidate, preserving the visual backbone if every added motor branch scores
worse. Motor-node identities, feature layout, model hash, dataset manifest,
and upstream revision are checked when negotiating a combined session.

Throttle remains the labeled 0.3 assist with an 8 m/s cutoff, as in the visual
baseline. Steering wheel/pedal instruments show the resulting commands. This
is not motor-only steering and does not implement physical leg articulation.

## Measure direct motor influence

`motorInputs=mean` replaces only the decoder's motor features with their training
means (zero after normalization). Motor neurons and their outgoing graph
connections still run normally. This is a decoder-input intervention, not an
ablation of the whole motor circuit.

The server computes the difference between live and mean-masked steering from
the same neural tick without advancing feature history twice. The browser
shows that difference as **Motor steering effect** and records it in race
diagnostics. Nonzero effect proves direct influence, not improved driving.
The offline report also shuffles motor features inside the evaluation split.

## First fit

1,800 camera poses supplied 9,000 synchronized observations. Validation steering
MAE was 0.36495 for the visual backbone. Fitted motor-input candidates scored
0.37965, 0.37188, and 0.36575. Lower is better, so validation selected zero motor
weights. Live, masked, and shuffled motor inputs consequently have identical
offline predictions, with MAE 0.35438 and direction agreement 77.63%.

These sectors are held out only from fitting the NEW motor weights. The pretrained
visual backbone may already have seen these camera poses. These scores are not
a fresh generalization benchmark for the whole controller.

The resulting claim is narrow: the full graph and motor feature extraction are
active, but the selected decoder does not use the direct motor features to steer.

## Driving validation

The packaged `brain/models/meadow-combined-readout.npz` passed three physical
race checks: seeds 64 and 65 with live motor inputs, and seed 64 with decoder
motor inputs masked. Every run completed 60 ordered checkpoints (three laps),
with zero recoveries and zero browser errors. Recorded direct motor steering
effect was exactly zero throughout all three runs. Separate lap-time differences
do not establish a motor benefit.

See `combined-training-report.json`, `combined-driving-report.json`, and the
hash-matched model manifest for the evidence and limits. The selected model
keeps the full neural graph running but steers using its visual decoder path.
This is not evidence of biological motor driving.

Validation: 34 TypeScript tests, 30 Python tests, and the production build pass.
Full samples, screenshots, and the synchronized feature dataset are preserved
under the local ignored `artifacts/` directory. The work is isolated on
`codex/visual-motor-learning`; the previous motor-only experiment remains in its
own earlier commit.

## Reproduce

Use the existing pinned Fly64 checkout, prepared MaleCNS cache, and camera
dataset. No upstream code or neural dataset is bundled in this branch.

```sh
.venv/bin/python -m brain.server --fly64 .cache/fly64 \
  --combined-readout brain/models/meadow-combined-readout.npz
npm run dev -- --port 5173 --strictPort
```

To rerun training, use `.venv/bin/python -m brain.train_combined --data artifacts/training`.
Candidate weights go to ignored `artifacts/training-combined/`; they do not replace
the packaged model automatically.

Open `http://127.0.0.1:5173/?opponent=fly&readout=combined`.
Add `&motorInputs=mean` for the explicit decoder-input masking check. Live
recording with `--record` remains limited to the previous visual/hybrid modes;
the joint trainer records its own synchronized features offline.

```sh
FLY_READOUT=combined FLY_TEST_SEED=64 node scripts/check-trained-driving.mjs
FLY_READOUT=combined FLY_TEST_SEED=65 node scripts/check-trained-driving.mjs
FLY_READOUT=combined FLY_MOTOR_INPUTS=mean node scripts/check-trained-driving.mjs
```

For isolated services, set `FLY_TEST_PORT` and `FLY_GAME_PORT` and pass the exact
preview origin with the server's `--origin` option. Do not edit served source
files during a driving check: a reload invalidates the race.
