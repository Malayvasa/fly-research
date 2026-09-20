from types import SimpleNamespace
import numpy as np
import pytest
from .readout import NeuralFeatures, TrainedReadout


def test_motor_features_use_only_identified_motor_cells(tmp_path):
    model = SimpleNamespace(n=4, motor_nodes=np.array([1, 3]),
        activity=np.array([99., .1, 99., .2]), v=np.array([99., .3, 99., .4]))
    features = NeuralFeatures(model, 'motor-activity-voltage')
    np.testing.assert_allclose(features.extract(model), [.1, .2, .3, .4])
    path = tmp_path / 'motor.npz'
    params = dict(neurons=4, features='motor-activity-voltage', motorNodes=[1, 3],
        mean=np.zeros(4), scale=np.ones(4), weights=np.ones(4), bias=0)
    np.savez(path, **params)
    assert TrainedReadout(path, model).predict(model) == 1
    model.activity[[0, 2]] = -1000
    model.v[[0, 2]] = -1000
    assert TrainedReadout(path, model).predict(model) == 1
    np.savez(path, **{**params, 'motorNodes': [3, 1]})
    with pytest.raises(ValueError, match='identities'):
        TrainedReadout(path, model)


def test_motor_membrane_change_uses_motor_resets_and_history():
    model = SimpleNamespace(motor_nodes=np.array([1]), dt=.02, tau_m=.1,
        v=np.array([99., .3]), spikes=np.array([99., 1.]))
    extractor = NeuralFeatures(model, 'motor-membrane-change')
    np.testing.assert_allclose(extractor.extract(model), [1.3, .65])
    model.v[1] = .4
    model.spikes[1] = 0
    delta = .4 - .3 * np.exp(-.2)
    np.testing.assert_allclose(extractor.extract(model), [delta, .325 + .5 * delta])


def test_model_parameters_are_validated_and_prediction_is_bounded(tmp_path):
    path = tmp_path / 'readout.npz'
    params = dict(mean=np.zeros(768), scale=np.ones(768), weights=np.zeros(768), bias=2, neurons=2)
    np.savez(path, **params)
    model = SimpleNamespace(n=2, visual=np.array([0,1]), visual_pixels=np.array([[0,0],[0,2]]),
                            activity=np.zeros(2), v=np.zeros(2))
    readout = TrainedReadout(path, model)
    assert readout.predict(model) == 1
    model.n = 3
    with pytest.raises(ValueError, match='different neural graph'):
        TrainedReadout(path, model)
    model.n = 2
    np.savez(path, **{**params, 'scale': np.zeros(768)})
    with pytest.raises(ValueError, match='Invalid trained readout'):
        TrainedReadout(path, model)


def test_membrane_features_include_reset_and_keep_session_history():
    model = SimpleNamespace(visual=np.array([0, 1]),
        visual_pixels=np.array([[0, 0], [0, 2]]), dt=.02, tau_m=.1,
        v=np.array([.3, 0.]), spikes=np.array([0., 1.]))
    features = NeuralFeatures(model, 'membrane-change')
    first = features.extract(model)
    np.testing.assert_allclose(first[:2], [.3, 1.])
    np.testing.assert_allclose(first[384:386], [.15, .5])
    model.v = np.array([.5, .2])
    model.spikes = np.zeros(2)
    second = features.extract(model)
    expected = [.5 - .3 * np.exp(-.2), .2]
    np.testing.assert_allclose(second[:2], expected)
    np.testing.assert_allclose(second[384:386], .5 * first[384:386] + .5 * np.array(expected))
    assert np.isfinite(second).all()
    fresh = NeuralFeatures(model, 'membrane-change').extract(model)
    np.testing.assert_allclose(fresh[:2], model.v)


def test_nonlinear_readout_validates_every_layer(tmp_path):
    path = tmp_path / 'readout.npz'
    model = SimpleNamespace(n=2, visual=np.array([0, 1]),
        visual_pixels=np.array([[0, 0], [0, 2]]), activity=np.zeros(2), v=np.zeros(2))
    params = dict(kind='mlp', neurons=2, mean=np.zeros(768), scale=np.ones(768),
        w0=np.zeros((768, 128)), b0=np.zeros(128),
        w1=np.zeros((128, 64)), b1=np.zeros(64),
        w2=np.zeros((64, 1)), b2=np.array([-.4]))
    np.savez(path, **params)
    assert TrainedReadout(path, model).predict(model) == -.4
    np.savez(path, **{**params, 'w1': np.full((128, 64), np.nan)})
    with pytest.raises(ValueError, match='Invalid trained readout layers'):
        TrainedReadout(path, model)


def test_two_output_readout_keeps_steering_and_speed_separate(tmp_path):
    model = SimpleNamespace(n=2, visual=np.array([0, 1]),
        visual_pixels=np.array([[0, 0], [0, 2]]), activity=np.zeros(2), v=np.zeros(2))
    path = tmp_path / 'speed.npz'
    params = dict(kind='mlp', neurons=2, mean=np.zeros(768), scale=np.ones(768),
        outputs=['steering', 'targetSpeedNormalized'],
        w0=np.zeros((768,128)), b0=np.zeros(128),
        w1=np.zeros((128,64)), b1=np.zeros(64),
        w2=np.zeros((64,2)), b2=np.array([-.4,.8]))
    np.savez(path, **params)
    readout = TrainedReadout(path, model)
    assert readout.predict(model) == -.4
    assert readout.predict_target_speed() == 20
    for raw, expected in [(-1,0),(2,25)]:
        np.savez(path, **{**params,'b2':np.array([2,raw])})
        readout = TrainedReadout(path, model)
        assert readout.predict(model) == 1
        assert readout.predict_target_speed() == expected
    np.savez(path, **{**params, 'w2':np.zeros((64,1))})
    with pytest.raises(ValueError, match='Invalid trained readout layers'):
        TrainedReadout(path,model)
