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
