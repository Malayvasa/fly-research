# Learned motor readout

This experiment applies the visual-readout training method to motor neurons.
The connectome and neural dynamics remain fixed. Supervised learning changes
the steering decoder, not the biological synaptic weights.

The motor decoder receives activity and membrane voltage for each cell in
the upstream model's ordered `motor_nodes` array. It receives no retinal
features, track coordinates, target steering, or game state at runtime.
Saved weights include the exact ordered motor indices; loading rejects a
different ordering. The visual decoder remains a separate model.

A second feature representation, `motor-membrane-change`, uses reset-corrected
voltage changes and their exponentially filtered history. This is the motor-cell
equivalent of the existing successful visual feature extractor; it still reads
only motor cells, not the visual decoder's features.

```text
steering target = 0.5 * learned visual output + 0.5 * learned motor output
```

Both outputs are bounded to [-1, 1], then the existing controller smoothing
is applied. The server negotiates `motorReadout: trained`; missing weights,
missing outputs, and mismatched modes fail closed. Raw-rate hybrid control is
still available explicitly and is not substituted for learned motor control.
Throttle and recovery remain separate, labeled assists.

## Training

Use the same 1,800 atlas poses and offline expert steering labels as the
original visual experiment. After ten settling ticks per pose, record five
neural observations, giving 9,000 examples. Contiguous track sectors are held
out for validation and testing. The neural seed is 64.

```sh
.venv/bin/python -m brain.train --data artifacts/training --output artifacts/training-motor --features motor-activity-voltage --settle-ticks 10
.venv/bin/python -m brain.train_mlp --data artifacts/training-motor --split sector
```

The first command also fits regularized linear candidates. The second fits
an MLP with 128 and 64 hidden units, matching the visual decoder's hidden
architecture. Motor input width is determined by the actual motor-cell count.
Retinal mirroring is prohibited for motor features.

## Running

```sh
.venv/bin/python -m brain.server --fly64 .cache/fly64 --port 8767 --readout brain/models/meadow-visual-readout.npz --motor-readout artifacts/training-motor/readout-100.npz
FLY_READOUT=hybrid FLY_MOTOR_READOUT=trained FLY_TEST_PORT=8767 node scripts/check-trained-driving.mjs
```

For a service on the normal port 8765, open
`http://127.0.0.1:5173/?opponent=fly&readout=hybrid&motorReadout=trained`.
Training accuracy alone is not evidence of successful driving or biological
validity. Motor features may not contain enough task-relevant information;
the physical driving check remains the acceptance test.

## Activity/voltage result

The graph exposes ten selected motor-output cells (20 input features). The
nonlinear decoder trained for 82 iterations on 9,000 observations. Held-out
direction accuracy was 51.75%, versus 53.41% for the majority-direction
baseline; steering MAE was 0.5727. The validation-selected linear decoder
scored 52.76% and MAE 0.5672. These results do not demonstrate useful steering
learning from activity/voltage in the selected motor cells.

Models and complete reports are preserved in `artifacts/training-motor`.
The equivalent membrane-change experiment uses:

```sh
.venv/bin/python -m brain.train --data artifacts/training --output artifacts/training-motor-current --features motor-membrane-change --settle-ticks 10
.venv/bin/python -m brain.train_mlp --data artifacts/training-motor-current --split sector
```

## Membrane-change result

The MLP trained for 42 iterations and achieved 51.57% held-out direction
accuracy, with MAE 0.5707. Its validation MAE was 0.5837. The selected linear
membrane-change model achieved 53.18% held-out direction accuracy and MAE
0.5659, with validation MAE 0.5769. Neither representation has demonstrated
useful direction prediction over the majority baseline.

The activity/voltage ridge decoder with alpha 100 had the lowest validation
MAE (0.5727) among the two representations' linear and nonlinear candidates.
It was selected for the physical 50/50 test on that basis, not test accuracy.
Its SHA-256 is
`dee71cf1e18e99bf88aafed1e8f78a4ba37773ca405010c627199378796f70d1`.
The training-label SHA-256 is
`67891a9e0eadc0b0c0c3361830d835b1cc035c37f91037f474d374273ba55c96`.
These experimental weights are not promoted over the packaged visual model.

## Physical driving result

The validation-selected motor decoder was mixed 50/50 with the packaged
visual decoder, using seed 64 and the existing throttle/speed assists.
`artifacts/driving-check-1789881240483` reached 12 ordered checkpoints,
completed zero laps, and needed one recovery. It failed the acceptance check.
The screenshot `progress-160.png` shows the live learned-motor overlay.

This experiment trains a motor readout successfully in the computational
sense, but does not establish useful motor steering or improved driving.
The next investigation is task-relevant information propagation into the
selected motor cells, not simply more epochs on the same weak features.
