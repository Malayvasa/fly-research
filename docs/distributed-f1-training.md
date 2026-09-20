# Five-circuit training on two Macs

Circuit geometry is imported from local branch `codex/f1-circuit` (commit e484f3c), preserving the original meadow as the default track. The F1 training world uses that branch's scenery and metre-scale physics boundaries. No learned candidate is promoted automatically.

## Running

1. Start `npx vite --config scripts/vite-training90.config.mjs` in this worktree.
2. Open `/distributed.html?batch=UNIQUE-BATCH` and start collection.
3. Run `/tmp/fly-motor-py312/bin/python -u scripts/train-distributed.py --batch UNIQUE-BATCH`.
4. Inspect `/runs.html` for track maps and worker state. Logs and captures live under `artifacts/f1-training/`.

The coordinator assigns Monza and Interlagos to this Mac, and Silverstone, Spa, and Red Bull Ring to the Studio through Tailscale SSH. Camera collection remains local; independent full-connectome feature extraction runs on both machines. Only the completed remote features are brought back for a joint steering and target-speed readout fit. Remote code is copied into a batch-specific directory, leaving the Studio's game checkout untouched.

Each track contributes 60 deterministic three-second physical teacher episodes spread around its geometry (1800 images). Episodes begin with varied lane offset and speed. A settling period in the neural encoder reduces the discontinuity when relocating the teacher. No map coordinates are given to the readout. These are teacher demonstrations, not successful learned-driver laps. Validation and test segments contain held-out episodes on the same five circuits, not unseen-track generalization.

Training compares readouts with and without motor inputs; validation may choose zero motor influence. The motor circuit continues to run. The speed target is capped at 25 m/s (90 km/h), with slower corner labels. A deterministic speed servo converts that target to pedals.

Visible previews are Canvas 2D whole-track maps. WebGL renders the six sensor images, with a single initial static-shadow pass; no per-frame spectator render is needed. No timing speedup has been measured.

A batch completion marker is only written after all 1800 images. Existing capture files are never overwritten by the current collector; use a new batch name to restart a partial capture. A stopped collection can resume at the next untouched circuit with `&from=silverstone` (or another circuit id). Workers wait up to four hours and report failures. The combined fit runs only after all five encoders succeed. Full-lap evaluation remains required before using the saved candidate as a verified driver.

Batch f1-20260920-a: the pre-restart collector wrote Monza into the old training90-final capture location. It was identified from all 1800 labels and moved intact to its batch directory; historical learned-driver reports and cached features remain. The former raw training90-final capture was replaced, so it must not be used as original meadow evidence. The separate earlier training90 capture remains untouched.
