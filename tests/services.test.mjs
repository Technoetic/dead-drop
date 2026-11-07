import {readFile} from 'node:fs/promises';
import {assessPlan} from '../src/game/engine.js';
import {GameSession} from '../src/game/session.js';
const authored=JSON.parse(await readFile(new URL('../data/levels.json',import.meta.url),'utf8'));
import test from 'node:test';
import assert from 'node:assert/strict';
import {VersionService} from '../src/services/version-service.js';
import {Router} from '../src/services/router.js';
import {StorageService} from '../src/services/storage-service.js';
import {SoundService} from '../src/services/sound-service.js';
import {LevelService} from '../src/services/level-service.js';
import {parseRoute,routeUrl} from '../src/shared/routes.js';
import {el} from '../src/shared/dom.js';

const response=(value,ok=true)=>({ok,status:ok?200:503,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const run=()=>({schema:1,catalogId:'dead-drop-v1',runId:'run-one',mode:'challenge',index:2,remainingMs:62000,elapsedMs:28000,score:2300,combo:2,maxCombo:2,solved:2,plan:[],selected:null,phase:'editing'});
const result=(extra={})=>({id:'run-one',date:'2026-11-04T00:00:00.000Z',mode:'challenge',score:400,solved:4,total:8,durationMs:90000,maxCombo:3,...extra});
class MemoryStorage {
  data=new Map();
  getItem(key){return this.data.get(key)??null;}
  setItem(key,value){this.data.set(key,String(value));}
  removeItem(key){this.data.delete(key);}
}

test('a valid long practice session and bounded long run ID can save its terminal result',async()=>{
  const snapshot={...run(),runId:'r'.repeat(128),mode:'practice',index:7,solved:8,score:11600,combo:8,maxCombo:8,remainingMs:90000,elapsedMs:31*24*60*60*1000,plan:assessPlan(authored.levels[7],[]).required,phase:'finished'};
  const game=new GameSession({catalog:authored,snapshot});
  const service=new StorageService({storage:new MemoryStorage()});
  const completed=game.toResult();await service.saveResult(completed);
  assert.deepEqual(await service.loadRecords(),[completed]);
});

test('loaded identity is required and cannot be initialized by a fresh server response',async()=>{
  assert.throws(()=>new VersionService({baseUrl:'https://example.test/game/'}));
  const service=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:async()=>response({buildId:'B01'})});
  assert.equal((await service.navigation('#/guide',()=>({dirty:false,saving:false}))).kind,'reload');
  assert.equal(service.loadedBuild,'A01');assert.equal(service.pendingBuild,'B01');
});

test('rollback triggers a change and a network failure retains the observed update',async()=>{
  let offline=false;
  const service=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'B01',fetcher:async()=>{if(offline)throw Error('offline');return response({buildId:'A01'});}});
  assert.equal((await service.navigation('#/',()=>({dirty:false,saving:false}))).kind,'reload');
  offline=true;await service.refresh();assert.equal(service.pendingBuild,'A01');assert.equal(service.status,'unavailable');
});

test('an edit or save started during a version check protects the destination',async()=>{
  for(const field of ['dirty','saving']){
    const gate=deferred();const state={dirty:false,saving:false};
    const service=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:()=>gate.promise});
    const decision=service.navigation('#/records',()=>state);state[field]=true;gate.resolve(response({buildId:'B01'}));
    assert.equal((await decision).kind,'protect');
  }
});

test('failed malformed and timed-out version checks keep current clean navigation usable',async()=>{
  for(const fetcher of [async()=>response({},false),async()=>response({buildId:''}),async()=>{throw Error('offline');},()=>new Promise(()=>{})]){
    const service=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher,timeoutMs:8});
    assert.equal((await service.navigation('#/guide',()=>({dirty:false,saving:false}))).kind,'spa');
    assert.equal(service.loadedBuild,'A01');assert.equal(service.status,'unavailable');assert.ok(service.lastError);
  }
});

test('version requests use the absolute app subpath and retry after failure',async()=>{
  let calls=0;
  const service=new VersionService({baseUrl:'https://example.test/nested/game/',loadedBuild:'A01',fetcher:async(url,options)=>{
    assert.equal(String(url),'https://example.test/nested/game/version.json');assert.equal(options.cache,'no-store');assert.ok(options.signal);
    return response({buildId:++calls===1?'':'A01'});
  }});
  await service.refresh();assert.equal(service.status,'unavailable');await service.refresh();assert.equal(service.status,'available');assert.equal(service.lastError,null);
});

test('saved run roundtrips its exact plain state and every load returns a private copy',async()=>{
  const memory=new MemoryStorage();const service=new StorageService({storage:memory});const original=run();
  assert.equal(await service.loadRun(),null);await service.saveRun(original);original.plan.push('outside');
  assert.ok(memory.data.has('dead-drop:run:v1'));const restored=await service.loadRun();assert.deepEqual(restored,run());
  restored.plan.push('another');assert.deepEqual(await service.loadRun(),run());
  await service.clearRun();assert.equal(await service.loadRun(),null);
});

test('saved drafts allow null selection, selected source cards, and the cleared phase',async()=>{
  const service=new StorageService({storage:new MemoryStorage()});
  for(const values of [{selected:null},{selected:'source-card'},{phase:'cleared',solved:3,score:3600,combo:3,maxCombo:3}]){
    const value={...run(),...values};await service.saveRun(value);assert.deepEqual(await service.loadRun(),value);
  }
});

test('corrupt saves are reported and preserved, with finite bounded numeric and plan validation',async()=>{
  const memory=new MemoryStorage();const service=new StorageService({storage:memory});
  const bad=[{...run(),schema:2},{...run(),index:8},{...run(),remainingMs:90001},{...run(),remainingMs:-1},{...run(),score:-1},{...run(),combo:9},{...run(),solved:9},{...run(),selected:{}},{...run(),phase:'running'},{...run(),plan:['sum','sum']},{...run(),plan:['<script>']}];
  for(const value of bad){const json=JSON.stringify(value);memory.setItem('dead-drop:run:v1',json);await assert.rejects(service.loadRun());assert.equal(memory.getItem('dead-drop:run:v1'),json);}
  for(const field of ['remainingMs','score','combo','maxCombo','solved','index'])await assert.rejects(service.saveRun({...run(),[field]:Infinity}));
  memory.setItem('dead-drop:run:v1','{broken');await assert.rejects(service.loadRun());
});

test('saving stays protected until the storage write finishes and resets after failure and retry',async()=>{
  const memory=new MemoryStorage();const gate=deferred();const write=memory.setItem.bind(memory);memory.setItem=()=>gate.promise;
  const service=new StorageService({storage:memory});const saved=service.saveRun(run());assert.equal(service.saving,true);
  gate.reject(Error('disk blocked'));await assert.rejects(saved,/disk blocked/);assert.equal(service.saving,false);assert.match(service.lastError.message,/disk blocked/);
  memory.setItem=write;await service.saveRun(run());assert.equal(service.saving,false);assert.equal(service.lastError,null);assert.deepEqual(await service.loadRun(),run());
});

test('read and deletion failures are visible and never silently clear the existing save',async()=>{
  const memory=new MemoryStorage();const service=new StorageService({storage:memory});await service.saveRun(run());
  memory.removeItem=()=>{throw Error('deletion blocked');};await assert.rejects(service.clearRun(),/deletion blocked/);assert.equal(service.saving,false);assert.deepEqual(await service.loadRun(),run());
  memory.getItem=()=>{throw Error('read blocked');};await assert.rejects(service.loadRun(),/read blocked/);assert.match(service.lastError.message,/read blocked/);
});

test('records are validated, idempotent, sorted, bounded and returned as private copies',async()=>{
  const memory=new MemoryStorage();const service=new StorageService({storage:memory});assert.deepEqual(await service.loadRecords(),[]);
  await service.saveResult(result());await service.saveResult(result());await service.saveResult(result({id:'run-two',score:900}));
  assert.deepEqual((await service.loadRecords()).map(row=>row.id),['run-two','run-one']);
  const saved=JSON.parse(memory.getItem('dead-drop:records:v1'));assert.equal(saved.schema,1);assert.equal(saved.records.length,2);
  const records=await service.loadRecords();records[0].score=0;assert.equal((await service.loadRecords())[0].score,900);
  for(let i=0;i<24;i++)await service.saveResult(result({id:'extra-'+i,score:1000+i}));
  const limited=await service.loadRecords();assert.equal(limited.length,20);assert.equal(limited[0].score,1023);
});

test('invalid record envelopes and values remain intact and failed writes can retry',async()=>{
  const memory=new MemoryStorage();const service=new StorageService({storage:memory});
  for(const value of [{schema:2,records:[]},{schema:1,records:[result({score:-1})]},{schema:1,records:[result({solved:9})]},{schema:1,records:[result({durationMs:Infinity})]},{schema:1,records:[result({date:'yesterday'})]}]){
    const json=JSON.stringify(value);memory.setItem('dead-drop:records:v1',json);await assert.rejects(service.loadRecords());assert.equal(memory.getItem('dead-drop:records:v1'),json);
  }
  memory.data.delete('dead-drop:records:v1');const write=memory.setItem.bind(memory);memory.setItem=()=>{throw Error('quota');};
  await assert.rejects(service.saveResult(result()),/quota/);assert.equal(service.saving,false);memory.setItem=write;await service.saveResult(result());assert.equal((await service.loadRecords()).length,1);
});

test('hash routes preserve queries and cannot escape the app document',()=>{
  assert.equal(parseRoute('#/play?mode=practice').path,'/play');assert.equal(parseRoute('#/play?mode=practice').params.get('mode'),'practice');
  for(const route of ['https://evil.test/','//evil.test/','/\\evil'])assert.equal(parseRoute(route).path,'/missing');
  const target=routeUrl('/play?mode=practice','https://example.test/game/');assert.equal(target.href,'https://example.test/game/#/play?mode=practice');
  assert.equal(routeUrl('/unknown','https://example.test/game/').hash,'#/unknown');
});

// These doubles model only browser-owned history/events; routing and version logic remain real.
function browser(t,{hashes=['#/guide','#/play'],position=hashes.length-1,build='A01',fetcher,dirty=false,onProtect=async()=>false,onUpdate=()=>{}}={}){
  const events=new EventTarget();const document=new EventTarget();document.hidden=false;
  const entries=hashes.map((hash,index)=>({url:'https://example.test/game/'+hash,state:{deadDrop:{key:'session-one',index}}}));
  let cursor=position,current=new URL(entries[cursor].url),isDirty=dirty,isSaving=false;
  const documents=[],rendered=[],errors=[],traversals=[];
  const location={get href(){return current.href;},get hash(){return current.hash;},assign:url=>documents.push({kind:'assign',url:new URL(url)}),replace:url=>documents.push({kind:'replace',url:new URL(url)})};
  const history={get state(){return entries[cursor].state;},replaceState:(state,unused,url)=>{current=new URL(url);entries[cursor]={url:current.href,state};},pushState:(state,unused,url)=>{current=new URL(url);entries.splice(cursor+1);entries.push({url:current.href,state});cursor++;},go:delta=>traversals.push(delta)};
  const globals={addEventListener:events.addEventListener.bind(events),document,location,history};
  const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const version=new VersionService({baseUrl:'https://example.test/game/',loadedBuild:'A01',fetcher:fetcher||(async()=>response({buildId:build}))});
  const router=new Router({baseUrl:'https://example.test/game/',version,readState:()=>({dirty:isDirty,saving:isSaving}),onNavigate:async route=>rendered.push(route.path),onProtect:args=>onProtect(args,()=>{isDirty=false;isSaving=false;}),onUpdate:()=>onUpdate({setDirty:value=>{isDirty=value;},setSaving:value=>{isSaving=value;}}),onError:error=>errors.push(error)});
  const traverse=(index,{emitHash=true,emitPop=true}={})=>{assert.ok(index>=0&&index<entries.length);cursor=index;current=new URL(entries[cursor].url);if(emitPop)events.dispatchEvent(new Event('popstate'));if(emitHash)events.dispatchEvent(new Event('hashchange'));};
  const flushOneHistory=async()=>{const delta=traversals.shift();assert.notEqual(delta,undefined);traverse(cursor+delta);await flush();};
  const flushHistory=async()=>{for(let count=0;traversals.length&&count<12;count++)await flushOneHistory();};
  t.after(()=>{router.dispose();for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  return {router,version,location,history,documents,rendered,errors,events,document,traversals,traverse,flushHistory,flushOneHistory,setDirty:value=>{isDirty=value;},setSaving:value=>{isSaving=value;},get cursor(){return cursor;}};
}

test('changed clean links force a new document URL with randomized query and intended fragment',async t=>{
  const app=browser(t,{build:'B01'});await app.router.navigate('/guide');assert.equal(app.documents.length,1);
  const first=app.documents[0];assert.equal(first.kind,'assign');assert.equal(first.url.pathname,'/game/');assert.equal(first.url.hash,'#/guide');assert.ok(first.url.searchParams.get('_dd')?.startsWith('B01-'));
  await app.router.navigate('/records');assert.notEqual(app.documents[1].url.search,first.url.search);assert.equal(app.history.state.deadDrop.key,'session-one');
});

test('changed Back replaces the traversed entry as a document and preserves intended route',async t=>{
  const app=browser(t,{build:'B01'});app.traverse(0);await flush();assert.equal(app.documents.length,1);assert.equal(app.documents[0].kind,'replace');assert.equal(app.documents[0].url.hash,'#/guide');assert.ok(app.documents[0].url.searchParams.has('_dd'));
});

test('cancel after Back and a new link during lookup restores the displayed route and history index',async t=>{
  const lookup=deferred();let protects=0;const app=browser(t,{dirty:true,fetcher:()=>lookup.promise,onProtect:async()=>{protects++;return false;}});
  app.traverse(0);const clicked=app.router.navigate('/records');await flush();await app.flushHistory();lookup.resolve(response({buildId:'A01'}));await clicked;await flush();
  assert.equal(protects,1);assert.equal(app.location.hash,'#/play');assert.equal(app.router.index,1);assert.equal(app.history.state.deadDrop.index,1);assert.deepEqual(app.rendered,[]);assert.deepEqual(app.errors,[]);
});

test('discard after a superseded Back keeps the original entry before the new route',async t=>{
  const lookup=deferred();const app=browser(t,{dirty:true,fetcher:()=>lookup.promise,onProtect:async(args,discard)=>{discard();return true;}});
  app.traverse(0);const clicked=app.router.navigate('/records');await flush();await app.flushHistory();lookup.resolve(response({buildId:'A01'}));await clicked;await flush();
  assert.equal(app.location.hash,'#/records');assert.equal(app.router.index,2);assert.equal(app.cursor,2);assert.deepEqual(app.rendered,['/records']);
  app.traverse(1);await flush();assert.equal(app.location.hash,'#/play');assert.deepEqual(app.rendered,['/records','/play']);assert.deepEqual(app.errors,[]);
});

test('a delayed duplicate history event does not render the same traversal twice',async t=>{
  const app=browser(t);app.traverse(0,{emitHash:false});await flush();app.events.dispatchEvent(new Event('hashchange'));await flush();assert.deepEqual(app.rendered,['/guide']);assert.deepEqual(app.errors,[]);
});

test('a new edit after update notification still protects the final transition',async t=>{
  let protects=0;const app=browser(t,{build:'B01',onUpdate:controls=>controls.setDirty(true),onProtect:async()=>{protects++;return false;}});
  await app.router.navigate('/records');assert.equal(protects,1);assert.deepEqual(app.documents,[]);assert.deepEqual(app.rendered,[]);
});

test('a save in flight blocks transition even when the active run is clean',async t=>{
  let protects=0;const app=browser(t,{build:'B01',onProtect:async()=>{protects++;return false;}});app.setSaving(true);
  await app.router.navigate('/records');assert.equal(protects,1);assert.deepEqual(app.documents,[]);
});

test('returning focus checks updates without a background document reload',async t=>{
  const app=browser(t,{build:'B01'});app.events.dispatchEvent(new Event('focus'));await flush();assert.equal(app.version.pendingBuild,'B01');assert.deepEqual(app.documents,[]);
  app.events.dispatchEvent(new Event('pageshow'));await flush();assert.deepEqual(app.documents,[]);
});

test('a late edit on approved Back still restores history when a newer link is cancelled',async t=>{
  const lookup=deferred();let requests=0,protects=0;const app=browser(t,{dirty:true,fetcher:()=>++requests>=3?lookup.promise:Promise.resolve(response({buildId:'A01'})),onProtect:async(args,discard)=>{protects++;if(protects===1){discard();return true;}return false;}});
  app.traverse(0);await flush();await app.flushOneHistory();app.setDirty(true);await app.flushOneHistory();
  const clicked=app.router.navigate('/records');await flush();await app.flushHistory();lookup.resolve(response({buildId:'A01'}));await clicked;await flush();
  assert.equal(protects,2);assert.equal(app.location.hash,'#/play');assert.equal(app.router.index,1);assert.equal(app.history.state.deadDrop.index,1);assert.deepEqual(app.rendered,[]);assert.deepEqual(app.errors,[]);
});

test('sound is opt-in and remains safe without an audio implementation',()=>{
  const sound=new SoundService();assert.equal(sound.enabled,false);assert.doesNotThrow(()=>sound.play());assert.doesNotThrow(()=>sound.toggle());assert.equal(typeof sound.enabled,'boolean');assert.doesNotThrow(()=>sound.dispose());
});

test('DOM helper treats hostile dynamic text as text and binds explicit events',t=>{
  class Node {
    constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.textContent='';this.events={};this.dataset={};}
    setAttribute(name,value){this.attrs[name]=String(value);}
    addEventListener(name,fn){this.events[name]=fn;}
    append(...children){this.children.push(...children);}
  }
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:tag=>new Node(tag),createTextNode:value=>({textContent:String(value)})}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  let clicked=false;const node=el('button',{className:'mini-btn',textContent:'<img onerror=alert(1)>',onclick:()=>{clicked=true;},disabled:true,'aria-label':'move'});
  assert.equal(node.textContent,'<img onerror=alert(1)>');assert.equal(node.innerHTML,undefined);assert.equal(node.className,'mini-btn');assert.equal(node.disabled,true);assert.equal(node.attrs['aria-label'],'move');node.events.click();assert.equal(clicked,true);
  const parent=el('div',{},['hello',el('span',{textContent:'world'}),null]);assert.equal(parent.children.length,2);assert.equal(parent.children[0].textContent,'hello');
});

function catalog(label='catalog'){const body=JSON.parse(JSON.stringify(authored));body.levels[0].title=label;return body;}


test('levels load a validated catalog through an absolute fresh app-base URL',async()=>{
  const levels=new LevelService({baseUrl:'https://example.test/nested/game/',fetcher:async(url,options)=>{
    assert.equal(String(url),'https://example.test/nested/game/data/levels.json');assert.equal(options.cache,'no-store');assert.ok(options.signal);return response(catalog());
  }});
  const body=await levels.load();assert.equal(body.schema,1);assert.equal(body.levels.length,8);assert.equal(body.levels[0].title,'catalog');
});

test('level HTTP, malformed schema, invalid DSL, and timeout failures support a later retry',async()=>{
  const malformed=catalog();malformed.levels[0].cards[0].expr.op='eval';
  for(const fetcher of [async()=>response(catalog(),false),async()=>response({schema:1,levels:[]}),async()=>response(malformed),()=>new Promise(()=>{})]){
    const levels=new LevelService({baseUrl:'https://example.test/game/',fetcher,timeoutMs:8});await assert.rejects(levels.load());
    levels.fetcher=async()=>response(catalog('retry'));assert.equal((await levels.load()).levels[0].title,'retry');
  }
});

test('a superseded level request is cancelled promptly even when the fetch ignores abort',async()=>{
  const gates=[deferred(),deferred()];let requests=0;let firstError;
  const levels=new LevelService({baseUrl:'https://example.test/game/',fetcher:()=>gates[requests++].promise});
  const first=levels.load().catch(error=>{firstError=error;});const second=levels.load();gates[1].resolve(response(catalog('new')));
  try{assert.equal((await second).levels[0].title,'new');await flush();assert.equal(firstError?.name,'AbortError');}
  finally{gates[0].resolve(response(catalog('old')));await first;}
});

test('an old delayed JSON body cannot return after a newer catalog was loaded',async()=>{
  const body=deferred();let requests=0;
  const levels=new LevelService({baseUrl:'https://example.test/game/',fetcher:async()=>++requests===1?{ok:true,json:()=>body.promise}:response(catalog('new'))});
  const first=levels.load();const rejected=assert.rejects(first,{name:'AbortError'});await flush();assert.equal((await levels.load()).levels[0].title,'new');body.resolve(catalog('old'));await rejected;
});

test('screen cancellation rejects active data and a pre-aborted signal starts no fetch',async()=>{
  const controller=new AbortController();const gate=deferred();let requests=0;
  const levels=new LevelService({baseUrl:'https://example.test/game/',fetcher:()=>{requests++;return gate.promise;}});
  const active=levels.load({signal:controller.signal});const rejected=assert.rejects(active,{name:'AbortError'});controller.abort();await rejected;
  await assert.rejects(levels.load({signal:controller.signal}),{name:'AbortError'});assert.equal(requests,1);gate.resolve(response(catalog()));
});
