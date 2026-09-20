"""Adapter for an independently installed Fly64 checkout; no bundled upstream code."""
from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import sys
from .readout import TrainedReadout

import numpy as np

UPSTREAM_COMMIT = "f2f4114e53eaa326e54129f27a5383f93c6957af"
SHAPE = (256, 384, 3)
FRAME_BYTES = int(np.prod(SHAPE))
MODES = ("live", "blank", "frozen", "shuffled", "disconnected")


def load_model_class(checkout: Path):
    checkout = checkout.resolve()
    revision = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if revision != UPSTREAM_COMMIT:
        raise ValueError(f"Expected Fly64 revision {UPSTREAM_COMMIT}, got {revision}")
    changes = subprocess.check_output(
        ["git", "-C", str(checkout), "status", "--porcelain", "--", "fly64"], text=True
    ).strip()
    if changes:
        raise ValueError("Fly64 source has local changes; cannot claim pinned provenance")
    sys.path.insert(0, str(checkout))
    return importlib.import_module("fly64.model").FlyModel


class Brain:
    def __init__(self, model_class, cache: Path, fixture: bool, seed: int, mode: str):
        if mode not in MODES:
            raise ValueError("Unknown visual intervention")
        self.model = model_class(cache=cache, demo=fixture, seed=seed)
        self.mode = mode
        self.frozen = None
        self.effective_frame = None
        self.readout = None
        self.motor_readout = None
        self.motor_inputs = 'live'
        self.permutation = np.random.default_rng(seed).permutation(SHAPE[0] * SHAPE[1])
        self.model.visual_connected = mode != "disconnected"
        manifest = None if fixture else json.loads((cache / "manifest.json").read_text())
        self.metadata = {
            "readout": "descending",
            "backend": "synthetic-fixture" if fixture else "malecns",
            "upstreamCommit": UPSTREAM_COMMIT,
            "seed": seed, "mode": mode, "neuralHz": 1 / self.model.dt,
            "neurons": self.model.n, "edges": self.model.w.nnz,
            "datasetManifestSha256": None if fixture else hashlib.sha256(
                (cache / "manifest.json").read_bytes()).hexdigest(),
            "datasetSources": None if fixture else manifest["sources"],
            "datasetHashes": None if fixture else manifest["sha256"],
        }

    def transform(self, frame):
        if self.mode == "blank":
            return np.zeros(SHAPE, np.uint8)
        if self.mode == "frozen":
            if self.frozen is None:
                self.frozen = frame.copy()
            return self.frozen
        if self.mode == "shuffled":
            return frame.reshape(-1, 3)[self.permutation].reshape(SHAPE)
        return frame

    def step(self, frame):
        self.effective_frame = self.transform(frame)
        _, spikes = self.model.step(self.effective_frame)
        recent = np.stack(tuple(self.model.history)).mean(axis=0)
        pools = np.split(recent, self.model.motor_splits)
        forward, left, right, jump = [float(p.mean() / self.model.dt) for p in pools]
        result = {"forwardHz": forward, "leftHz": left, "rightHz": right,
                "jumpHz": jump, "spikeCount": len(spikes),
                "meanLuminance": self.model.mean_luminance,
                "temporalEnergy": self.model.temporal_energy}
        if self.readout is not None:
            result['steering'] = self.readout.predict(self.model)
            if self.readout.features.kind == 'visual-motor-membrane-change':
                masked = self.readout.without_motor()
                result['motorEffect'] = result['steering'] - masked if self.motor_inputs == 'live' else 0.
                if self.motor_inputs == 'mean':
                    result['steering'] = masked
        if self.motor_readout is not None:
            result['motorSteering'] = self.motor_readout.predict(self.model)
        return result

    def use_motor_patch(self, path):
        from .motor_plasticity import apply_motor_patch
        if self.metadata['backend'] != 'malecns':
            raise ValueError('Motor plasticity requires the measured MaleCNS graph')
        patch = apply_motor_patch(self.model, path, self.metadata['datasetManifestSha256'], UPSTREAM_COMMIT)
        self.metadata.update(readout='plastic-motor', motorPatchSha256=patch['motorPatchSha256'],
                             motorLearning=patch['method'], throttleMode='neural')

    def use_readout(self, path):
        if self.metadata['backend'] != 'malecns':
            raise ValueError('The trained readout requires the measured MaleCNS graph')
        self.readout = TrainedReadout(path, self.model)
        if hasattr(self.readout.features, 'nodes'):
            raise ValueError('Visual readout cannot use motor features')
        self.metadata['readout'] = 'trained'
        self.metadata['readoutSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()

    def use_combined_readout(self, path, motor_inputs='live'):
        if self.metadata['backend'] != 'malecns' or motor_inputs not in ('live', 'mean'):
            raise ValueError('Invalid combined readout session')
        readout = TrainedReadout(path, self.model)
        if readout.features.kind != 'visual-motor-membrane-change':
            raise ValueError('Combined mode requires both visual and motor features')
        if (readout.provenance.get('upstreamCommit') != UPSTREAM_COMMIT or
                readout.provenance.get('datasetManifestSha256') != self.metadata['datasetManifestSha256']):
            raise ValueError('Combined readout provenance mismatch')
        self.readout, self.motor_inputs = readout, motor_inputs
        self.metadata.update(readout='combined', motorInputs=motor_inputs,
                             readoutSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                             features=readout.features.kind)

    def use_motor_readout(self, path):
        if self.metadata['backend'] != 'malecns':
            raise ValueError('Motor readout requires the measured MaleCNS graph')
        readout = TrainedReadout(path, self.model)
        if not readout.features.kind.startswith('motor-'):
            raise ValueError('Motor readout must use motor neuron features')
        self.motor_readout = readout
        self.metadata['motorReadout'] = 'trained'
        self.metadata['motorReadoutSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()

    def eye_preview(self):
        if self.effective_frame is None:
            raise ValueError("No visual frame has been processed")
        return self.model.retina.preview(self.effective_frame)
