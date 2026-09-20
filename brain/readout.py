"""Supervised steering readout over fixed connectome activity, with no map inputs."""
from pathlib import Path
import json
import numpy as np


class NeuralFeatures:
    def __init__(self, model, kind='activity-voltage'):
        self.kind = kind
        if kind == 'visual-motor-membrane-change':
            self.visual_features = NeuralFeatures(model, 'membrane-change')
            self.motor_features = NeuralFeatures(model, 'motor-membrane-change')
            self.nodes = self.motor_features.nodes
            self.size = self.visual_features.size + self.motor_features.size
            return
        if kind not in ('activity-voltage', 'membrane-change', 'motor-activity-voltage', 'motor-membrane-change'):
            raise ValueError('Unknown neural feature representation')
        if kind.startswith('motor-'):
            self.nodes = np.asarray(model.motor_nodes, dtype=np.int64).copy()
            self.size = 2 * len(self.nodes)
            self.previous = np.zeros(len(self.nodes), np.float32)
            self.filtered = np.zeros(len(self.nodes), np.float32)
            return
        self.size = 768
        self.previous = np.zeros(len(model.visual), np.float32)
        self.filtered = np.zeros(len(model.visual), np.float32)
        pixels = model.visual_pixels.astype(np.int32)
        self.bins = (pixels[:, 0] // 4) * 32 + pixels[:, 1] // 2
        self.counts = np.maximum(np.bincount(self.bins, minlength=384), 1)

    def extract(self, model):
        if self.kind == 'visual-motor-membrane-change':
            return np.concatenate((self.visual_features.extract(model), self.motor_features.extract(model)))
        if self.kind == 'motor-activity-voltage':
            return np.concatenate((model.activity[self.nodes], model.v[self.nodes])).astype(np.float32)
        if self.kind in ('membrane-change', 'motor-membrane-change'):
            nodes = self.nodes if self.kind == 'motor-membrane-change' else model.visual
            voltage = model.v[nodes]
            delta = voltage + model.spikes[nodes] - self.previous * np.exp(-model.dt / model.tau_m)
            self.previous = voltage.copy()
            self.filtered = .5 * self.filtered + .5 * delta
            if self.kind == 'motor-membrane-change':
                return np.concatenate((delta, self.filtered)).astype(np.float32)
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
        self.features = NeuralFeatures(model, str(data['features']) if 'features' in data else 'activity-voltage')
        size = self.features.size
        if hasattr(self.features, 'nodes') and (
                'motorNodes' not in data or not np.array_equal(data['motorNodes'], self.features.nodes)):
            raise ValueError('Readout motor neuron identities do not match')
        self.mean = data['mean']
        self.scale = data['scale']
        self.provenance = json.loads(str(data['provenance'])) if 'provenance' in data else {}
        self.kind = str(data['kind']) if 'kind' in data else 'linear'
        self.speed_output = 'outputs' in data and data['outputs'].tolist() == ['steering', 'targetSpeedNormalized']
        self.layers = []
        if self.kind == 'mlp':
            for i, (inputs, outputs) in enumerate(((size,128),(128,64),(64,2 if self.speed_output else 1))):
                w, b = data[f'w{i}'], data[f'b{i}']
                if w.shape != (inputs, outputs) or b.shape != (outputs,) or not np.isfinite(w).all() or not np.isfinite(b).all():
                    raise ValueError('Invalid trained readout layers')
                self.layers.append((w,b))
        elif self.kind == 'linear':
            self.weights = data['weights']
            self.bias = float(data['bias'])
            if self.weights.shape != (size,) or not np.isfinite(self.weights).all() or not np.isfinite(self.bias):
                raise ValueError('Invalid trained readout weights')
        else:
            raise ValueError('Unknown trained readout kind')
        if self.mean.shape != (size,) or self.scale.shape != (size,) or \
                not all(np.isfinite(value).all() for value in (self.mean, self.scale)) or np.any(self.scale <= 0):
            raise ValueError('Invalid trained readout parameters')

    def predict(self, model):
        self.last_features = self.features.extract(model)
        return self.predict_features(self.last_features)

    def predict_target_speed(self):
        if not self.speed_output:
            return None
        return float(np.clip(self.predict_vector(self.last_features)[1], 0, 1) * 25)

    def predict_features(self, features):
        return float(np.clip(self.predict_vector(features)[0], -1, 1))

    def predict_vector(self, features):
        """Score an already extracted tick without advancing feature history."""
        x = (features - self.mean) / self.scale
        if self.kind == 'mlp':
            for i, (w,b) in enumerate(self.layers):
                x = x @ w + b
                if i < len(self.layers)-1:
                    x = np.maximum(x, 0)
            return x
        return np.asarray([x @ self.weights + self.bias])

    def without_motor(self):
        if self.features.kind != 'visual-motor-membrane-change':
            raise ValueError('Motor masking requires combined features')
        features = self.last_features.copy()
        features[768:] = self.mean[768:]
        return self.predict_features(features)
