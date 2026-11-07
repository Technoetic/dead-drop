import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCatalog,validateLevel,runReference,assessPlan,hintFor} from '../src/game/engine.js';
const catalog=JSON.parse(await readFile(new URL('../data/levels.json',import.meta.url),'utf8'));
const levels=catalog.levels;
const dead=[['debug-total'],['fossil','old-tag'],['unit-helper'],['dust'],['helper-a','helper-b','helper-c'],['old-return'],['manual-helper'],['scrap']];
test('Korean instructional text survives UTF-8 storage without replacement characters',()=>{
  for(const level of levels){
    const prose=[level.subtitle,level.mission,level.lesson,level.hint,...level.cards.flatMap(card=>[card.label,card.description]),...level.scenarios.map(scenario=>scenario.label),...level.roots.map(root=>root.label)];
    for(const value of prose){assert.match(value,/[가-힣]/u);assert.doesNotMatch(value,/\?{2,}|\uFFFD/u);}
  }
});
test('eight bounded missions validate and require every dead block to be removed',()=>{
  assert.equal(catalog.id,'dead-drop-v1');assert.equal(validateCatalog(catalog),catalog);
  levels.forEach((level,index)=>{assert.equal(validateLevel(level),level);const result=assessPlan(level,dead[index]);assert.equal(result.correct,true,`${level.id}: ${result.message}`);assert.deepEqual(result.required,dead[index]);assert.equal(assessPlan(level,[]).correct,false);if(dead[index].length>1)assert.equal(assessPlan(level,dead[index].slice(1)).correct,false);});
});
test('reference observations are independently calculated and effects keep order',()=>{
  const values=[6,'A',12,8,'TOTAL:12',42,'READY','screen A'];
  levels.forEach((level,index)=>assert.equal(runReference(level).output[0].value,values[index],level.id));
  assert.deepEqual(runReference(levels[5]).effects,[{root:'payment-notice',channel:'notify',value:'PAID 42'},{root:'persist-order',channel:'store',value:'order-7'}]);
  assert.equal(runReference(levels[6]).output[1].kind,'callback');assert.equal(runReference(levels[6]).output[1].value,'READY:open');
});
test('one scenario trace cannot prove an alternate path dead',()=>{
  const level=levels[3];assert.equal(runReference(level).trace.includes('express'),false);assert.equal(runReference(level,1).trace.includes('express'),true);
  const result=assessPlan(level,['dust','express']);assert.equal(result.correct,false);assert.equal(result.counterexample.scenarioId,'vip');assert.equal(result.counterexample.expected.output[0].value,3);assert.match(result.counterexample.error,/express/);assert.match(result.message,/express/);
});
test('lazy branches permit unreachable dependencies but missing live blocks identify the scenario',()=>{
  assert.equal(runReference(levels[1]).trace.includes('fossil'),false);assert.equal(assessPlan(levels[1],dead[1]).correct,true);
  const result=assessPlan(levels[0],['debug-total','base']);assert.equal(result.correct,false);assert.match(result.counterexample.error,/base/);assert.deepEqual(result.counterexample.input,{amount:3});assert.ok(result.trace.includes('result'));
});
test('uncalled transitive helpers are dead while effects and callback roots remain',()=>{
  for(const index of [2,4])assert.equal(assessPlan(levels[index],dead[index]).correct,true);
  for(const [index,id] of [[5,'notify'],[5,'save'],[6,'on-open']]){const result=assessPlan(levels[index],[...dead[index],id]);assert.equal(result.correct,false);assert.match(result.counterexample.error,new RegExp(id));}
});
test('unknown external use preserves dependencies outside the runtime trace',()=>{
  const level=levels[7];assert.equal(runReference(level).trace.includes('partner-path'),false);const result=assessPlan(level,['scrap','partner-path']);assert.equal(result.correct,false);assert.match(result.message,/외부|알 수/);assert.match(result.message,/partner-path/);assert.equal(assessPlan(level,['scrap']).correct,true);
});
test('removed IDs are checked and displayed code is never executed',()=>{
  for(const plan of [['missing'],['base','base'],'base',[null]])assert.equal(assessPlan(levels[0],plan).correct,false);
  const level=structuredClone(levels[0]);level.cards[0].code='globalThis.__deadDropExecuted = true; throw Error("display");';assert.equal(runReference(level).output[0].value,6);assert.equal(globalThis.__deadDropExecuted,undefined);
  const before=structuredClone(level);assessPlan(level,['debug-total']);assert.deepEqual(level,before);assert.equal(hintFor(level,[]).cardId,'debug-total');
});
test('catalog rejects arbitrary instructions, prototype keys, cycles and oversized structures',()=>{
  const reject=change=>{const copy=structuredClone(catalog);change(copy);assert.throws(()=>validateCatalog(copy));};
  reject(c=>c.schema=2);reject(c=>c.extra='ignored');reject(c=>c.levels[1].id=c.levels[0].id);reject(c=>c.levels[0].cards[0].expr={op:'eval',code:'alert(1)'});reject(c=>c.levels[0].cards[0].expr.extra=true);reject(c=>c.levels[0].cards[0].expr={op:'input',key:'constructor'});reject(c=>c.levels[0].cards[0].expr={op:'ref',id:'result'});reject(c=>c.levels[0].cards[0].expr={op:'ref',id:'missing'});reject(c=>c.levels[0].cards[0].expr={op:'const',value:Infinity});reject(c=>c.levels[0].scenarios[0].input={amount:{nested:true}});reject(c=>c.levels[0].scenarios[0].input.amount='bad arithmetic');reject(c=>c.levels[0].cards[0].expr={op:'const',value:'x'.repeat(5000)});reject(c=>c.levels[0].cards.push(...Array.from({length:30},(_,i)=>({...c.levels[0].cards[0],id:`extra-${i}`}))));reject(c=>{let expr={op:'const',value:0};for(let i=0;i<20;i++)expr={op:'add',args:[expr,{op:'const',value:1}]};c.levels[0].cards[0].expr=expr;});reject(c=>c.levels[0].roots[0].type='javascript');
});
test('invalid scenario indices fail and reference results are defensive values',()=>{
  assert.throws(()=>runReference(levels[0],-1));assert.throws(()=>runReference(levels[0],999));const run=runReference(levels[0]);run.output[0].value=999;run.trace.push('alien');assert.equal(runReference(levels[0]).output[0].value,6);
});
test('validation rejects accessor instructions and sparse or decorated arrays without executing them',()=>{
  let executions=0;const copy=structuredClone(catalog);
  Object.defineProperty(copy.levels[0].cards[0].expr,'op',{get(){executions++;return 'const';}});
  assert.throws(()=>validateCatalog(copy));assert.equal(executions,0);
  const removed=[];removed[Symbol('extra')]='debug-total';assert.equal(assessPlan(levels[0],removed).correct,false);
  const sparse=Array(1);sparse.extra='debug-total';assert.equal(assessPlan(levels[0],sparse).correct,false);
});
