"""Train steering and corner-speed readouts from sequential expert driving.

The connectome remains fixed. The 90 km/h target is a ceiling, not a promised
lap-average speed. Last contiguous segments are held out from fitting.
"""
import argparse,json,hashlib,time
from pathlib import Path
import numpy as np
from sklearn.neural_network import MLPRegressor
from threadpoolctl import threadpool_limits
from .backend import Brain,SHAPE,load_model_class
from .readout import NeuralFeatures

def run(args):
    args.output.mkdir(parents=True,exist_ok=True)
    labels=[json.loads(line) for line in (args.data/'labels.jsonl').read_text().splitlines()]
    if len(labels)!=1800 or any(row['resets'] for row in labels):
        raise ValueError('Require a complete reset-free teacher capture')
    labels_hash=hashlib.sha256((args.data/'labels.jsonl').read_bytes()).hexdigest()
    path=args.output/'features.npz'
    if not path.exists():
        encoding_started=time.monotonic()
        brain=Brain(load_model_class(args.fly64),args.cache,False,64,'live')
        features=NeuralFeatures(brain.model,'visual-motor-membrane-change')
        frames=np.memmap(args.data/'frames.rgb',mode='r',dtype=np.uint8,shape=(len(labels),*SHAPE))
        x=[];y=[];groups=[]
        with threadpool_limits(limits=1):
            for i,(frame,label) in enumerate(zip(frames,labels)):
                if i and label.get('episode',0)!=labels[i-1].get('episode',0):
                    # Let the circuit settle after the teacher relocates between episodes.
                    for _ in range(25): brain.step(frame); features.extract(brain.model)
                for _ in range(5):
                    brain.step(frame);x.append(features.extract(brain.model));y.append([label['steering'],label['targetSpeed']/25]);groups.append(0 if label.get('trainingOnly') else i)
                if i%100==0:print(f'Encoded {i}/{len(labels)} frames',flush=True)
        provenance={key:brain.metadata[key] for key in ['upstreamCommit','datasetManifestSha256','seed','neurons']}
        provenance.update(features='visual-motor-membrane-change',outputs=['steering','targetSpeedNormalized'],speedCeilingMps=25,
            labelsSha256=hashlib.sha256((args.data/'labels.jsonl').read_bytes()).hexdigest())
        provenance['environmentVersion']=labels[0].get('environmentVersion','legacy')
        provenance['encodingSeconds']=time.monotonic()-encoding_started
        print(f"Neural encoding: {provenance['encodingSeconds']:.1f} seconds",flush=True)
        np.savez_compressed(path,x=x,y=y,groups=groups,motorNodes=features.nodes,provenance=json.dumps(provenance))
    data=np.load(path);
    if json.loads(str(data['provenance']))['labelsSha256']!=labels_hash:raise ValueError('Cached features do not match capture')
    if args.encode_only:
        print('Encoding complete',flush=True);return
    x,y,groups=data['x'],data['y'],data['groups'];provenance=json.loads(str(data['provenance']))
    captures=[{'labelsSha256':provenance['labelsSha256'],'path':str(args.data)}]
    for appended in args.append:
        extra=np.load(appended/'features.npz');extra_provenance=json.loads(str(extra['provenance']))
        for key in ['upstreamCommit','datasetManifestSha256','features']:
            if extra_provenance[key]!=provenance[key]:raise ValueError('Incompatible appended data')
        if extra_provenance.get('environmentVersion','legacy')!=provenance.get('environmentVersion','legacy'):raise ValueError('Cannot mix capture environments')
        if not np.array_equal(data['motorNodes'],extra['motorNodes']):raise ValueError('Mismatched motor neurons')
        captures.append({'labelsSha256':extra_provenance['labelsSha256'],'path':str(appended)})
        x=np.concatenate((x,extra['x']));y=np.concatenate((y,extra['y']));groups=np.concatenate((groups,extra['groups']))
    provenance['captures']=captures
    train=groups<1200;validation=(groups>=1200)&(groups<1500);test=groups>=1500
    mean=x[train].mean(axis=0);scale=np.maximum(x[train].std(axis=0),.01)
    if args.road_only:
        mask=np.zeros((2,12,32),bool);mask[:,6:11,8:24]=True;scale[:768][~mask.ravel()]=1e12
    z=(x-mean)/scale
    best=None;report={'roadOnly':args.road_only,'append':str(args.append) if args.append else None,'trainingFrames':int(train.sum()/5),'validationFrames':int(validation.sum()/5),'testFrames':int(test.sum()/5),'split':'held-out frame segments or episodes within each captured track; not unseen tracks','candidates':[]}
    with threadpool_limits(limits=4):
        for motor in [False,True]:
            inputs=z.copy()
            if not motor:inputs[:,768:]=0
            model=MLPRegressor(hidden_layer_sizes=(128,64),alpha=5 if args.road_only else 1,max_iter=220,early_stopping=True,n_iter_no_change=12,batch_size=256,random_state=42,verbose=False)
            model.fit(inputs[train],y[train]);pred=model.predict(inputs);pred[:,0]=np.clip(pred[:,0],-1,1);pred[:,1]=np.clip(pred[:,1],0,1)
            def metrics(mask):return {'steeringMAE':float(np.abs(pred[mask,0]-y[mask,0]).mean()),'speedMAE_kmh':float(np.abs(pred[mask,1]-y[mask,1]).mean()*90)}
            score=float(np.mean((pred[validation]-y[validation])**2));entry={'motorInputs':motor,'iterations':model.n_iter_,'validation':metrics(validation),'test':metrics(test),'score':score};report['candidates'].append(entry);print(entry,flush=True)
            if best is None or score<best[0]:best=(score,model,motor)
    _,model,motor=best
    if not motor:model.coefs_[0][768:]=0
    np.savez_compressed(args.output/('readout-speed90-road.npz' if args.road_only else 'readout-speed90.npz'),kind='mlp',features='visual-motor-membrane-change',neurons=166700,mean=mean,scale=scale,motorNodes=data['motorNodes'],provenance=json.dumps(provenance),outputs=np.array(['steering','targetSpeedNormalized']),**{f'w{i}':w.astype(np.float32) for i,w in enumerate(model.coefs_)},**{f'b{i}':b.astype(np.float32) for i,b in enumerate(model.intercepts_)})
    report.update(selectedMotorInputs=motor,drivingVerified=False,provenance=provenance)
    (args.output/('road-report.json' if args.road_only else 'report.json')).write_text(json.dumps(report,indent=2));print('Saved candidate; closed-loop driving is not yet verified.',flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--fly64',type=Path,required=True);p.add_argument('--cache',type=Path,required=True);p.add_argument('--append',type=Path,action='append',default=[]);p.add_argument('--encode-only',action='store_true');p.add_argument('--road-only',action='store_true');run(p.parse_args())
