"""Supervised steering readout over fixed connectome activity, with no map inputs."""
from pathlib import Path
import numpy as np


class NeuralFeatures:
    def __init__(self, model, kind='activity-voltage'):
        self.kind = kind
        if kind not in ('activity-voltage', 'membrane-change'):
            raise ValueError('Unknown neural feature representation')
        self.previous = np.zeros(len(model.visual), np.float32)
        self.filtered = np.zeros(len(model.visual), np.float32)
        pixels = model.visual_pixels.astype(np.int32)
        self.bins = (pixels[:, 0] // 4) * 32 + pixels[:, 1] // 2
        self.counts = np.maximum(np.bincount(self.bins, minlength=384), 1)

    def extract(self, model):
        if self.kind == 'membrane-change':
            voltage = model.v[model.visual]
            delta = voltage + model.spikes[model.visual] - self.previous * np.exp(-model.dt / model.tau_m)
            self.previous = voltage.copy()
            self.filtered = .5 * self.filtered + .5 * delta
            return np.concatenate([
                np.bincount(self.bins, weights=value, minlength=384) / self.counts
                for value in (delta, self.filtered)]).astype(np.float32)
        # Spatial pools preserve retinal topology; values come from simulated cells.
        activity = np.bincount(self.bins, weights=model.activity[model.visual], minlength=384) / self.counts
        voltage = np.bincount(self.bins, weights=model.v[model.visual], minlength=384) / self.counts
        return np.concatenate((activity, voltage)).astype(np.float32)


class TrainedReadout:
    def __init__(self, path: Path, model):
        data = np.load(path, allow_pickle=False)
        if int(data['neurons']) != model.n:
            raise ValueError('Readout was trained on a different neural graph size')
        self.mean = data['mean']
        self.scale = data['scale']
        self.kind = str(data['kind']) if 'kind' in data else 'linear'
        self.layers = []
        if self.kind == 'mlp':
            for i, (inputs, outputs) in enumerate(((768,128),(128,64),(64,1))):
                w, b = data[f'w{i}'], data[f'b{i}']
                if w.shape != (inputs, outputs) or b.shape != (outputs,) or not np.isfinite(w).all() or not np.isfinite(b).all():
                    raise ValueError('Invalid trained readout layers')
                self.layers.append((w,b))
        elif self.kind == 'linear':
            self.weights = data['weights']
            self.bias = float(data['bias'])
            if self.weights.shape != (768,) or not np.isfinite(self.weights).all() or not np.isfinite(self.bias):
                raise ValueError('Invalid trained readout weights')
        else:
            raise ValueError('Unknown trained readout kind')
        if self.mean.shape != (768,) or self.scale.shape != (768,) or \
                not all(np.isfinite(value).all() for value in (self.mean, self.scale)) or np.any(self.scale <= 0):
            raise ValueError('Invalid trained readout parameters')
        self.features = NeuralFeatures(model, str(data['features']) if 'features' in data else 'activity-voltage')

    def predict(self, model):
        self.last_features = self.features.extract(model)
        x = (self.last_features - self.mean) / self.scale
        if self.kind == 'mlp':
            for i, (w,b) in enumerate(self.layers):
                x = x @ w + b
                if i < len(self.layers)-1:
                    x = np.maximum(x, 0)
            return float(np.clip(x[0], -1, 1))
        return float(np.clip(x @ self.weights + self.bias, -1, 1))
