import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {APP} from './build.mjs';

const root=path.join(APP,'dist');
async function walk(dir){
  const files=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw Error('Static output cannot contain symbolic links');
    if(entry.isDirectory())files.push(...await walk(full));else if(entry.isFile())files.push(full);
  }
  return files.sort();
}
const files={};
for(const file of await walk(root)){
  const relative=path.relative(root,file).replaceAll('\\','/');
  if(relative==='pages-manifest.json')continue;
  files[relative]=createHash('sha256').update(await readFile(file)).digest('hex');
}
const {buildId}=JSON.parse(await readFile(path.join(root,'version.json'),'utf8'));
const sourceCommit=process.env.GITHUB_SHA||'local';
await writeFile(path.join(root,'pages-manifest.json'),JSON.stringify({schema:1,buildId,sourceCommit,files},null,2)+'\n');
console.log(JSON.stringify({buildId,sourceCommit,files:Object.keys(files).length}));
