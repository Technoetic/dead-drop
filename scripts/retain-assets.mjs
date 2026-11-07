import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {APP} from './build.mjs';

async function bytes(response,limit){
  if(!response.ok)throw Error('Previous output HTTP '+response.status);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Previous output too large');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
export async function retainAssets({baseUrl='https://technoetic.github.io/dead-drop/',outDir=path.join(APP,'dist'),allowEmpty=false,fetcher=fetch}={}){
  const base=new URL(baseUrl),nonce=randomUUID(),root=path.resolve(outDir);
  const request=async relative=>{
    const url=new URL(relative,base);url.searchParams.set('_retain',nonce);
    const result=await fetcher(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(result.url&&new URL(result.url).origin!==base.origin)throw Error('Previous output changed origin');
    return result;
  };
  const response=await request('pages-manifest.json');
  if(response.status===404&&allowEmpty)return {retained:0,previousBuild:null};
  if(!response.ok)throw Error('Previous Pages manifest unavailable: '+response.status);
  const manifest=JSON.parse((await bytes(response,512*1024)).toString('utf8'));
  if(manifest?.schema!==1||!/^[a-z\d][a-z\d-]{2,79}$/i.test(manifest.buildId)||!/^[a-f\d]{40}$/.test(manifest.sourceCommit)||!manifest.files||Array.isArray(manifest.files)||typeof manifest.files!=='object')throw Error('Invalid previous manifest identity');
  const entries=Object.entries(manifest.files);
  if(entries.length>5000)throw Error('Previous manifest too large');
  const assets=[];
  for(const [name,digest]of entries){
    if(!/^[a-f\d]{64}$/.test(digest))throw Error('Invalid previous manifest hash');
    if(['index.html','version.json','data/levels.json'].includes(name))continue;
    if(!/^assets\/(?:[a-z\d_-]+\/)*[a-z\d_.-]+\.(js|css|svg)$/i.test(name))throw Error('Invalid previous asset path');
    // A deployment keeps the last live build, not its retained ancestors.
    if(name.endsWith('.'+manifest.buildId+'.js')||name.endsWith('.'+manifest.buildId+'.css')||name.endsWith('.'+manifest.buildId+'.svg'))assets.push([name,digest]);
  }
  if(!assets.length)throw Error('Previous manifest has no current-build assets');
  if(assets.length>128)throw Error('Previous asset count exceeds limit');
  const version=JSON.parse((await bytes(await request('version.json'),4096)).toString('utf8'));
  if(version.buildId!==manifest.buildId)throw Error('Previous manifest/version mismatch');
  const verified=[];let total=0;
  for(const [name,digest]of assets){
    const body=await bytes(await request(name),2*1024*1024);
    total+=body.length;if(total>8*1024*1024)throw Error('Previous assets exceed total byte budget');
    if(createHash('sha256').update(body).digest('hex')!==digest)throw Error('Previous asset hash mismatch: '+name);
    const target=path.resolve(root,name);
    if(!target.startsWith(root+path.sep))throw Error('Previous asset path escaped destination');
    verified.push([target,body]);
  }
  for(const [target,body]of verified){
    await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);
  }
  return {retained:assets.length,previousBuild:manifest.buildId};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await retainAssets({allowEmpty:process.argv.includes('--allow-empty')})));
}
