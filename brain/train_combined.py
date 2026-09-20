"""Add trainable motor inputs to the proven visual MLP; preserve its visual path.

All graph cells still run. Only the extra decoder weights are learned. Validation
may select zero motor weights; connection to a decoder is not proof of utility.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from threadpoolctl import threadpool_limits

from .backend import Brain, SHAPE, load_model_class
from .readout import NeuralFeatures


FEATURES = 'visual-motor-membrane-change'


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def collect(args):
    labels = json.loads((args.data / 'labels.json').read_text())
    brain = Brain(load_model_class(args.fly64), args.cache, False, 64, 'live')
    extractor = NeuralFeatures(brain.model, FEATURES)
    frames = np.memmap(args.data / 'frames.rgb', mode='r', dtype=np.uint8,
                       shape=(len(labels), *SHAPE))
    x, y, sectors = [], [], []
    for i, (frame, label) in enumerate(zip(frames, labels)):
        if not 0 <= label['u'] < 1 or not np.isfinite(label['steering']) or abs(label['steering']) > 1:
            raise ValueError('Invalid camera label')
        for _ in range(5):
            brain.step(frame)
            x.append(extractor.extract(brain.model))
            y.append(label['steering'])
            sectors.append(int(label['u'] * 20))
        if i % 100 == 0:
            print(f'Encoded {i}/{len(labels)} joint visual/motor camera poses', flush=True)
    metadata = {key: brain.metadata[key] for key in ('upstreamCommit', 'datasetManifestSha256', 'seed', 'neurons')}
    metadata.update(features=FEATURES, labelsSha256=file_hash(args.data / 'labels.json'),
                    framesSha256=file_hash(args.data / 'frames.rgb'))
    np.savez_compressed(args.output / 'features.npz', x=np.asarray(x), y=np.asarray(y),
                        sectors=np.asarray(sectors), motorNodes=extractor.nodes,
                        metadata=json.dumps(metadata))


def outputs(visual_hidden, motor, weights, backbone):
    hidden = np.maximum(visual_hidden + motor @ weights, 0)
    hidden2 = np.maximum(hidden @ backbone['w1'] + backbone['b1'], 0)
    return (hidden2 @ backbone['w2'] + backbone['b2']).ravel()


def objective(flat, visual_hidden, motor, targets, backbone, alpha):
    weights = flat.reshape(motor.shape[1], 128)
    h0 = visual_hidden + motor @ weights
    h1 = np.maximum(h0, 0) @ backbone['w1'] + backbone['b1']
    raw = (np.maximum(h1, 0) @ backbone['w2'] + backbone['b2']).ravel()
    # Match the clipped runtime output; saturated predictions have zero gradient.
    error = np.clip(raw, -1, 1) - targets
    grad = (error * (np.abs(raw) < 1) / len(targets))[:, None] @ backbone['w2'].T
    grad = ((grad * (h1 > 0)) @ backbone['w1'].T) * (h0 > 0)
    gradient = motor.T @ grad + alpha * weights
    return .5 * np.mean(error ** 2) + .5 * alpha * np.sum(weights ** 2), gradient.ravel()


def fit(args):
    with np.load(args.output / 'features.npz', allow_pickle=False) as data:
        x, y, sectors, nodes = data['x'], data['y'], data['sectors'], data['motorNodes']
        provenance = json.loads(str(data['metadata']))
    with np.load(args.baseline, allow_pickle=False) as archive:
        base = dict(archive)
    baseline_manifest = json.loads(args.baseline.with_suffix('.json').read_text())
    if (baseline_manifest.get('sha256') != file_hash(args.baseline) or
            baseline_manifest.get('datasetManifestSha256') != provenance['datasetManifestSha256'] or
            baseline_manifest.get('upstreamCommit') != provenance['upstreamCommit']):
        raise ValueError('Visual backbone manifest does not match the feature dataset')
    if str(base['features']) != 'membrane-change' or str(base['kind']) != 'mlp' or \
            int(base['neurons']) != provenance['neurons'] or x.shape[1] != 768 + 2 * len(nodes):
        raise ValueError('Incompatible visual backbone or joint features')
    train = (sectors % 5 != 0) & (sectors % 5 != 1)
    validation, test = sectors % 5 == 0, sectors % 5 == 1
    if not all(mask.any() for mask in (train, validation, test)):
        raise ValueError('Missing held-out sectors')
    motor_mean = x[train, 768:].mean(axis=0)
    motor_scale = np.maximum(x[train, 768:].std(axis=0), .01)
    mean = np.concatenate((base['mean'], motor_mean))
    scale = np.concatenate((base['scale'], motor_scale))
    z = (x - mean) / scale
    visual_hidden = z[:, :768] @ base['w0'] + base['b0']
    motor = z[:, 768:]
    zero = np.zeros((motor.shape[1], 128), dtype=np.float64)

    def metrics(prediction, mask):
        sign = mask & (np.abs(y) > .1)
        return {'MAE': float(np.abs(prediction[mask] - y[mask]).mean()),
                'directionAccuracy': float(np.mean(np.sign(prediction[sign]) == np.sign(y[sign])))}

    baseline_prediction = np.clip(outputs(visual_hidden, motor, zero, base), -1, 1)
    selected, best = zero, metrics(baseline_prediction, validation)['MAE']
    report = {'method': 'frozen-visual-backbone-with-learned-motor-inputs',
              'evaluationScope': 'Sectors held out from new motor-weight fitting only; the pretrained visual backbone may have seen these poses.',
              'baselineSha256': file_hash(args.baseline), 'provenance': provenance,
              'observations': len(y), 'baselineValidation': metrics(baseline_prediction, validation),
              'candidates': [], 'selectedAlpha': None}
    with threadpool_limits(limits=4):
        for alpha in (.001, .01, .1):
            result = minimize(objective, zero.ravel(), args=(visual_hidden[train], motor[train], y[train], base, alpha),
                              method='L-BFGS-B', jac=True, options={'maxiter': args.iterations, 'ftol': 1e-9})
            # Evaluate the float32 weights that will actually be saved and served.
            weights = result.x.reshape(zero.shape).astype(np.float32)
            prediction = np.clip(outputs(visual_hidden, motor, weights, base), -1, 1)
            validation_metrics = metrics(prediction, validation)
            candidate = {'alpha': alpha, 'iterations': result.nit, 'optimizerConverged': bool(result.success),
                         'validation': validation_metrics}
            report['candidates'].append(candidate)
            print(json.dumps(candidate), flush=True)
            if validation_metrics['MAE'] < best:
                best, selected, report['selectedAlpha'] = validation_metrics['MAE'], weights, alpha
    prediction = np.clip(outputs(visual_hidden, motor, selected, base), -1, 1)
    shuffled = motor.copy()
    # Shuffle ONLY inside the held-out split; never import train/validation values.
    shuffled[test] = motor[np.random.default_rng(42).permutation(np.flatnonzero(test))]
    shuffle_prediction = np.clip(outputs(visual_hidden, shuffled, selected, base), -1, 1)
    report.update(test=metrics(prediction, test), motorMaskedTest=metrics(baseline_prediction, test),
                  motorShuffledTest=metrics(shuffle_prediction, test),
                  motorOutputEffectMAE=float(np.abs(prediction[test] - baseline_prediction[test]).mean()),
                  nonzeroMotorWeights=int(np.count_nonzero(selected)), drivingVerified=False)
    report['motorHelpsOffline'] = report['test']['MAE'] < report['motorMaskedTest']['MAE'] and \
        report['test']['MAE'] < report['motorShuffledTest']['MAE']
    provenance['baselineSha256'] = report['baselineSha256']
    params = {**base, 'features': FEATURES, 'motorNodes': nodes, 'mean': mean, 'scale': scale,
              'w0': np.concatenate((base['w0'], selected.astype(np.float32))),
              'provenance': json.dumps(provenance)}
    np.savez_compressed(args.output / 'readout-combined.npz', **params)
    report['modelSha256'] = file_hash(args.output / 'readout-combined.npz')
    (args.output / 'combined-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fly64', type=Path, default=Path('.cache/fly64'))
    parser.add_argument('--cache', type=Path, default=Path('.cache/malecns'))
    parser.add_argument('--data', type=Path, default=Path('artifacts/training'))
    parser.add_argument('--baseline', type=Path, default=Path('brain/models/meadow-visual-readout.npz'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/training-combined'))
    parser.add_argument('--iterations', type=int, default=100)
    parser.add_argument('--reuse-features', action='store_true')
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error('--iterations must be positive')
    args.output.mkdir(parents=True, exist_ok=True)
    if not args.reuse_features:
        collect(args)
    fit(args)
