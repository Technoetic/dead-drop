import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {APP} from '../scripts/build.mjs';
import {retainAssets} from '../scripts/retain-assets.mjs';
const sha=body=>createHash('sha256').update(body).digest('hex');
const old=Buffer.from('export const oldBuild=true;\n');
const baseUrl='https://example.test/dead-drop/';
const manifest={schema:1,buildId:'dd-old-build',sourceCommit:'1'.repeat(40),files:{'assets/main.dd-old-build.js':sha(old),'index.html':sha('old html')}};
const response=(value,status=200)=>new Response(value,{status});
async function temp(){return mkdtemp(path.join(APP,'.test-build-retain-'));}
function fetcher({body=manifest,version='dd-old-build',bytes=old}={}){
 return async url=>{
  const u=new URL(url);assert.equal(u.origin,'https://example.test');assert.ok(u.searchParams.has('_retain'));
  if(u.pathname.endsWith('pages-manifest.json'))return response(JSON.stringify(body));
  if(u.pathname.endsWith('version.json'))return response(JSON.stringify({buildId:version}));
  return response(bytes);
 };
}
test('first publication may explicitly omit previous output; later404 fails closed',async()=>{
 const outDir=await temp();
 const missing=async()=>response('missing',404);
 assert.equal((await retainAssets({baseUrl,outDir,allowEmpty:true,fetcher:missing})).retained,0);
 await assert.rejects(retainAssets({baseUrl,outDir,fetcher:missing}),/previous|manifest/i);
});
test('copies the live previous asset by its verified hash without an expiring CI artifact',async()=>{
 const outDir=await temp();
 const result=await retainAssets({baseUrl,outDir,fetcher:fetcher()});
 assert.equal(result.retained,1);assert.equal(result.previousBuild,'dd-old-build');
 assert.deepEqual(await readFile(path.join(outDir,'assets/main.dd-old-build.js')),old);
 await assert.rejects(readFile(path.join(outDir,'index.html')));
});
test('rejects mismatched bytes or inconsistent manifest/version before deployment',async()=>{
 for(const options of [{bytes:Buffer.from('wrong')},{version:'dd-other-build'}]){
  await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:fetcher(options)}),/hash|version/i);
 }
});
test('rejects traversal and malformed previous source identities',async()=>{
 for(const body of [{...manifest,sourceCommit:'invalid'},{...manifest,files:{'../outside.js':sha(old)}}]){
  await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:fetcher({body})}),/manifest|path|identity/i);
 }
});
test('retains one published build and drops older generations',async()=>{
 const outDir=await temp();
 const body={...manifest,files:{...manifest.files,'assets/main.dd-ancient-build.js':sha('ancient')}};
 const requested=[];const serve=fetcher({body});
 const result=await retainAssets({baseUrl,outDir,fetcher:async(url,options)=>{requested.push(new URL(url).pathname);return serve(url,options);}});
 assert.equal(result.retained,1);
 assert.deepEqual(await readdir(path.join(outDir,'assets')),['main.dd-old-build.js']);
 assert.ok(!requested.some(value=>value.includes('ancient')));
});
test('rejects redirect-following requests and cross-origin responses',async()=>{
 const serve=fetcher();
 await retainAssets({baseUrl,outDir:await temp(),fetcher:async(url,options)=>{
  assert.equal(options.redirect,'error');return serve(url,options);
 }});
 const foreign=async(url,options)=>{const result=await serve(url,options);Object.defineProperty(result,'url',{value:'https://foreign.test/asset'});return result;};
 await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:foreign}),/origin|redirect/i);
});
test('rejects empty current-build asset sets and excessive asset counts',async()=>{
 const empty={...manifest,files:{'assets/main.dd-ancient-build.js':sha(old)}};
 await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:fetcher({body:empty})}),/current|asset/i);
 const files=Object.fromEntries(Array.from({length:129},(_,i)=>['assets/module'+i+'.dd-old-build.js',sha(old)]));
 await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:fetcher({body:{...manifest,files}})}),/count|many|limit/i);
});
test('rejects a retained build above the total byte budget',async()=>{
 const bytes=Buffer.alloc(1800000,1);
 const files=Object.fromEntries(Array.from({length:5},(_,i)=>['assets/module'+i+'.dd-old-build.js',sha(bytes)]));
 await assert.rejects(retainAssets({baseUrl,outDir:await temp(),fetcher:fetcher({body:{...manifest,files},bytes})}),/total|budget/i);
});
test('does not write a partially verified asset set',async()=>{
 const outDir=await temp();
 const body={...manifest,files:{...manifest.files,'assets/second.dd-old-build.js':sha('corrupt')}};
 await assert.rejects(retainAssets({baseUrl,outDir,fetcher:fetcher({body})}),/hash/i);
 assert.deepEqual(await readdir(outDir),[]);
});
