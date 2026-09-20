import json
import numpy as np
import pytest
from .prepare_live import prepare


def test_live_labels_join_by_frame_id_and_check_provenance(tmp_path):
    metadata = {'readoutSha256':'readout', 'seed':64, 'datasetManifestSha256':'dataset',
                'upstreamCommit':'revision', 'features':'membrane-change'}
    source = tmp_path / 'recording.npz'
    np.savez(source, x=np.zeros((3,768)), frameIds=[1,1,2],
             metadata=json.dumps(metadata), truncated=False)
    targets = tmp_path / 'targets.json'
    content = {'metadata':metadata, 'frames':[
        {'frameId':2, 'steering':.2, 'u':.6}, {'frameId':1, 'steering':-.4, 'u':.5}]}
    targets.write_text(json.dumps(content))
    prepare(source, targets, tmp_path / 'output')
    data = np.load(tmp_path / 'output/features.npz')
    np.testing.assert_allclose(data['y'], [-.4,-.4,.2])
    np.testing.assert_array_equal(data['groups'], [1,1,2])
    content['metadata'] = {**metadata, 'seed':65}
    targets.write_text(json.dumps(content))
    with pytest.raises(ValueError, match='provenance mismatch'):
        prepare(source, targets, tmp_path / 'bad')
