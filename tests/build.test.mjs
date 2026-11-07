import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {build, APP} from '../scripts/build.mjs';
import {createStaticServer} from '../scripts/server.mjs';

test('build embeds identity, hashes the entire module graph and retains old assets', async()=>{
  const a=await build({outDir:'.test-build',tag:'a'});
  const b=await build({outDir:'.test-build',tag:'b'});
  assert.notEqual(a.buildId,b.buildId);
  const html=await readFile(path.join(APP,'.test-build/index.html'),'utf8');
  assert.ok(html.includes(b.buildId)); assert.ok(!/__[A-Z_]+__/.test(html));
  const entry=await readFile(path.join(APP,'.test-build/assets/main.'+b.buildId+'.js'),'utf8');
  assert.ok(entry.includes(b.buildId+'.js'));assert.ok(!entry.includes("from './screens/game-screen.js'"));
  const files=await readdir(path.join(APP,'.test-build/assets'));
  assert.ok(files.includes('main.'+a.buildId+'.js'));assert.ok(files.includes('hero-reactor.'+b.buildId+'.svg'));
  assert.equal(JSON.parse(await readFile(path.join(APP,'.test-build/version.json'))).buildId,b.buildId);
  assert.equal(JSON.parse(await readFile(path.join(APP,'.test-build/data/levels.json'))).levels.length,8);
});
test('HTTP server serves real404s and correct document/asset cache boundaries', async()=>{
  await build({outDir:'.test-build-http'});
  const server=createStaticServer({root:path.join(APP,'.test-build-http')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/dead-drop/';
  try {
    const html=await fetch(base);assert.equal(html.status,200);assert.equal(html.headers.get('cache-control'),'no-store');
    const body=await html.text(); const url=/src="([^"]+main[^"]+)"/.exec(body)[1];
    const asset=await fetch(new URL(url,base));assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control'),/immutable/);
    for(const missing of ['assets/missing.js','api/nope','unrecognized-path']) assert.equal((await fetch(base+missing)).status,404);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
