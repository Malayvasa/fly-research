"""Paired sensory interventions with identical initial model state and seeds."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import resource
import time

import numpy as np

from .backend import Brain, SHAPE, load_model_class


def stimulus(tick: int, mirrored: bool):
    # A moving high-contrast boundary in the front face, repeated at 10 Hz.
    frame = np.full(SHAPE, 32, np.uint8)
    boundary = 32 + ((tick // 5) % 16) * 4
    front = np.full((128, 128, 3), 32, np.uint8)
    front[:, :boundary] = 230
    frame[:128, :128] = front[:, ::-1] if mirrored else front
    return frame


def trial(model_class, args, seed, condition):
    mode = {"blank": "blank", "frozen": "frozen", "shuffled": "shuffled"}.get(condition, "live")
    if condition.startswith("disconnected"):
        mode = "disconnected"
    brain = Brain(model_class, args.cache, args.fixture, seed, mode)
    rates, timings, spike_counts = [], [], []
    for tick in range(args.ticks):
        frame = stimulus(tick, condition.endswith("right"))
        before = time.perf_counter()
        result = brain.step(frame)
        timings.append((time.perf_counter() - before) * 1000)
        rates.append([result[k] for k in ("forwardHz", "leftHz", "rightHz")])
        spike_counts.append(result["spikeCount"])
    rates = np.array(rates)
    np.savez_compressed(args.output / f"seed-{seed}-{condition}.npz",
        rates=rates, compute_ms=timings, spike_counts=spike_counts)
    return rates, {"condition": condition, "seed": seed, **brain.metadata,
        "meanComputeMs": float(np.mean(timings)), "p95ComputeMs": float(np.percentile(timings, 95)),
        "computeRealTimeFactor": args.ticks * 20 / sum(timings),
        "meanRatesHz": rates.mean(axis=0).tolist()}


def run(args):
    if args.ticks < 20:
        raise ValueError("Use at least 20 ticks")
    args.output.mkdir(parents=True, exist_ok=True)
    model_class = load_model_class(args.fly64)
    conditions = ["left", "right", "blank", "frozen", "shuffled",
                  "disconnected-left", "disconnected-right", "repeat-left"]
    reports, comparisons = [], []
    frames = np.stack([stimulus(i, False) for i in range(args.ticks)])
    np.savez_compressed(args.output / "stimuli.npz", left=frames,
        right=np.stack([stimulus(i, True) for i in range(args.ticks)]))
    for seed in args.seeds:
        results = {}
        for condition in conditions:
            print(f"seed={seed} condition={condition}", flush=True)
            results[condition], report = trial(model_class, args, seed, condition)
            reports.append(report)
        # Ignore the initial rate-window fill when estimating steady effects.
        left, right = results["left"][13:], results["right"][13:]
        turn_left, turn_right = left[:, 2] - left[:, 1], right[:, 2] - right[:, 1]
        comparisons.append({"seed": seed,
            "replayIdentical": bool(np.array_equal(results["left"], results["repeat-left"])),
            "disconnectedIdentical": bool(np.array_equal(results["disconnected-left"], results["disconnected-right"])),
            "liveBlankMeanAbsoluteRateDifferenceHz": float(np.abs(left - results["blank"][13:]).mean()),
            "mirroredMeanAbsoluteTurnDifferenceHz": float(np.abs(turn_left - turn_right).mean()),
            "leftMeanTurnHz": float(turn_left.mean()), "rightMeanTurnHz": float(turn_right.mean()),
            "oppositeMeanSteeringSigns": bool(turn_left.mean() * turn_right.mean() < 0),
            "leftTicksOutsideDecoderDeadzone": int(np.count_nonzero(np.abs(turn_left) > 8 * 50 / 1100)),
            "rightTicksOutsideDecoderDeadzone": int(np.count_nonzero(np.abs(turn_right) > 8 * 50 / 1100))})
    summary = {"schema": 1, "ticksPerTrial": args.ticks, "seeds": args.seeds,
        "python": platform.python_version(), "machine": platform.machine(),
        "numpy": np.__version__, "peakProcessRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "stimuliSha256": hashlib.sha256((args.output / "stimuli.npz").read_bytes()).hexdigest(),
        "scope": "Synthetic visual boundary stimuli, not gameplay or validated bend geometry",
        "comparisons": comparisons, "trials": reports}
    (args.output / "report.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(comparisons, indent=2), flush=True)
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fly64", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path(".cache/malecns"))
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--ticks", type=int, default=150)
    parser.add_argument("--seeds", type=int, nargs="+", default=[64, 65])
    parser.add_argument("--output", type=Path, default=Path("artifacts/brain-experiment"))
    run(parser.parse_args())
