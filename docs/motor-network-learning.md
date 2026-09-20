# Learning inside the motor network

This experiment changes existing synapses entering the forward, left-turn, and
right-turn cells. Runtime controls come only from their rolling firing rates.
It does not blend in the visual decoder or train another motor-output decoder.
The resulting graph is a modified fly-inspired simulation, not the unchanged
measured connectome and not a model of biological learning.

## Boundary

During training, a separate unmodified simulator runs the packaged visual
decoder as a teacher. Its steering supplies desired left/right motor rates.
The forward target corresponds to 0.3 throttle through the existing neural
throttle adapter. This teaches a cruise target, not intelligent pedal use or
braking. Jump and brake remain zero.

The experimental local rule compares desired and observed motor firing rates
and adjusts incoming weights using a trace of preceding presynaptic spikes.
Only existing incoming edges of those motor cells can change. We preserve
edge locations, weight signs, and all other weights; magnitudes are bounded
between zero and four times their original magnitude by default. This local
rule is a first experiment, with no guarantee of convergence or useful learning.

At runtime the patch is frozen. There is no teacher, learned visual steering,
track target, or online learning. `plastic-motor` explicitly negotiates a patch
hash and neural throttle. Missing patches fail closed. Graph hash, dataset
manifest, motor identities, and weight bounds are checked before installation.
Ordinary visual and hybrid modes remain unchanged.

The existing wheel and pedal instruments display the resulting controls.
Physical leg articulation is not implemented by this experiment. The game still
has its existing physics/yaw assistance and recovery mechanisms, so a run is
accepted only if the kart's total reset count is zero. There is no extra 8 m/s
throttle cutoff in this motor-only mode.

## Train and evaluate

Use the existing pinned Fly64 checkout, prepared MaleCNS cache, and camera atlas
dataset from PR #1. No upstream source or datasets are bundled here.

```sh
.venv/bin/python -m brain.train_motor_network \
  --data artifacts/training --output artifacts/motor-network \
  --epochs 3 --ticks 30
```

For a bounded first experiment, add `--max-poses 24 --epochs 2`. The limit applies
separately to each split; it is not a full training run. Track sectors define
training, validation, and test splits. Validation selects an epoch; the selected
patch is then compared with the original graph on held-out views at seeds 64 and
65. A paired disconnected-vision evaluation tests whether image-dependent
changes help, rather than merely whether the output changes. Reported agreement
is with the visual teacher, not with ground-truth driving success.

`offlineImprovement` requires lower steering error than both the baseline and
the disconnected condition for both seeds. This does not mark the model as a
successful driver: `drivingVerified` stays false until separately established.

```sh
.venv/bin/python -m brain.server --fly64 .cache/fly64 \
  --motor-patch artifacts/motor-network/motor-epoch-2.npz \
  --port 8768 --origin http://127.0.0.1:5175
npm run dev -- --port 5175 --strictPort
FLY_READOUT=plastic-motor FLY_TEST_PORT=8768 FLY_GAME_PORT=5175 \
  node scripts/check-trained-driving.mjs
```

Use the patch selected in `report.json`, not necessarily epoch 2. A driving check also fails after 90 seconds without checkpoint progress. The driving
script redirects the WebSocket port for the isolated test. For an interactive
browser use the default service port 8765, and open
`http://127.0.0.1:5173/?opponent=fly&readout=plastic-motor`.

## First measured experiment, 2026-09-20

The Mac Studio ran two epochs with 24 views per split and 30 neural ticks per
view. Training performed 720 local updates. The graph has 6,031 existing edges
entering six targeted motor cells (two forward, two left, two right); 6,029
weights changed. Epoch 2 was selected on validation error.

| Held-out neural seed | Original steering MAE | Trained steering MAE | Trained with vision disconnected |
| --- | ---: | ---: | ---: |
| 64 | 0.5126 | 0.5489 | 0.5585 |
| 65 | 0.5854 | 0.6941 | 0.5783 |

Lower is better. This candidate failed the offline improvement criterion.
Visual input changes motor output, but the learned changes do not consistently
make those changes useful. Do not promote these weights as a trained driver.
See `motor-network-smoke.json` for the full measured offline report.

The fixed-code browser run `1789884902570` passed one checkpoint, completed zero
laps, and stalled against the track boundary. It failed after 90 seconds without
checkpoint progress, with zero resets and zero browser errors. Runtime metadata
confirmed `plastic-motor`, neural throttle, and the exact selected patch hash.
See `motor-network-driving.json`; screenshots and full samples are preserved in
`artifacts/driving-check-1789884902570`. An earlier run was invalidated by a Vite
reload during file synchronization and is excluded from the evidence.

Validation: 32 TypeScript tests and a production build passed in the managed
worktree; 22 Python tests passed on the Studio, including the real upstream
vision fixture. The measured weights and training report are preserved locally
under `artifacts/motor-smoke/`. The isolated Studio checkout is
`/tmp/fly-motor-learning`; the source branch is `codex/fly-motor-learning`.

The next investigation should measure task information in the neurons feeding
these motor cells and the learning rule's ability to use it. Expanding trainable
connections upstream would be a separate experiment. Adding a hidden visual
controller at runtime would not meet the motor-only control objective.
