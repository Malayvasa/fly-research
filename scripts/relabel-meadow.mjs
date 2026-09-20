import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {correctionTeacher} from '../src/training-teacher.ts';
for(let i=0;i<6;i++){
 const source=`artifacts/f1-training/meadow90-b-${i}-meadow/labels.jsonl`;
 const dest=`artifacts/f1-training/meadow90-c-${i}`;mkdirSync(dest,{recursive:true});
 const labels=readFileSync(source,'utf8').trim().split('\n').map(JSON.parse).map(row=>({...row,...correctionTeacher(row,row.yaw,row.speed)}));
 writeFileSync(`${dest}/labels.jsonl`,labels.map(row=>JSON.stringify(row)).join('\n')+'\n');
}
