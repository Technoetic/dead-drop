import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),project=fileURLToPath(new URL('../',import.meta.url));

test('data-only stage changes produce a new immutable build identity without editing app code',async t=>{
  const parent=path.resolve(tmpdir()),fixture=await mkdtemp(path.join(parent,'dead-drop-build-'));
  t.after(async()=>{assert.equal(path.dirname(fixture),parent);assert.ok(path.basename(fixture).startsWith('dead-drop-build-'));await rm(fixture,{recursive:true,force:true});});
  for(const dir of ['scripts','src/game','src/styles','assets','data'])await mkdir(path.join(fixture,dir),{recursive:true});
  await copyFile(path.join(project,'scripts/build.mjs'),path.join(fixture,'scripts/build.mjs'));
  for(const name of await readdir(path.join(project,'src/game')))if(name.endsWith('.js'))await copyFile(path.join(project,'src/game',name),path.join(fixture,'src/game',name));
  await writeFile(path.join(fixture,'package.json'),'{"type":"module"}');
  await writeFile(path.join(fixture,'src/main.js'),'export const fixture=true;\n');
  for(const name of ['tokens','base','components','home','effects','game'])await writeFile(path.join(fixture,'src/styles',name+'.css'),'body{color:#000}\n');
  for(const name of ['dead-mark','hero-reactor'])await writeFile(path.join(fixture,'assets',name+'.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(fixture,'index.html'),'<meta name="app-build" content="__BUILD_ID__"><script type="module" src="__ENTRY_URL__"></script><link rel="stylesheet" href="__STYLE_URL__"><link rel="icon" href="__ICON_URL__">');
  const data=JSON.parse(await readFile(path.join(project,'data/levels.json'),'utf8'));
  async function build(){await exec(process.execPath,[path.join(fixture,'scripts/build.mjs')],{cwd:fixture});return JSON.parse(await readFile(path.join(fixture,'dist/version.json'),'utf8')).buildId;}
  await writeFile(path.join(fixture,'data/levels.json'),JSON.stringify(data));const first=await build();
  data.levels[0].title+=' / revised';await writeFile(path.join(fixture,'data/levels.json'),JSON.stringify(data));const second=await build();
  assert.notEqual(second,first);assert.equal(await build(),second);
  const html=await readFile(path.join(fixture,'dist/index.html'),'utf8');assert.ok(html.includes(second));assert.ok(!html.includes('__BUILD_ID__'));
});
