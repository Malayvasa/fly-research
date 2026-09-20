from collections import deque
from types import SimpleNamespace

import numpy as np
import pytest
from scipy import sparse

from .motor_plasticity import MotorPlasticity, apply_motor_patch, target_rates


def model():
    return SimpleNamespace(n=5, dt=.02, forward=np.array([2]), turn_left=np.array([3]),
        turn_right=np.array([4]), motor_nodes=np.array([2, 3, 4]),
        spikes=np.array([1., 0., 0., 0., 0.]),
        history=deque([np.zeros(3)] * 13, maxlen=13),
        w=sparse.csc_matrix(([.1, -.2, .3, .4], ([2, 3, 4, 1], [0, 0, 0, 0])), shape=(5, 5)))


def test_learning_changes_existing_motor_synapses_without_teacher_at_runtime(tmp_path):
    brain = model()
    before = brain.w.copy()
    learner = MotorPlasticity(brain)
    for _ in range(200):
        learner.observe_presynaptic()
        learner.learn(1)
    assert not np.array_equal(before.data, brain.w.data)
    np.testing.assert_array_equal(before.indices, brain.w.indices)
    np.testing.assert_array_equal(before.indptr, brain.w.indptr)
    assert brain.w[1, 0] == before[1, 0]  # Non-motor connection is untouched.
    assert np.all(before.data * brain.w.data >= 0)
    assert np.all(np.abs(brain.w.data) <= 4 * np.abs(before.data))
    path = tmp_path / 'motor.npz'
    learner.save(path, {'datasetManifestSha256': 'dataset'})
    fresh = model()
    metadata = apply_motor_patch(fresh, path, 'dataset')
    np.testing.assert_array_equal(fresh.w.data, brain.w.data)
    assert len(metadata['motorPatchSha256']) == 64


def test_patch_rejects_changed_graph_and_wrong_dataset_without_mutation(tmp_path):
    learner = MotorPlasticity(model())
    path = tmp_path / 'motor.npz'
    learner.save(path, {'datasetManifestSha256': 'dataset'})
    fresh = model()
    original = fresh.w.data.copy()
    with pytest.raises(ValueError, match='provenance'):
        apply_motor_patch(fresh, path, 'other')
    np.testing.assert_array_equal(fresh.w.data, original)
    with pytest.raises(ValueError, match='upstream'):
        apply_motor_patch(fresh, path, 'dataset', 'wrong-revision')
    np.testing.assert_array_equal(fresh.w.data, original)
    fresh.w.data[0] += .01
    with pytest.raises(ValueError, match='provenance'):
        apply_motor_patch(fresh, path, 'dataset')


def test_patch_rejects_injected_nonmotor_edges_and_sign_flips(tmp_path):
    path = tmp_path / 'motor.npz'
    MotorPlasticity(model()).save(path, {'datasetManifestSha256': 'dataset'})
    with np.load(path) as archive:
        data = dict(archive)
    original = data['weights'].copy()
    data['weights'] = -original
    np.savez(path, **data)
    with pytest.raises(ValueError, match='bounds'):
        apply_motor_patch(model(), path, 'dataset')
    data['weights'] = original
    data['positions'] = np.array([0, 1, 2])
    np.savez(path, **data)
    with pytest.raises(ValueError, match='unexpected'):
        apply_motor_patch(model(), path, 'dataset')


def test_target_mapping_and_no_presynaptic_activity_means_no_learning():
    left, right = target_rates(-1), target_rates(1)
    assert left[1] > left[2] and right[2] > right[1]
    assert right[0] == pytest.approx(1.45)
    brain = model()
    brain.spikes[:] = 0
    before = brain.w.data.copy()
    learner = MotorPlasticity(brain)
    learner.observe_presynaptic()
    learner.learn(1)
    np.testing.assert_array_equal(brain.w.data, before)
