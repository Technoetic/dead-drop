import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameSession,validateSnapshot} from '../src/game/session.js';
import {assessPlan} from '../src/game/engine.js';
const catalog=JSON.parse(await readFile(new URL('../data/levels.json',import.meta.url),'utf8'));
function clockSession(mode='challenge'){let time=0;const game=new GameSession({catalog,mode,now:()=>time});return {game,add:ms=>time+=ms};}
function solve(game){for(const id of assessPlan(game.level,[]).required)game.toggle(id);return game.check();}
test('clock uses monotonic active deltas and pause prevents hidden time penalties',()=>{
  const {game,add}=clockSession();add(1250);game.tick();assert.equal(game.state.remainingMs,88750);game.pause();add(50000);game.tick();assert.equal(game.state.remainingMs,88750);game.resume();add(750);game.tick();assert.equal(game.state.elapsedMs,2000);add(-500);game.tick();add(800);game.tick();assert.equal(game.state.elapsedMs,2300);
});
test('wrong checks and hints cost five seconds only in challenge and reset combo',()=>{
  const {game}=clockSession();assert.equal(game.check().correct,false);assert.equal(game.state.remainingMs,85000);game.hint();assert.equal(game.state.remainingMs,80000);solve(game);game.advance();assert.equal(game.state.combo,1);game.check();assert.equal(game.state.combo,0);
  const practice=clockSession('practice');practice.add(150000);practice.game.tick();practice.game.check();practice.game.hint();assert.equal(practice.game.finished,false);assert.equal(practice.game.state.remainingMs,90000);assert.equal(practice.game.state.elapsedMs,150000);
});
test('toggle removes and restores known cards with defensive state copies',()=>{
  const {game}=clockSession();assert.equal(game.select('base'),true);assert.equal(game.state.selected,'base');assert.equal(game.toggle('debug-total'),true);assert.deepEqual(game.state.plan,['debug-total']);game.toggle('debug-total');assert.deepEqual(game.state.plan,[]);assert.equal(game.toggle('alien'),false);game.toggle('base');const state=game.state;state.plan.push('alien');assert.deepEqual(game.state.plan,['base']);game.reset();assert.deepEqual(game.state.plan,[]);assert.equal(game.state.selected,null);
});
test('success scores once, blocks cleared edits and cannot skip stages',()=>{
  const {game}=clockSession();assert.equal(solve(game).correct,true);const score=game.state.score;assert.equal(game.state.phase,'cleared');assert.equal(game.state.solved,1);game.check();game.toggle('base');game.reset();assert.equal(game.state.score,score);assert.deepEqual(game.state.plan,['debug-total']);game.advance();game.advance();assert.equal(game.state.index,1);assert.equal(game.state.phase,'editing');
});
test('paused actions are inert and resuming twice cannot erase active time',()=>{
  const {game,add}=clockSession();game.pause();const before=game.snapshot();game.select('base');game.toggle('base');game.check();game.hint();game.reset();game.advance();assert.deepEqual(game.snapshot(),before);game.resume();add(1000);game.resume();assert.equal(game.state.elapsedMs,1000);
});
test('clock and penalty timeouts finish once and block late scoring',()=>{
  const {game,add}=clockSession();game.toggle('debug-total');add(90000);assert.equal(game.check().correct,false);assert.equal(game.finished,true);assert.equal(game.state.score,0);assert.equal(game.state.elapsedMs,90000);const second=clockSession();second.add(86000);second.game.hint();assert.equal(second.game.finished,true);assert.equal(second.game.state.elapsedMs,86000);
});
test('restoration is paused and validates cleared proof without changing saved bytes',()=>{
  const {game,add}=clockSession();add(2000);solve(game);const saved=game.snapshot(),copy=structuredClone(saved);assert.equal(validateSnapshot(saved,catalog),saved);const restored=new GameSession({catalog,snapshot:saved,now:()=>50000});assert.equal(restored.paused,true);restored.advance();assert.equal(restored.state.index,0);restored.resume();restored.advance();assert.equal(restored.state.index,1);assert.deepEqual(saved,copy);
});
test('fabricated values, phases, unknown properties and false cleared proofs fail',()=>{
  const {game}=clockSession();const saved=game.snapshot();const rejects=change=>{const value=structuredClone(saved);change(value);const before=JSON.stringify(value);assert.throws(()=>validateSnapshot(value,catalog));assert.equal(JSON.stringify(value),before);assert.throws(()=>new GameSession({catalog,snapshot:value}));};
  rejects(s=>s.schema=2);rejects(s=>s.catalogId='other');rejects(s=>s.index=8);rejects(s=>s.remainingMs=-1);rejects(s=>s.elapsedMs=NaN);rejects(s=>s.score=Infinity);rejects(s=>s.plan=['unknown']);rejects(s=>s.plan=['base','base']);rejects(s=>s.selected='unknown');rejects(s=>s.solved=7);rejects(s=>s.phase='cleared');rejects(s=>s.extra='ignored');rejects(s=>s.startedAt='nonsense');rejects(s=>s.finishedAt=new Date().toISOString());rejects(s=>{s.phase='cleared';s.solved=1;s.score=1100;s.combo=1;s.maxCombo=1;});rejects(s=>s.remainingMs=90001);rejects(s=>{s.elapsedMs=1000;s.remainingMs=90000;});
});
test('eight practice levels produce a stable result DTO',()=>{
  const {game,add}=clockSession('practice');for(let i=0;i<8;i++){add(1000);assert.equal(solve(game).correct,true);game.advance();}assert.equal(game.finished,true);assert.equal(game.state.solved,8);assert.equal(game.state.maxCombo,8);const result=game.toResult();assert.equal(result.total,8);assert.equal(result.solved,8);assert.equal(result.durationMs,8000);assert.equal(result.id,game.state.runId);game.advance();game.check();assert.deepEqual(game.toResult(),result);assert.equal(validateSnapshot(game.snapshot(),catalog).phase,'finished');
});
test('timeout retains cleared proof and missing dates restore stably',()=>{
  const {game,add}=clockSession();solve(game);add(90000);game.tick();const snapshot=game.snapshot();assert.equal(validateSnapshot(snapshot,catalog),snapshot);const tampered=structuredClone(snapshot);tampered.plan=[];assert.throws(()=>validateSnapshot(tampered,catalog));delete snapshot.startedAt;delete snapshot.finishedAt;const restored=new GameSession({catalog,snapshot});assert.deepEqual(restored.toResult(),restored.toResult());
});
test('spec-only validation stays strict and invalid modes and clocks fail',()=>{
  const {game}=clockSession();const snapshot=game.snapshot();snapshot.runId='run-one';assert.equal(validateSnapshot(snapshot),snapshot);assert.throws(()=>validateSnapshot({...snapshot,plan:['<script>']}));assert.throws(()=>validateSnapshot({...snapshot,selected:'<script>'}));assert.throws(()=>new GameSession({catalog,mode:'speed'}));assert.throws(()=>new GameSession({catalog,now:()=>Infinity}));assert.throws(()=>game.toResult());
});
test('saved plans reject holes, accessors and extra array properties',()=>{
  const {game}=clockSession();const saved=game.snapshot();
  const sparse=Array(1);sparse.extra='base';assert.throws(()=>validateSnapshot({...saved,plan:sparse}));
  const decorated=[];decorated[Symbol('extra')]='base';assert.throws(()=>validateSnapshot({...saved,plan:decorated}));
  let reads=0;const accessor=[];Object.defineProperty(accessor,'0',{get(){reads++;return 'base';}});
  assert.throws(()=>validateSnapshot({...saved,plan:accessor}));assert.equal(reads,0);
});
