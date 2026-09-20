import {mkdir, appendFile, writeFile, readFile, readdir, rename} from 'node:fs/promises';
import {resolve} from 'node:path';
const folder = resolve(process.env.TRAINING_DIR || 'artifacts/training90');
const reports = resolve('artifacts/training90-final');
const counts=new Map();
let saves=Promise.resolve();
export default {server:{host:'127.0.0.1',port:5178,strictPort:true,hmr:false},plugins:[{
 name:'local-training-capture',configureServer(server){
 server.middlewares.use('/training-result',async(req,res)=>{
  if(req.method!=='POST'){res.statusCode=405;res.end();return;}
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4000000)throw Error('Report too large');chunks.push(chunk);}
   const run=JSON.parse(Buffer.concat(chunks).toString());if(!/^[a-z0-9-]+$/.test(run.id)||!Array.isArray(run.samples))throw Error('Invalid run');
   saves=saves.catch(()=>{}).then(async()=>{
    await mkdir(`${reports}/runs`,{recursive:true});const path=`${reports}/runs/${run.id}.json`;
    let old;try{old=JSON.parse(await readFile(path,'utf8'));}catch{}
    if(old && (['passed','failed'].includes(old.status) || (run.status==='running' && (old.samples.at(-1)?.time||0)>(run.samples.at(-1)?.time||0))))return;
    await writeFile(path+'.tmp',JSON.stringify(run));await rename(path+'.tmp',path);
   });await saves;res.end('saved');
  }catch(error){res.statusCode=400;res.end(String(error));}
 });
 server.middlewares.use('/training-runs',async(req,res)=>{
  const runs=[];
  try {const text=await readFile(`${reports}/labels.jsonl`,'utf8');const samples=text.trim().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});runs.push({id:'teacher',name:'90 km/h teacher',kind:'Scripted training teacher',status:samples.length>=1800?'complete':'recording',samples});}catch{}
  try {for(const name of (await readdir(`${reports}/runs`)).filter(name=>name.endsWith('.json'))){try{runs.push(JSON.parse(await readFile(`${reports}/runs/${name}`,'utf8')));}catch{}}}catch{}
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(runs));
 });
 server.middlewares.use('/training-capture', async(req,res)=>{
  if(req.method!=='POST'){res.statusCode=405;res.end();return;}
  try {
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>300000)throw Error('Frame too large');chunks.push(chunk);}
   const run=String(req.headers['x-training-run'] || 'legacy');if(!/^[a-z0-9-]+$/.test(run))throw Error('Invalid capture name');
   const dest=run==='legacy'?folder:resolve('artifacts/f1-training',run);const count=counts.get(run)||0;
   const label=JSON.parse(req.headers['x-training-label'] || '{}');
   const frame=Buffer.concat(chunks);
   if(frame.length!==384*256*3 || label.index!==count || !Number.isFinite(label.targetSpeed) || label.targetSpeed>25 || label.targetSpeed<0)throw Error('Invalid frame');
   await mkdir(dest,{recursive:true});
   if(count===0){await writeFile(`${dest}/frames.rgb`,Buffer.alloc(0),{flag:'wx'});await writeFile(`${dest}/labels.jsonl`,'',{flag:'wx'});}
   await appendFile(`${dest}/frames.rgb`,frame);await appendFile(`${dest}/labels.jsonl`,JSON.stringify(label)+'\n');counts.set(run,count+1);if(count+1===1800)await writeFile(`${dest}/complete.json`,JSON.stringify({frames:1800,track:label.track}));
   res.end(JSON.stringify({count}));
  } catch(e){res.statusCode=400;res.end(String(e));}
 });}}
]};
