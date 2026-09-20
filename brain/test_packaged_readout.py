import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from .readout import TrainedReadout


def test_packaged_readout_matches_manifest_and_loads():
    folder = Path(__file__).parent / 'models'
    path = folder / 'meadow-visual-readout.npz'
    manifest = json.loads((folder / 'meadow-visual-readout.json').read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest['sha256']
    assert {run['seed'] for run in manifest['runs']} == {64,65}
    model = SimpleNamespace(n=166700, visual=np.array([0,1]),
        visual_pixels=np.array([[0,0],[0,2]]), v=np.zeros(2), spikes=np.zeros(2), dt=.02, tau_m=.1)
    readout = TrainedReadout(path, model)
    assert readout.kind == 'mlp'
    assert readout.features.kind == manifest['features']
    assert -1 <= readout.predict(model) <= 1


def test_packaged_combined_model_preserves_visual_backbone_and_records_motor_influence():
    folder = Path(__file__).parent / 'models'
    path = folder / 'meadow-combined-readout.npz'
    manifest = json.loads(path.with_suffix('.json').read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest['sha256']
    with np.load(path, allow_pickle=False) as joint, np.load(folder / 'meadow-visual-readout.npz', allow_pickle=False) as visual:
        for key in ('b0', 'w1', 'b1', 'w2', 'b2'):
            np.testing.assert_array_equal(joint[key], visual[key])
        np.testing.assert_array_equal(joint['w0'][:768], visual['w0'])
        assert np.count_nonzero(joint['w0'][768:]) == manifest['nonzeroMotorWeights']
        nodes = joint['motorNodes'].copy()
    n = manifest['neurons']
    model = SimpleNamespace(n=n, motor_nodes=nodes, visual=np.array([0,1]),
        visual_pixels=np.array([[0,0],[0,2]]), v=np.zeros(n), spikes=np.zeros(n), dt=.02, tau_m=.1)
    readout = TrainedReadout(path, model)
    assert readout.features.kind == 'visual-motor-membrane-change'
    prediction = readout.predict(model)
    assert -1 <= prediction <= 1
    if manifest['nonzeroMotorWeights'] == 0:
        assert prediction == readout.without_motor()
    assert {run['seed'] for run in manifest['runs'] if run['motorInputs'] == 'live'} == {64,65}
    assert all(run['orderedCheckpoints'] == 60 and run['recoveries'] == 0 for run in manifest['runs'])
