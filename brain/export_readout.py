"""Package a readout with verified, model-matched driving evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def export(source, reports, output):
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    runs = []
    for path in reports:
        report = json.loads(path.read_text())
        car = report['samples'][-1]['cars'][0]
        metadata = next(sample['fly']['metadata'] for sample in reversed(report['samples'])
                        if sample['fly']['metadata'])
        if report.get('passed') is not True or report['errors'] or car['resets'] != 0 or \
                len(car['progress']['lapTimes']) != 3 or car['progress']['passed'] != 60:
            raise ValueError(f'Driving gate not met: {path}')
        if metadata.get('readoutSha256') != digest or metadata.get('backend') != 'malecns':
            raise ValueError(f'Model provenance mismatch: {path}')
        runs.append({'seed':metadata['seed'], 'lapTimesSeconds':car['progress']['lapTimes'],
            'orderedCheckpoints':60, 'recoveries':0, 'browserErrors':[],
            'reportSha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    if len({run['seed'] for run in runs}) < 2:
        raise ValueError('Require successful races from at least two neural seeds')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, output / 'meadow-visual-readout.npz')
    manifest = {'schema':1, 'name':'Meadow learned visual driver', 'sha256':digest,
        'readout':'trained', 'features':'membrane-change',
        'architecture':[768,128,64,1], 'neurons':metadata['neurons'],
        'upstreamCommit':metadata['upstreamCommit'],
        'datasetManifestSha256':metadata['datasetManifestSha256'],
        'assists':{'throttle':.3, 'speedCutoffMetersPerSecond':8},
        'boundary':'Steering is learned from simulated visual neurons, not produced by descending motor circuits.',
        'limitations':'Circuit-specific baseline. Earlier failures exist; two passing races do not establish broad robustness.',
        'runs':runs}
    (output / 'meadow-visual-readout.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('reports', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, default=Path('brain/models'))
    args = parser.parse_args()
    export(args.source, args.reports, args.output)
