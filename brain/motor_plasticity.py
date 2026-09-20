"""Experimental local learning on EXISTING synapses entering motor cells.

This is an engineered learning rule, not a claim about biological plasticity.
The teacher exists only in the trainer. Runtime consumes a frozen weight patch.
"""
import hashlib
import json
from pathlib import Path

import numpy as np


STEERING_GAIN = 1100 / (50 * 70)


def target_rates(steering, throttle=.3):
    """Invert the browser's fixed motor-to-control adapter, in Hz."""
    if not np.isfinite(steering) or abs(steering) > 1 or not 0 <= throttle <= .5:
        raise ValueError('Invalid teacher controls')
    difference = steering / STEERING_GAIN
    return np.array([.4 + throttle / .5 * (2.15 - .4),
                     2 - difference / 2, 2 + difference / 2], dtype=np.float32)


def graph_hash(matrix):
    digest = hashlib.sha256()
    for value in (np.asarray(matrix.shape, dtype='<i8'), matrix.indptr.astype('<i8'),
                  matrix.indices.astype('<i8'), matrix.data.astype('<f4')):
        digest.update(value.tobytes())
    return digest.hexdigest()


class MotorPlasticity:
    def __init__(self, model, learning_rate=.05, max_factor=4.):
        if not np.isfinite(learning_rate) or learning_rate <= 0 or \
                not np.isfinite(max_factor) or not 1 <= max_factor <= 10:
            raise ValueError('Invalid learning bounds')
        if model.w.format != 'csc':
            raise ValueError('Expected upstream CSC graph')
        self.model = model
        self.learning_rate, self.max_factor = learning_rate, max_factor
        self.groups = [np.asarray(nodes, dtype=np.int64) for nodes in
                       (model.forward, model.turn_left, model.turn_right)]
        nodes = np.concatenate(self.groups)
        if any(len(group) == 0 for group in self.groups) or len(np.unique(nodes)) != len(nodes):
            raise ValueError('Motor groups must be nonempty and disjoint')
        self.nodes = nodes
        self.base_hash = graph_hash(model.w)
        self.positions = np.flatnonzero(np.isin(model.w.indices, nodes))
        if not len(self.positions):
            raise ValueError('No existing incoming motor connections')
        self.pre = np.searchsorted(model.w.indptr, self.positions, side='right') - 1
        lookup = np.full(model.n, -1, dtype=np.int64)
        lookup[nodes] = np.arange(len(nodes))
        self.post = lookup[model.w.indices[self.positions]]
        self.base = model.w.data[self.positions].copy()
        self.trace = np.zeros(model.n, dtype=np.float32)
        self.updates = 0

    def observe_presynaptic(self):
        # Observe BEFORE model.step: these are the spikes that enter this tick.
        self.trace *= np.exp(-self.model.dt / .1)
        self.trace += self.model.spikes

    def learn(self, steering, throttle=.3):
        desired = target_rates(steering, throttle)
        recent = np.stack(tuple(self.model.history)).mean(axis=0) / self.model.dt
        # Upstream motor_nodes order is forward, left, right, jump.
        if not np.array_equal(self.model.motor_nodes[:len(self.nodes)], self.nodes):
            raise ValueError('Unexpected motor ordering')
        target = np.repeat(desired, [len(group) for group in self.groups])
        error = (target - recent[:len(self.nodes)]) * self.model.dt
        eligibility = self.trace[self.pre] * np.abs(self.base)
        norm = np.bincount(self.post, weights=eligibility, minlength=len(self.nodes))
        delta = self.learning_rate * error[self.post] * eligibility / np.maximum(norm[self.post], 1e-8)
        weights = self.model.w.data[self.positions] + delta
        bound = self.max_factor * np.abs(self.base)
        # Preserve inhibitory/excitatory signs, topology, and all other synapses.
        weights = np.clip(weights, np.where(self.base < 0, -bound, 0),
                          np.where(self.base > 0, bound, 0))
        self.model.w.data[self.positions] = weights
        self.updates += 1

    def save(self, path: Path, provenance: dict):
        path.parent.mkdir(parents=True, exist_ok=True)
        metadata = {**provenance, 'schema': 1, 'baseGraphSha256': self.base_hash,
                    'neurons': self.model.n, 'dt': self.model.dt,
                    'maxFactor': self.max_factor, 'learningRate': self.learning_rate,
                    'updates': self.updates, 'method': 'bounded-local-motor-rate-rule',
                    'boundary': 'Modified existing motor-input synapses; frozen at runtime; no visual decoder.'}
        np.savez_compressed(path, positions=self.positions, base=self.base,
                            weights=self.model.w.data[self.positions], nodes=self.nodes,
                            groupSizes=np.array([len(group) for group in self.groups]),
                            metadata=json.dumps(metadata))


def apply_motor_patch(model, path: Path, dataset_hash, upstream_commit=None):
    """Validate the whole patch before changing even one model weight."""
    with np.load(path, allow_pickle=False) as data:
        metadata = json.loads(str(data['metadata']))
        groups = [np.asarray(nodes) for nodes in (model.forward, model.turn_left, model.turn_right)]
        nodes = np.concatenate(groups)
        positions, weights, base = data['positions'], data['weights'], data['base']
        factor = metadata.get('maxFactor', 0)
        if upstream_commit is not None and metadata.get('upstreamCommit') != upstream_commit:
            raise ValueError('Motor patch upstream revision mismatch')
        if metadata.get('schema') != 1 or metadata.get('neurons') != model.n or \
                metadata.get('dt') != model.dt or metadata.get('datasetManifestSha256') != dataset_hash or \
                metadata.get('baseGraphSha256') != graph_hash(model.w):
            raise ValueError('Motor patch graph/dataset provenance mismatch')
        expected = np.flatnonzero(np.isin(model.w.indices, nodes))
        if not np.array_equal(data['nodes'], nodes) or \
                not np.array_equal(data['groupSizes'], [len(g) for g in groups]) or \
                positions.dtype.kind not in 'iu' or not np.array_equal(positions, expected):
            raise ValueError('Motor patch changes unexpected connections')
        if weights.shape != expected.shape or base.shape != expected.shape or \
                not np.isfinite(weights).all() or not np.isfinite(factor) or not 1 <= factor <= 10 or \
                not np.array_equal(base, model.w.data[positions]) or \
                np.any(weights * base < 0) or np.any(np.abs(weights) > factor * np.abs(base) + 1e-7):
            raise ValueError('Motor patch violates weight bounds')
        model.w.data[positions] = weights
    return {**metadata, 'motorPatchSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
