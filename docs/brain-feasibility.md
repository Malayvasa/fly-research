# Studio neural service: first feasibility result

Measured on the Mac Studio (Apple M1 Max), 2026-09-20. The service now loads and
steps the official MaleCNS graph through an independently installed, pinned Fly64
checkout. No Mario binary or game assets are required. Fly64 source is not bundled
in this repository; resolve its reuse terms before distributing it with the game.

## What ran

- Official MaleCNS v1.0 data, 166,700 retained neurons, 25,582,938 connections.
- Seeds 64 and 65; 150 steps per trial (3 simulated seconds); eight conditions
  per seed: moving left/right boundary, blank, frozen, shuffled pixels,
  disconnected-left/right, and repeat-left.
- A 13-step startup window excluded from effect summaries.
- Exact input arrays and raw forward/left/right rates saved as compressed NPZ.
- Simulation metadata includes source URLs, source hashes, pinned upstream
  revision and the prepared manifest hash.

## Observations

| Measure | Seed 64 | Seed 65 |
| --- | --- | --- |
| Same-seed repeated rate trace identical | Yes | Yes |
| Mirrored rate traces identical with vision disconnected | Yes | Yes |
| Live-vs-blank mean absolute pool-rate difference | 0.505 Hz | 0.524 Hz |
| Mirrored mean absolute steering-rate difference | 1.418 Hz | 1.277 Hz |
| Mean right-minus-left rate, left stimulus | -0.561 Hz | +0.154 Hz |
| Mean right-minus-left rate, right stimulus | -0.519 Hz | +0.337 Hz |
| Opposite average steering directions | No | No |

This demonstrates sensory influence on motor-pool rates in these short trials.
It does not demonstrate lane following or useful bend response. Both images
retain the same mean turn sign within each seed. Do not tune steering inversion
or announce a successful racing controller based on these results.

Mean compute time was 7.63-8.90 ms per step across trials; p95 was 8.57-10.01 ms.
The 50 Hz simulation target allows 20 ms. Compute-only throughput therefore has
headroom on this machine. Peak process RSS was about 0.782 GB. These timings
exclude browser rendering, network transfer, initialization, and data preparation.

The real-backend WebSocket smoke test sent 20 frames and received 112 ordered
activity packets over 2.44 seconds, including the final stale-camera timeout.
Mean computation in that loop was 8.25 ms. It correctly stopped output after the
camera expired. Source-frame age p95 was 383 ms including deliberate camera
silence; this is not a network round-trip measurement. Raw smoke results are in
`artifacts/brain-service-smoke.json`.

Raw report: `artifacts/brain-experiment/report.json`. The separate fixture run in
`artifacts/brain-fixture` tests the harness only and is not connectome evidence.
Experiment artifacts and roughly 1.2 GB of source data are intentionally local.

## Run locally

Requires Python 3.12+ and a project virtual environment. Installed/tested here
with Python 3.14.7; package versions are in `brain/requirements.txt`.
The pinned external checkout is `.cache/fly64`, prepared data `.cache/malecns`.

```sh
.venv/bin/python -m brain.server --fly64 .cache/fly64
.venv/bin/python -m brain.smoke
.venv/bin/python -m brain.experiment --fly64 .cache/fly64 --ticks 150 --seeds 64 65
.venv/bin/python -m pytest brain -q
```

The server binds `127.0.0.1:8765`, accepts one session at a time, negotiates a
protocol-1 hello, and reports backend identity before accepting frames. See
[the handoff contract](fly-controller-handoff.md) for wire format.

Supported vision modes: live, blank, frozen, shuffled and disconnected. Graph
shuffling is not implemented. No automatic synthetic fallback exists. A stale
camera produces a `stale` message and stops advancing the brain; the browser must
release controls. A reconnect creates a new seeded model.

Browser origins currently allowed: `http://127.0.0.1:5173` and
`http://localhost:5173`. Adjust the explicit allowlist when the frontend port is
known. The MacBook can reach a running Studio service without exposing a public
port using this command in a Studio terminal:

```sh
ssh -i ~/.ssh/macbook_codex -o ExitOnForwardFailure=yes -N \
  -R 127.0.0.1:8765:127.0.0.1:8765 malayvasa@100.122.178.30
```

The MacBook browser then connects to `ws://127.0.0.1:8765`. This tunnel has not
yet been exercised with the actual game. The smoke command starts and closes its
own temporary local service, exercising the real brain through WebSockets.

## Next research decision

Extended run: five seeds (64-68), 500 steps / 10 simulated seconds per condition,
40 trials total. All five repeated traces were identical and all disconnected
mirrored pairs were identical. Live-vs-blank mean absolute rate differences were
0.569-0.608 Hz. Only two of five seeds produced opposite mean steering signs,
and those two disagreed on which image should cause a positive turn:

| Seed | Left image mean turn Hz | Right image mean turn Hz |
| --- | --- | --- |
| 64 | -0.332 | -0.407 |
| 65 | +0.087 | +0.012 |
| 66 | -0.091 | +0.111 |
| 67 | +0.166 | -0.016 |
| 68 | +0.138 | +0.103 |

This reinforces the lack of a reliable directional response for this stimulus.
Raw extended results: `artifacts/brain-extended/report.json`. These are a small
exploratory sample, not a statistical validation or real track-following test.

Test longer, more seeds, and proper optic-flow/bend sequences captured by the
game's calibrated six-face camera. Compare pool-level left/right activity and
baseline drift before changing decoder gains. If the untrained mapping remains
directionally unreliable, retain it as the scientific mode and keep the scripted
NPC separately labeled. A learned readout would be an explicit later experiment.
