import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateLevel,validateCatalog} from '../src/game/engine.js';

export const APP=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=value=>createHash('sha256').update(value).digest('hex');
const posix=value=>value.replaceAll('\\','/');
async function walk(root){const files=[];for(const entry of await readdir(root,{withFileTypes:true})){const full=path.join(root,entry.name);if(entry.isDirectory())files.push(...await walk(full));else files.push(full);}return files.sort();}

export async function build({outDir='dist',tag=''}={}){
  const out=path.resolve(APP,outDir);
  if(!out.startsWith(APP+path.sep)||out===path.join(APP,'src'))throw Error('Build output must stay in the app directory');
  if(tag&&!/^[a-z\d-]{1,20}$/i.test(tag))throw Error('Invalid build tag');
  const jsFiles=(await walk(path.join(APP,'src'))).filter(file=>file.endsWith('.js'));
  const styles=['tokens','base','components','home','effects','game'];
  const css=await Promise.all(styles.map(name=>readFile(path.join(APP,'src/styles',name+'.css'),'utf8')));
  const template=await readFile(path.join(APP,'index.html'),'utf8');
  const sources=await Promise.all(jsFiles.map(async file=>({file,relative:posix(path.relative(path.join(APP,'src'),file)),text:await readFile(file,'utf8')})));
  const svgs=await Promise.all(['dead-mark','hero-reactor'].map(async name=>({name,text:await readFile(path.join(APP,'assets',name+'.svg'),'utf8')})));
  const levelBytes=await readFile(path.join(APP,'data/levels.json'),'utf8');
  validateCatalog(JSON.parse(levelBytes));
  const buildId='dd-'+digest(levelBytes+template+css.join('\n')+sources.map(file=>file.relative+'\n'+file.text).join('\n')+svgs.map(s=>s.text).join('\n')).slice(0,12)+(tag?'-'+tag.toLowerCase():'');
  const mapping=new Map(sources.map(file=>[file.relative,file.relative.replace(/\.js$/,'.'+buildId+'.js')]));
  for(const source of sources){
    const text=source.text.replace(/\b(from\s*|import\s*)(['"])(\.[^'"]+)\2/g,(whole,prefix,quote,specifier)=>{
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(source.relative),specifier));
      const destination=mapping.get(dependency);if(!destination)throw Error('Unknown module '+specifier+' in '+source.relative);
      let relative=path.posix.relative(path.posix.dirname(mapping.get(source.relative)),destination);if(!relative.startsWith('.'))relative='./'+relative;
      return prefix+quote+relative+quote;
    });
    const destination=path.join(out,'assets',mapping.get(source.relative));await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,text);
  }
  await mkdir(path.join(out,'data'),{recursive:true});
  for(const svg of svgs)await writeFile(path.join(out,'assets',svg.name+'.'+buildId+'.svg'),svg.text);
  const authored=JSON.parse(levelBytes);
  const data=Array.isArray(authored)?{schema:1,levels:authored}:authored;
  if(data.schema!==1||!Array.isArray(data.levels)||data.levels.length!==8)throw Error('Eight validated levels are required');
  data.levels.forEach(validateLevel);
  await writeFile(path.join(out,'data/levels.json'),JSON.stringify(data));
  await writeFile(path.join(out,'assets',`app.${buildId}.css`),css.join('\n'));
  const html=template.replaceAll('__BUILD_ID__',buildId).replaceAll('__ICON_URL__','./assets/dead-mark.'+buildId+'.svg').replaceAll('__STYLE_URL__',`./assets/app.${buildId}.css`).replaceAll('__ENTRY_URL__',`./assets/${mapping.get('main.js')}`);
  if(/__[A-Z_]+__/.test(html))throw Error('Unresolved HTML placeholder');
  await writeFile(path.join(out,'index.html'),html);
  await writeFile(path.join(out,'version.json'),JSON.stringify({schema:1,buildId})+'\n');
  const report={buildId,out,modules:sources.length,levels:data.levels.length,externalDependencies:0,retainedOlderAssets:true};
  console.log(JSON.stringify(report));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
  await build({outDir:option('--out')||'dist',tag:option('--tag')||''});
}
