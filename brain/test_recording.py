import numpy as np
from .recording import FeatureRecording


def test_recording_is_bounded_and_keeps_exact_feature_copies(tmp_path):
    recording = FeatureRecording(tmp_path, {'features': 'membrane-change'}, limit=2)
    values = np.ones(768)
    recording.append(values, 3, 0)
    values[:] = 2
    recording.append(values, 3, 1)
    recording.append(values, 4, 2)
    data = np.load(recording.save(), allow_pickle=False)
    np.testing.assert_array_equal(data['x'][:, 0], [1, 2])
    np.testing.assert_array_equal(data['frameIds'], [3, 3])
    np.testing.assert_array_equal(data['sequences'], [0, 1])
    assert bool(data['truncated'])
    assert FeatureRecording(tmp_path, {}).save() is None
