# Hybrid motor and visual steering

The hybrid combines two actual inputs to the steering command:

```text
motor = clamp((right motor-pool Hz - left motor-pool Hz) * existing motor gain, -1, 1)
steering target = 0.50 * learned visual steering + 0.50 * motor
```

The existing time-based smoothing follows the blend. The visual branch uses
the packaged readout over simulated visual neurons. The motor branch uses
descending motor-pool firing rates directly, without another learned driver.
Fifty percent is a user-selected engineering setting, not a biological constant
or a claim that the motor branch understands the road. Both sources genuinely
affect the output; tests independently vary and remove their contributions.

The protocol explicitly negotiates `readout: hybrid` and `motorShare: 0.5`.
Missing or invalid visual steering, invalid motor rates, mismatched settings,
and stale frames fail closed. Neither the visual-only nor the motor-only path
is silently substituted. Throttle, the 8 m/s cutoff, and counted stuck recovery
remain separate assists. The UI labels this mode **Hybrid motor + visual**.

Run the usual brain service with the packaged visual readout, then open
`http://127.0.0.1:5173/?opponent=fly&readout=hybrid`. For an isolated driving
check, start the service on port 8766 and use:

```sh
FLY_READOUT=hybrid FLY_TEST_PORT=8766 node scripts/check-trained-driving.mjs
```

Set `PLAYWRIGHT_MODULE` if Playwright is installed outside this repository.
The visual-only model's passing runs are not hybrid evidence; the hybrid must
pass its own three-lap, zero-recovery checks.

## Initial validation

The initial 80/20 run (`artifacts/driving-check-1789879665604`) reached
13 checkpoints before one recovery, with no completed lap. This is a working
dual-input controller, not yet reliable hybrid track following. The previous
visual-only successful runs do not establish hybrid reliability. Motor-pool
contribution to steering also does not establish biological road understanding.

## Equal-weight training experiment

The current default is 50/50, including the handshake and overlay. Regression
tests verify that each branch alone contributes half-scale steering and that
opposing signals cancel according to the documented formula.

An additional visual readout was trained with:

```sh
.venv/bin/python -m brain.train_mlp --data artifacts/training-live --append artifacts/training-settled --split sector
```

This uses 20,674 observations, a 768-128-64-1 MLP, and held-out track sectors.
The candidate is `artifacts/training-live/readout-mlp-combined.npz`; its report
is `artifacts/training-live/mlp-combined-report.json`. Test steering MAE was
0.2526 and direction accuracy 78.31%. These are offline prediction metrics,
not driving success rates. The motor circuit was not trained in this pass.

With seed 64 and unchanged driving assists:

| Visual weights in the 50/50 blend | Checkpoints | Laps | Recoveries | Evidence |
| --- | ---: | ---: | ---: | --- |
| Packaged baseline | 12 | 0 | 1 | `artifacts/driving-check-1789880150403` |
| Retrained candidate | 13 | 0 | 1 | `artifacts/driving-check-1789880220210` |

One run per model is insufficient to establish an improvement. Neither
passed the acceptance check. The packaged visual-only weights are untouched;
the candidate remains experimental. Equal blending limits the visual branch's
ability to correct neutral or opposing motor output, so more visual training
alone is not established as a solution.

The subsequent separately trained motor decoder and its results are described
in [Learned motor readout](learned-motor-readout.md). It is enabled explicitly
with `motorReadout=trained`; this does not silently replace the raw-rate mode.
