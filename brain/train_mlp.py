"""Fit a small nonlinear readout on previously recorded neural features."""
from pathlib import Path
import json
import argparse
import numpy as np
from sklearn.neural_network import MLPRegressor
from threadpoolctl import threadpool_limits


def run(folder, road_only=False, split='sector', append=None):
    data = np.load(folder / 'features.npz')
    x, y, sectors = data['x'], data['y'], data['sectors']
    groups = data['groups'] if 'groups' in data else np.arange(len(y)) // 5
    metadata = json.loads((folder / 'training-report.json').read_text())
    motor = metadata.get('features', '').startswith('motor-')
    if motor and road_only:
        raise ValueError('Retinal mirroring is not valid for motor neurons')
    identity = {'motorNodes': data['motorNodes']} if motor else {}
    if append is not None:
        extra_metadata = json.loads((append / 'training-report.json').read_text())
        if extra_metadata.get('features') != metadata.get('features'):
            raise ValueError('Cannot mix different neural feature representations')
        extra = np.load(append / 'features.npz')
        if motor and not np.array_equal(data['motorNodes'], extra['motorNodes']):
            raise ValueError('Cannot mix different motor neuron identities')
        x = np.concatenate((x, extra['x']))
        y = np.concatenate((y, extra['y']))
        sectors = np.concatenate((sectors, extra['sectors']))
        extra_groups = extra['groups'] if 'groups' in extra else np.arange(len(extra['y'])) // 5
        groups = np.concatenate((groups, extra_groups + (int(groups.max()) // 10 + 1) * 10))
    validation, test = sectors % 5 == 0, sectors % 5 == 1
    if split == 'frame':
        # Keep all five neural ticks of each camera example in the same split.
        validation, test = groups % 10 == 0, groups % 10 == 1
    train = ~(validation | test)
    if road_only:
        mirrored=x.reshape(-1,2,12,32)[:,:,:,::-1].reshape(-1,768)
        x=np.concatenate((x,mirrored));y=np.concatenate((y,-y))
        train=np.tile(train,2);validation=np.tile(validation,2);test=np.tile(test,2)
    mean, scale = x[train].mean(axis=0), np.maximum(x[train].std(axis=0), 0.01)
    if road_only:
        mask=np.zeros((2,12,32),bool);mask[:,6:11,8:24]=True
        scale[~mask.ravel()]=1e12
    z = (x - mean) / scale
    model = MLPRegressor(hidden_layer_sizes=(128,64), activation='relu',
        alpha=5 if road_only else 1, max_iter=200, early_stopping=True, n_iter_no_change=15,
        batch_size=256, learning_rate_init=0.001, random_state=42, verbose=True)
    with threadpool_limits(limits=4):
        model.fit(z[train], y[train])
    predictions = np.clip(model.predict(z), -1, 1)
    report = {'iterations':model.n_iter_, 'architecture':[x.shape[1],128,64,1], 'split':split,
        'observations':len(y), 'append':str(append) if append is not None else None}
    for name, mask in [('train',train),('validation',validation),('test',test)]:
        sign = mask & (np.abs(y) > .1)
        report[name] = {'MAE':float(np.abs(predictions[mask]-y[mask]).mean()),
            'signAccuracy':float(np.mean(np.sign(predictions[sign]) == np.sign(y[sign])))}
    name = 'road-mlp' if road_only else 'mlp'
    if split != 'sector':
        name += '-' + split
    if append is not None:
        name += '-combined'
    np.savez_compressed(folder / f'readout-{name}.npz', kind='mlp', mean=mean, scale=scale, neurons=166700,
        features=metadata.get('features', 'activity-voltage'),
        **identity,
        **{f'w{i}':w.astype(np.float32) for i,w in enumerate(model.coefs_)},
        **{f'b{i}':b.astype(np.float32) for i,b in enumerate(model.intercepts_)})
    (folder / f'{name}-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--road-only',action='store_true')
    parser.add_argument('--data',type=Path,default=Path('artifacts/training'))
    parser.add_argument('--split',choices=['sector','frame'],default='sector')
    parser.add_argument('--append',type=Path)
    args=parser.parse_args()
    run(args.data,args.road_only,args.split,args.append)
