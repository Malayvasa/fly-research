"""Fit a ridge readout with contiguous track-sector holdouts."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
from .backend import Brain, SHAPE, load_model_class
from .readout import NeuralFeatures


def run(args):
    labels = json.loads((args.data / 'labels.json').read_text())
    frames = np.memmap(args.data / 'frames.rgb', mode='r', dtype=np.uint8, shape=(len(labels), *SHAPE))
    brain = Brain(load_model_class(Path('.cache/fly64')), Path('.cache/malecns'), False, 64, 'live')
    args.output.mkdir(parents=True, exist_ok=True)
    extractor = NeuralFeatures(brain.model, args.features)
    identity = {'motorNodes': extractor.nodes} if args.features.startswith('motor-') else {}
    features, targets, sectors = [], [], []
    started = time.monotonic()
    for i, (frame, label) in enumerate(zip(frames, labels)):
        # Random training poses jump much farther than successive driving frames.
        # Let that artificial visual transient settle before recording targets.
        for _ in range(args.settle_ticks):
            brain.step(frame)
            extractor.extract(brain.model)
        for tick in range(5):
            brain.step(frame)
            features.append(extractor.extract(brain.model))
            targets.append(label['steering'])
            sectors.append(int(label['u'] * 20))
        if i % 100 == 0:
            print(f'encoded {i}/{len(labels)}', flush=True)
    x, y, sectors = np.asarray(features), np.asarray(targets), np.asarray(sectors)
    np.savez_compressed(args.output / 'features.npz', x=x, y=y, sectors=sectors, **identity)
    validation = sectors % 5 == 0
    test = sectors % 5 == 1
    train = ~(validation | test)
    mean, scale = x[train].mean(axis=0), np.maximum(x[train].std(axis=0), 0.01)
    z = (x - mean) / scale
    bias = y[train].mean()
    reports = []
    for alpha in (1, 10, 100, 1000):
        weights = np.linalg.solve(z[train].T @ z[train] + alpha * np.eye(z.shape[1]), z[train].T @ (y[train] - bias))
        prediction = np.clip(z @ weights + bias, -1, 1)
        report = {'alpha': alpha, 'trainMAE':float(np.abs(prediction[train]-y[train]).mean()),
            'validationMAE':float(np.abs(prediction[validation]-y[validation]).mean()),
            'validationSignAccuracy':float(np.mean(np.sign(prediction[validation][np.abs(y[validation])>.1]) == np.sign(y[validation][np.abs(y[validation])>.1])))}
        reports.append(report)
        np.savez_compressed(args.output / f'readout-{alpha}.npz', mean=mean, scale=scale, weights=weights.astype(np.float32), bias=bias, neurons=brain.model.n, features=args.features, **identity)
    best = min(reports, key=lambda row: row['validationMAE'])
    fitted = np.load(args.output / f"readout-{best['alpha']}.npz")
    test_prediction = np.clip(z[test] @ fitted['weights'] + fitted['bias'], -1, 1)
    test_report = {'MAE':float(np.abs(test_prediction-y[test]).mean()),
        'signAccuracy':float(np.mean(np.sign(test_prediction[np.abs(y[test])>.1]) == np.sign(y[test][np.abs(y[test])>.1])))}
    (args.output / 'training-report.json').write_text(json.dumps({'examples':len(labels),'ticks':len(y),'settleTicks':args.settle_ticks,'features':args.features,'elapsedSeconds':time.monotonic()-started,'candidates':reports,'selected':best['alpha'],'test':test_report},indent=2))
    print(json.dumps(reports,indent=2))
    print('Untouched test sectors:', json.dumps(test_report))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,default=Path('artifacts/training'))
    parser.add_argument('--output',type=Path,default=Path('artifacts/training'))
    parser.add_argument('--features',choices=['activity-voltage','membrane-change','motor-activity-voltage','motor-membrane-change'],default='activity-voltage')
    parser.add_argument('--settle-ticks',type=int,default=0)
    run(parser.parse_args())
