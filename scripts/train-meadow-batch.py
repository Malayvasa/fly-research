"""Local pipelined capture -> cached neural features -> fit -> evaluation service."""
from training_paths import cache_root
from pathlib import Path
import subprocess,json,time,sys,argparse
parser=argparse.ArgumentParser();parser.add_argument('--batch',default='meadow90-b');parser.add_argument('--port',type=int,default=18771);args=parser.parse_args();batch=args.batch
if not batch.replace('-','').isalnum():raise ValueError('Invalid batch')
root=Path(__file__).resolve().parents[1]
data=root/'artifacts/f1-training'; reports=root/'artifacts/training90-final/runs'
cache=cache_root(root)
def status(note,state='running'):
 p=reports/f'{batch}-worker-mac.json';q=p.with_suffix('.tmp');q.write_text(json.dumps(dict(id=f'{batch}-worker-mac',name='This Mac',kind='Neural encoding worker',status=state,note=note,samples=[])));q.replace(p);print(note,flush=True)
def command(i):
 return [sys.executable,'-u','-m','brain.train_speed','--data',str(data/f'{batch}-{i}-meadow'),'--output',str(data/f'{batch}-{i}-encoded'),'--fly64',str(cache/'fly64'),'--cache',str(cache/'malecns')]
try:
 for i in range(6):
  status(f'Waiting for meadow batch {i+1}/6')
  deadline=time.monotonic()+14400
  while not (data/f'{batch}-{i}-meadow/complete.json').exists():
   if time.monotonic()>deadline:raise TimeoutError('Capture did not complete')
   time.sleep(2)
  status(f'Encoding meadow batch {i+1}/6 while capture continues')
  with (data/f'{batch}-{i}.log').open('w') as log:subprocess.run(command(i)+['--encode-only'],cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
 status('Fitting shared meadow readout from six cached batches')
 cmd=command(0)
 for i in range(1,6):cmd+=['--append',str(data/f'{batch}-{i}-encoded')]
 with (data/f'{batch}-fit.log').open('w') as log:subprocess.run(cmd,cwd=root,stdout=log,stderr=subprocess.STDOUT,check=True)
 server=subprocess.Popen([sys.executable,'-u','-m','brain.server','--fly64',str(cache/'fly64'),'--cache',str(cache/'malecns'),'--combined-readout',str(data/f'{batch}-0-encoded/readout-speed90.npz'),'--port',str(args.port),'--origin','http://127.0.0.1:5178'],cwd=root)
 time.sleep(3)
 if server.poll() is not None:raise RuntimeError('Evaluation server did not start')
 (root/f'public/{batch}-ready.json').write_text(json.dumps({'ready':True}))
 status('Candidate ready; full-lap tests run in the meadow training page','complete')
 server.wait()
except Exception as error:
 status(str(error),'failed');raise
