"""Run independent connectome encoders on two Macs, then fit one shared readout."""
import argparse,concurrent.futures,json,os,shlex,subprocess,time,sys
from training_paths import cache_root
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--batch',required=True);p.add_argument('--local',action='store_true');p.add_argument('--remote',default=os.environ.get('FLY_REMOTE'));p.add_argument('--remote-source',default=os.environ.get('FLY_REMOTE_SOURCE'));a=p.parse_args()
root=Path(__file__).resolve().parents[1];os.chdir(root)
batch=a.batch
if not all(c.isalnum() or c=='-' for c in batch):raise ValueError('Invalid batch')
if not a.local and (not a.remote or not a.remote_source):raise ValueError('Specify --remote and --remote-source, or use --local')
remote=a.remote;remote_source=a.remote_source
remote_root=str(Path(remote_source).parent/f'fly-training-{batch}') if remote_source else ''
local_python=sys.executable
cache=str(cache_root(root))
out=root/'artifacts/f1-training';out.mkdir(parents=True,exist_ok=True)
reports=root/'artifacts/training90-final/runs';reports.mkdir(parents=True,exist_ok=True)
def call(argv,**kw):subprocess.run(argv,check=True,**kw)
def remote_call(argv,**kw):call(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',remote,' '.join(shlex.quote(str(x)) for x in argv)],**kw)
def state(worker,note,status='running'):
 path=reports/f'{batch}-worker-{worker}.json';temp=path.with_suffix('.tmp')
 temp.write_text(json.dumps(dict(id=f'{batch}-worker-{worker}',name='Mac Studio' if worker=='studio' else 'This Mac',kind='Neural encoding worker',status=status,note=note,samples=[])))
 temp.replace(path);print(worker,note,flush=True)
def run_worker(worker,tracks):
 try:
  for track in tracks:
   name=f'{batch}-{track}';data=out/name;encoded=out/f'{name}-encoded'
   state(worker,f'Waiting for {track} camera capture')
   deadline=time.monotonic()+14400
   while not (data/'complete.json').exists():
    if time.monotonic()>deadline:raise TimeoutError(f'No completed capture for {track}')
    time.sleep(3)
   state(worker,f'Transferring and encoding {track}: 1800 images' if worker=='studio' else f'Encoding {track}: full connectome, 1800 images')
   if worker=='studio':
    remote_call(['mkdir','-p',f'{remote_root}/artifacts/{name}'])
    call(['rsync','-az',str(data)+'/',f'{remote}:{remote_root}/artifacts/{name}/'])
    cmd=[f'{remote_source}/.venv/bin/python','-u','-m','brain.train_speed','--data',f'artifacts/{name}','--output',f'artifacts/{name}-encoded','--fly64',f'{remote_source}/.cache/fly64','--cache',f'{remote_source}/.cache/malecns','--encode-only']
    command='cd '+shlex.quote(remote_root)+' && '+' '.join(shlex.quote(x) for x in cmd)
    with (out/f'{name}.log').open('w') as log:call(['ssh',remote,command],stdout=log,stderr=subprocess.STDOUT)
    encoded.mkdir(exist_ok=True);call(['rsync','-az',f'{remote}:{remote_root}/artifacts/{name}-encoded/',str(encoded)+'/'])
   else:
    with (out/f'{name}.log').open('w') as log:call([local_python,'-u','-m','brain.train_speed','--data',str(data),'--output',str(encoded),'--fly64',cache+'/fly64','--cache',cache+'/malecns','--encode-only'],stdout=log,stderr=subprocess.STDOUT)
   state(worker,f'{track} encoded and saved')
  state(worker,'Assigned circuits encoded','complete')
 except Exception as error:
  state(worker,str(error),'failed');raise
if a.local:
 state('studio','Stopped by request; remaining work moved to this Mac','stopped')
 run_worker('mac',['monza','interlagos','silverstone','spa','red-bull-ring'])
else:
 remote_call(['mkdir','-p',remote_root+'/brain'])
 call(['rsync','-az','--exclude','__pycache__','--exclude','models',str(root/'brain')+'/',remote+':'+remote_root+'/brain/'])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  jobs=[pool.submit(run_worker,'mac',['monza','interlagos']),pool.submit(run_worker,'studio',['silverstone','spa','red-bull-ring'])]
  for job in jobs:job.result()
state('mac','Fitting shared steering and speed readout from all five circuits')
cmd=[local_python,'-u','-m','brain.train_speed','--data',str(out/f'{batch}-monza'),'--output',str(out/f'{batch}-monza-encoded'),'--fly64',cache+'/fly64','--cache',cache+'/malecns']
for track in ['silverstone','interlagos','spa','red-bull-ring']:cmd+=['--append',str(out/f'{batch}-{track}-encoded')]
with (out/f'{batch}-fit.log').open('w') as log:call(cmd,stdout=log,stderr=subprocess.STDOUT)
state('mac','Shared candidate saved. Full-lap driving is not yet verified.','complete')
