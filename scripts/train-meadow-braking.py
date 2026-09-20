from training_paths import cache_root
from pathlib import Path
import subprocess,json,time,sys,hashlib
import numpy as np
root=Path(__file__).resolve().parents[1];data=root/'artifacts/f1-training';reports=root/'artifacts/training90-final/runs'
cache=cache_root(root)
def status(note,state='running'):
 p=reports/'meadow90-c-worker-mac.json';q=p.with_suffix('.tmp');q.write_text(json.dumps(dict(id='meadow90-c-worker-mac',name='This Mac',kind='Neural encoding worker',status=state,note=note,samples=[])));q.replace(p);print(note,flush=True)
def command(folder):
 return [sys.executable,'-u','-m','brain.train_speed','--data',str(folder),'--output',str(folder),'--fly64',str(cache/'fly64'),'--cache',str(cache/'malecns')]
try:
 status('Reusing six cached feature batches with corrected braking labels')
 subprocess.run(['node','--experimental-strip-types','scripts/relabel-meadow.mjs'],cwd=root,check=True)
 for i in range(6):
  folder=data/f'meadow90-c-{i}';labels=[json.loads(line) for line in (folder/'labels.jsonl').read_text().splitlines()]
  old=np.load(data/f'meadow90-b-{i}-encoded/features.npz');values={k:old[k] for k in old.files};provenance=json.loads(str(values['provenance']))
  provenance['originalLabelsSha256']=provenance['labelsSha256'];provenance['labelsSha256']=hashlib.sha256((folder/'labels.jsonl').read_bytes()).hexdigest();provenance['correction']='offline conservative curvature and edge-speed labels v1'
  values['provenance']=json.dumps(provenance);values['y']=np.repeat([[r['steering'],r['targetSpeed']/25] for r in labels],5,axis=0)
  np.savez_compressed(folder/'features.npz',**values)
 replay=data/'meadow90-c-replay-meadow';status('Waiting for reconstructed failure images')
 deadline=time.monotonic()+3600
 while not (replay/'complete.json').exists():
  if time.monotonic()>deadline:raise TimeoutError('Replay capture did not complete')
  time.sleep(2)
 status('Encoding corrected failure examples; prior six batches reused')
 with (data/'meadow90-c-replay.log').open('w') as log:subprocess.run(command(replay)+['--encode-only'],cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
 cmd=command(data/'meadow90-c-0')
 for i in range(1,6):cmd+=['--append',str(data/f'meadow90-c-{i}')]
 cmd+=['--append',str(replay)]
 status('Fitting corrected steering and braking predictions')
 with (data/'meadow90-c-fit.log').open('w') as log:subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
 server=subprocess.Popen([sys.executable,'-u','-m','brain.server','--fly64',str(cache/'fly64'),'--cache',str(cache/'malecns'),'--combined-readout',str(data/'meadow90-c-0/readout-speed90.npz'),'--port','18772','--origin','http://127.0.0.1:5178'],cwd=root)
 time.sleep(3)
 if server.poll() is not None:raise RuntimeError('Evaluation service failed')
 (root/'public/meadow90-c-ready.json').write_text(json.dumps({'ready':True}));status('Correction fitted; awaiting driving test evidence','complete');server.wait()
except Exception as error:
 status(str(error),'failed');raise
