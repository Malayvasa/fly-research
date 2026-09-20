"""Teach existing motor-input synapses; evaluate frozen patches on held-out views.

The visual teacher is a separate, unmodified simulator. It supplies targets only
during training/scoring. It is never installed in the student or driving service.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from .backend import Brain, SHAPE, load_model_class
from .motor_plasticity import MotorPlasticity, STEERING_GAIN, apply_motor_patch


def score(student, teacher, frames, indices, ticks):
    predictions, targets, forward = [], [], []
    for index in indices:
        for tick in range(ticks):
            expected = teacher.step(frames[index])['steering']
            rates = student.step(frames[index])
            if tick >= ticks // 2:
                predictions.append(np.clip((rates['rightHz'] - rates['leftHz']) * STEERING_GAIN, -1, 1))
                targets.append(expected)
                forward.append(rates['forwardHz'])
    p, y = np.asarray(predictions), np.asarray(targets)
    directional = np.abs(y) > .1
    return {'steeringMAE': float(np.abs(p - y).mean()),
            'directionAccuracy': float((np.sign(p[directional]) == np.sign(y[directional])).mean()) if directional.any() else None,
            'meanForwardHz': float(np.mean(forward)), 'observations': len(y),
            'predictions': p.tolist()}


def run(args):
    if args.epochs < 1 or args.ticks < 13 or args.max_poses < 0:
        raise ValueError('Use positive epochs, at least 13 ticks, and nonnegative max-poses')
    labels = json.loads((args.data / 'labels.json').read_text())
    frames = np.memmap(args.data / 'frames.rgb', mode='r', dtype=np.uint8,
                       shape=(len(labels), *SHAPE))
    u = np.array([label['u'] for label in labels])
    if not len(u) or not np.isfinite(u).all() or np.any((u < 0) | (u >= 1)):
        raise ValueError('Invalid track sectors')
    sectors = (u * 20).astype(int)
    splits = {'train': np.flatnonzero((sectors % 5 != 0) & (sectors % 5 != 1)),
              'validation': np.flatnonzero(sectors % 5 == 0),
              'test': np.flatnonzero(sectors % 5 == 1)}
    if args.max_poses:
        splits = {name: values[:args.max_poses] for name, values in splits.items()}
    if any(len(values) == 0 for values in splits.values()):
        raise ValueError('Need train, validation, and test track sectors')
    model_class = load_model_class(args.fly64)

    def pair(seed=64, mode='live', patch=None):
        student = Brain(model_class, args.cache, False, seed, mode)
        teacher = Brain(model_class, args.cache, False, seed, 'live')
        teacher.use_readout(args.teacher)
        if patch is not None:
            apply_motor_patch(student.model, patch, student.metadata['datasetManifestSha256'])
        return student, teacher

    args.output.mkdir(parents=True, exist_ok=True)
    student, teacher = pair()
    learner = MotorPlasticity(student.model, args.learning_rate, args.max_factor)
    provenance = {key: student.metadata[key] for key in
                  ('datasetManifestSha256', 'upstreamCommit', 'seed', 'backend')}
    provenance.update(teacherSha256=hashlib.sha256(args.teacher.read_bytes()).hexdigest(),
                      labelsSha256=hashlib.sha256((args.data / 'labels.json').read_bytes()).hexdigest(),
                      trainingThrottleTarget=.3)
    report = {'method': 'existing-motor-synapse-learning',
              'splitSizes': {key: len(value) for key, value in splits.items()},
              'epochs': [], 'limitations': 'Offline teacher agreement is not proof of driving; run physical and sensory-ablation checks.'}
    best, selected = float('inf'), None
    for epoch in range(args.epochs):
        for number, index in enumerate(splits['train']):
            for tick in range(args.ticks):
                desired = teacher.step(frames[index])['steering']
                learner.observe_presynaptic()
                student.step(frames[index])
                if tick >= args.ticks // 2:
                    learner.learn(desired)
            if number % 50 == 0:
                print(f'epoch {epoch + 1}: {number}/{len(splits["train"])} training views', flush=True)
        patch = args.output / f'motor-epoch-{epoch + 1}.npz'
        learner.save(patch, provenance)
        validation = score(*pair(patch=patch), frames, splits['validation'], args.ticks)
        validation.pop('predictions')
        report['epochs'].append({'epoch': epoch + 1, 'patch': str(patch), **validation})
        if validation['steeringMAE'] < best:
            best, selected = validation['steeringMAE'], patch
        (args.output / 'report.json').write_text(json.dumps(report, indent=2))
    report['selectedPatch'] = str(selected)
    report['test'] = []
    for seed in (64, 65):
        baseline = score(*pair(seed), frames, splits['test'], args.ticks)
        trained = score(*pair(seed, patch=selected), frames, splits['test'], args.ticks)
        disconnected = score(*pair(seed, 'disconnected', selected), frames, splits['test'], args.ticks)
        influence = float(np.mean(np.abs(np.array(trained['predictions']) - disconnected['predictions'])))
        for result in (baseline, trained, disconnected):
            result.pop('predictions')
        report['test'].append({'seed': seed, 'baseline': baseline, 'trained': trained,
                               'disconnected': disconnected, 'visualInfluenceMAE': influence})
    report['offlineImprovement'] = all(run['trained']['steeringMAE'] < run['baseline']['steeringMAE']
        and run['trained']['steeringMAE'] < run['disconnected']['steeringMAE'] for run in report['test'])
    report['drivingVerified'] = False
    (args.output / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fly64', type=Path, default=Path('.cache/fly64'))
    parser.add_argument('--cache', type=Path, default=Path('.cache/malecns'))
    parser.add_argument('--data', type=Path, default=Path('artifacts/training'))
    parser.add_argument('--teacher', type=Path, default=Path('brain/models/meadow-visual-readout.npz'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/motor-network'))
    parser.add_argument('--epochs', type=int, default=3)
    parser.add_argument('--ticks', type=int, default=30)
    parser.add_argument('--max-poses', type=int, default=0, help='Per-split bound for an initial smoke experiment; 0 uses all')
    parser.add_argument('--learning-rate', type=float, default=.05)
    parser.add_argument('--max-factor', type=float, default=4.)
    run(parser.parse_args())
