"""Package the 90 km/h candidate only after independent closed-loop passes."""
import argparse,hashlib,json,shutil
from pathlib import Path
import numpy as np

def export(source, reports, output):
    digest=hashlib.sha256(source.read_bytes()).hexdigest();runs=[]
    for path in reports:
        report=json.loads(path.read_text());final=report.get('final',{});metadata=report.get('metadata',{})
        if report['status']!='passed' or final.get('resets')!=0 or final.get('passed')!=60 or len(final.get('lapTimes',[]))!=3:
            raise ValueError(f'Three-lap gate not met: {path}')
        if metadata.get('readoutSha256')!=digest or metadata.get('speedControl')!='learned-target-25mps' or metadata.get('backend')!='malecns':
            raise ValueError(f'Candidate identity mismatch: {path}')
        samples=report['samples'];peak=max(row['speed'] for row in samples)*3.6
        if peak<80:raise ValueError('Candidate did not demonstrate high-speed driving')
        runs.append({'seed':metadata['seed'],'lapTimesSeconds':final['lapTimes'],'orderedCheckpoints':60,'resets':0,
            'peakKmh':peak,'maxRoadOffsetMeters':max(row['distance'] for row in samples),
            'reportSha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    if len({run['seed'] for run in runs})<2:raise ValueError('Require two independent seeds')
    with np.load(source,allow_pickle=False) as model:
        provenance=json.loads(str(model['provenance']));motor=int(np.count_nonzero(model['w0'][768:]))
    manifest={'schema':1,'name':'Meadow learned steering and speed','sha256':digest,'readout':'combined',
        'speedControl':'learned-target-25mps','targetCruiseKmh':90,'features':'visual-motor-membrane-change',
        'architecture':[788,128,64,2],'nonzeroMotorWeights':motor,'provenance':provenance,'runs':runs,
        'assists':'Deterministic throttle and brake servo follows learned speed target; no map steering at runtime.',
        'limitations':'Two current-track seed tests, not general driving robustness. Peak speeds are below the 90 km/h ceiling; corners slow down. Full motor circuit runs but zero motor decoder weights do not demonstrate motor contribution.'}
    output.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,output/'meadow-speed90-readout.npz')
    (output/'meadow-speed90-readout.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('reports',type=Path,nargs='+');p.add_argument('--output',type=Path,default=Path('brain/models'));a=p.parse_args();export(a.source,a.reports,a.output)
