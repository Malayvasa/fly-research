"""Join recorded neural features to offline expert targets by camera frame ID."""
import argparse
import json
from pathlib import Path
import numpy as np


def prepare(recording, targets, output):
    data = np.load(recording, allow_pickle=False)
    metadata = json.loads(str(data['metadata']))
    labels = json.loads(targets.read_text())
    for key in ('readoutSha256', 'seed', 'datasetManifestSha256', 'upstreamCommit'):
        if metadata.get(key) is None or metadata[key] != labels['metadata'].get(key):
            raise ValueError(f'Recording/target provenance mismatch: {key}')
    if 'recordingSession' in metadata and metadata['recordingSession'] != labels['metadata'].get('recordingSession'):
        raise ValueError('Recording/target session mismatch')
    by_frame = {frame['frameId']: frame for frame in labels['frames']}
    if len(by_frame) != len(labels['frames']):
        raise ValueError('Camera frame IDs repeat; do not mix sessions')
    matched = [by_frame[int(frame)] for frame in data['frameIds']]
    y = np.asarray([frame['steering'] for frame in matched])
    sectors = np.asarray([int(frame['u'] * 20) for frame in matched])
    if not np.isfinite(y).all() or np.any(np.abs(y) > 1):
        raise ValueError('Invalid steering targets')
    output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(output / 'features.npz', x=data['x'], y=y,
        sectors=sectors, groups=data['frameIds'])
    report = {'source':'live-driving', 'features':metadata['features'],
        'observations':len(y), 'frames':len(set(data['frameIds'].tolist())),
        'recording':str(recording), 'targets':str(targets),
        'truncated':bool(data['truncated']), 'metadata':metadata}
    (output / 'training-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k:v for k,v in report.items() if k != 'metadata'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('recording', type=Path)
    parser.add_argument('targets', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.recording, args.targets, args.output)
