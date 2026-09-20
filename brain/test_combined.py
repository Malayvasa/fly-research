from types import SimpleNamespace

import numpy as np
import pytest

from .readout import NeuralFeatures, TrainedReadout


def model():
    return SimpleNamespace(n=4, motor_nodes=np.array([2, 3]), visual=np.array([0, 1]),
        visual_pixels=np.array([[0, 0], [0, 2]]), dt=.02, tau_m=.1,
        v=np.array([.1, .2, .3, .4]), spikes=np.array([0., 0., 0., 0.]))


def save_linear(path):
    weights = np.zeros(772)
    weights[0], weights[768] = 1, 1
    np.savez(path, features='visual-motor-membrane-change', motorNodes=[2, 3],
             neurons=4, mean=np.zeros(772), scale=np.ones(772), weights=weights, bias=0)


def test_joint_features_preserve_both_neural_sources_and_tick_history():
    m = model()
    joint = NeuralFeatures(m, 'visual-motor-membrane-change')
    visual = NeuralFeatures(m, 'membrane-change')
    motor = NeuralFeatures(m, 'motor-membrane-change')
    for _ in range(3):
        np.testing.assert_array_equal(joint.extract(m), np.concatenate((visual.extract(m), motor.extract(m))))
        m.v += .01


def test_masking_changes_only_decoder_motor_inputs_and_does_not_advance_neurons(tmp_path):
    path = tmp_path / 'joint.npz'
    save_linear(path)
    m = model()
    readout = TrainedReadout(path, m)
    assert readout.predict(m) == pytest.approx(.4)
    previous = readout.features.motor_features.previous.copy()
    assert readout.without_motor() == pytest.approx(.1)
    assert readout.without_motor() == pytest.approx(.1)
    np.testing.assert_array_equal(readout.features.motor_features.previous, previous)
    np.testing.assert_array_equal(m.v, [.1, .2, .3, .4])
    assert readout.predict_features(readout.last_features) == pytest.approx(.4)


def test_joint_readout_rejects_reordered_motor_neurons(tmp_path):
    path = tmp_path / 'joint.npz'
    save_linear(path)
    m = model()
    m.motor_nodes = np.array([3, 2])
    with pytest.raises(ValueError, match='identities'):
        TrainedReadout(path, m)


def test_zero_motor_weights_keep_visual_output_even_when_motor_cells_change(tmp_path):
    path = tmp_path / 'joint.npz'
    save_linear(path)
    with np.load(path) as data:
        params = dict(data)
    params['weights'][768:] = 0
    np.savez(path, **params)
    m = model()
    readout = TrainedReadout(path, m)
    output = readout.predict(m)
    features = readout.last_features.copy()
    features[768:] = 100
    assert readout.predict_features(features) == output
    assert readout.without_motor() == output


def test_motor_weight_training_gradient_matches_finite_differences():
    from .train_combined import objective
    rng = np.random.default_rng(4)
    base = {'w1': rng.normal(0, .03, (128, 64)), 'b1': np.full(64, .5),
            'w2': rng.normal(0, .01, (64, 1)), 'b2': np.zeros(1)}
    hidden, motor, y = np.ones((5, 128)), rng.normal(size=(5, 4)), rng.normal(0, .1, 5)
    flat = rng.normal(0, .001, 4 * 128)
    value, gradient = objective(flat, hidden, motor, y, base, .1)
    assert np.isfinite(value)
    for index in (0, 14, 128, 300, 511):
        plus, minus = flat.copy(), flat.copy()
        plus[index] += 1e-5
        minus[index] -= 1e-5
        numerical = (objective(plus, hidden, motor, y, base, .1)[0] -
                     objective(minus, hidden, motor, y, base, .1)[0]) / 2e-5
        assert gradient[index] == pytest.approx(numerical, abs=1e-8)


def test_trainer_can_use_motor_information_when_it_predicts_the_target():
    from scipy.optimize import minimize
    from .train_combined import objective, outputs
    motor = np.linspace(-.5, .5, 30)[:, None]
    visual = np.zeros((30, 128))
    visual[:, 0] = .2
    base = {'w1': np.zeros((128, 64)), 'b1': np.zeros(64),
            'w2': np.zeros((64, 1)), 'b2': np.zeros(1)}
    base['w1'][0, 0] = base['w2'][0, 0] = 1
    targets = .2 + .1 * motor[:, 0]
    trained = minimize(objective, np.zeros(128), args=(visual, motor, targets, base, .0001),
                       jac=True, method='L-BFGS-B')
    weights = trained.x.reshape(1, 128)
    assert weights[0, 0] > .09
    assert np.abs(outputs(visual, motor, weights, base) - targets).mean() < .001
    assert np.abs(outputs(visual, motor, np.zeros_like(weights), base) - targets).mean() > .02
