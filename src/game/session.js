import {validateCatalog,assessPlan,hintFor} from './engine.js';
const LIMIT=90000;
const MAX_ELAPSED=31*24*60*60*1000;
const clone=value=>structuredClone(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const cardId=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const densePlan=value=>{
  if(!Array.isArray(value)||value.length>24)return false;
  const allowed=new Set(['length',...Array.from({length:value.length},(_,index)=>String(index))]);
  return Reflect.ownKeys(value).length===allowed.size&&Reflect.ownKeys(value).every(key=>allowed.has(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
};
const inactive=message=>({correct:false,message,expected:{output:[],effects:[]},actual:{output:[],effects:[]},trace:[],removed:[],required:[]});
const requiredFields=['schema','catalogId','runId','mode','index','remainingMs','elapsedMs','score','combo','maxCombo','solved','plan','selected','phase'];
const allowedFields=new Set([...requiredFields,'startedAt','finishedAt']);
// At most eight solves: enumerate legal combo resets to reject impossible score tuples.
function possibleScore(value,currentCleared) {
  let possibilities=[{score:0,combo:0,maxCombo:0}];
  for(let round=0;round<value.solved;round++) {
    const next=new Map();
    for(const prior of possibilities)for(const base of new Set([prior.combo,0])) {
      const combo=base+1,row={score:prior.score+1000+100*combo,combo,maxCombo:Math.max(prior.maxCombo,combo)};
      next.set(`${row.score}:${row.combo}:${row.maxCombo}`,row);
    }
    possibilities=[...next.values()];
  }
  return possibilities.some(row=>row.score===value.score&&row.maxCombo===value.maxCombo&&(row.combo===value.combo||(!currentCleared&&value.combo===0)));
}
/** Validate without changing the caller's retained saved bytes. Local scores are not an anti-cheat boundary. */
export function validateSnapshot(value,catalog) {
  requireValue(plain(value),'Saved progress must be a plain object.');
  requireValue(Reflect.ownKeys(value).every(key=>typeof key==='string'&&allowedFields.has(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'))&&requiredFields.every(key=>Object.hasOwn(value,key)),'Saved progress has unknown or missing properties.');
  requireValue(value.schema===1&&value.catalogId==='dead-drop-v1','Unsupported saved progress version. The original save is retained.');
  requireValue(identifier(value.runId),'Saved run ID is invalid.');requireValue(['challenge','practice'].includes(value.mode),'Saved mode is invalid.');
  requireValue(integer(value.index,0,7),'Saved level index is invalid.');
  requireValue(finite(value.remainingMs,0,LIMIT)&&finite(value.elapsedMs,0,MAX_ELAPSED),'Saved clock values are invalid.');
  requireValue(integer(value.score,0,11600)&&value.score%100===0&&integer(value.combo,0,8)&&integer(value.maxCombo,0,8),'Saved score values are invalid.');
  requireValue(integer(value.solved,0,8)&&value.combo<=value.maxCombo&&value.maxCombo<=value.solved,'Saved combo or solved count is invalid.');
  requireValue(['editing','cleared','finished'].includes(value.phase),'Saved phase is invalid.');
  requireValue(densePlan(value.plan)&&value.plan.every(cardId)&&new Set(value.plan).size===value.plan.length,'Saved removal plan is invalid.');
  requireValue(value.selected===null||cardId(value.selected),'Saved selection is invalid.');
  if(value.startedAt!==undefined)requireValue(validDate(value.startedAt),'Saved start date is invalid.');
  if(value.finishedAt!==undefined&&value.finishedAt!==null)requireValue(validDate(value.finishedAt),'Saved finish date is invalid.');
  requireValue(value.phase==='finished'||value.finishedAt===null||value.finishedAt===undefined,'An active run cannot have a finish date.');
  requireValue(value.mode!=='practice'||value.remainingMs===LIMIT,'Practice mode cannot spend countdown time.');
  requireValue(value.mode!=='challenge'||value.remainingMs<=Math.max(0,LIMIT-value.elapsedMs),'Saved countdown exceeds remaining active time.');
  if(value.phase==='editing')requireValue(value.solved===value.index&&value.remainingMs>0,'Editing phase does not match the solved count.');
  if(value.phase==='cleared')requireValue(value.solved===value.index+1&&value.remainingMs>0,'Cleared phase does not match the solved count.');
  if(value.phase==='finished') {
    const complete=value.index===7&&value.solved===8;
    const timeout=value.mode==='challenge'&&value.remainingMs===0&&[value.index,value.index+1].includes(value.solved);
    requireValue(complete||timeout,'Saved run has no valid finish condition.');
  }
  const currentCleared=value.phase==='cleared'||(value.phase==='finished'&&value.solved===value.index+1);
  requireValue(possibleScore(value,currentCleared),'Saved score and combo cannot arise from this solved count.');
  if(catalog) {
    validateCatalog(catalog);requireValue(catalog.id===value.catalogId,'Saved catalog identity is incompatible.');
    const level=catalog.levels[value.index],known=new Set(level.cards.map(card=>card.id));
    requireValue(value.plan.every(id=>known.has(id))&&(value.selected===null||known.has(value.selected)),'Saved progress refers to an unknown block.');
    if(currentCleared)requireValue(assessPlan(level,value.plan).correct,'Saved cleared plan does not preserve the declared model.');
  }
  return value;
}
export class GameSession {
  #catalog;#state;#now;#lastTime;#paused=false;#lastResult=null;
  constructor({catalog,mode='challenge',snapshot=null,now=()=>performance.now()}) {
    validateCatalog(catalog);requireValue(typeof now==='function','A clock function is required.');this.#catalog=clone(catalog);this.#now=now;
    if(snapshot!==null) {
      validateSnapshot(snapshot,this.#catalog);this.#state=clone(snapshot);this.#paused=true;
      this.#state.startedAt??=new Date().toISOString();if(this.#state.phase==='finished')this.#state.finishedAt??=this.#state.startedAt;
      if(this.#state.phase==='cleared')this.#lastResult=assessPlan(this.level,this.#state.plan);
    }else {
      requireValue(['challenge','practice'].includes(mode),'Unsupported game mode.');
      const runId=globalThis.crypto?.randomUUID?.()??`drop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`;
      this.#state={schema:1,catalogId:catalog.id,runId,mode,index:0,remainingMs:LIMIT,elapsedMs:0,score:0,combo:0,maxCombo:0,solved:0,plan:[],selected:null,phase:'editing',startedAt:new Date().toISOString(),finishedAt:null};
    }
    this.#lastTime=this.#readTime();
  }
  #readTime(){const value=this.#now();requireValue(typeof value==='number'&&Number.isFinite(value),'Monotonic clock returned an invalid value.');return value;}
  get level(){return clone(this.#catalog.levels[this.#state.index]);}
  get state(){return clone(this.#state);}
  get paused(){return this.#paused;}
  get finished(){return this.#state.phase==='finished';}
  get lastResult(){return this.#lastResult?clone(this.#lastResult):null;}
  #finish(){if(!this.finished){this.#state.phase='finished';this.#state.finishedAt=new Date().toISOString();}}
  tick() {
    const time=this.#readTime(),delta=Math.max(0,time-this.#lastTime);this.#lastTime=Math.max(this.#lastTime,time);
    if(!this.#paused&&!this.finished) {
      const active=this.#state.mode==='challenge'?Math.min(delta,this.#state.remainingMs):Math.min(delta,MAX_ELAPSED-this.#state.elapsedMs);
      this.#state.elapsedMs=Math.min(MAX_ELAPSED,this.#state.elapsedMs+active);
      if(this.#state.mode==='challenge'){this.#state.remainingMs=Math.max(0,this.#state.remainingMs-active);if(this.#state.remainingMs===0)this.#finish();}
    }
    return this.state;
  }
  #editable(){this.tick();return !this.#paused&&!this.finished&&this.#state.phase==='editing';}
  #known(id){return this.#catalog.levels[this.#state.index].cards.some(card=>card.id===id);}
  select(id){if(!this.#editable()||!this.#known(id))return false;this.#state.selected=id;return true;}
  toggle(id) {
    if(!this.#editable()||!this.#known(id))return false;
    const index=this.#state.plan.indexOf(id);if(index<0)this.#state.plan.push(id);else this.#state.plan.splice(index,1);
    this.#state.selected=id;this.#lastResult=null;return true;
  }
  reset(){if(!this.#editable())return false;this.#state.plan=[];this.#state.selected=null;this.#lastResult=null;return true;}
  #penalty(){this.#state.combo=0;if(this.#state.mode==='challenge'){this.#state.remainingMs=Math.max(0,this.#state.remainingMs-5000);if(this.#state.remainingMs===0)this.#finish();}}
  check() {
    if(!this.#editable())return this.#state.phase==='cleared'&&this.#lastResult?this.lastResult:inactive(this.#paused?'일시 정지를 해제한 뒤 제거 검증을 실행하세요.':'이 라운드는 더 이상 수정할 수 없습니다.');
    const result=assessPlan(this.level,this.#state.plan);this.#lastResult=result;
    if(result.correct){this.#state.phase='cleared';this.#state.solved++;this.#state.combo++;this.#state.maxCombo=Math.max(this.#state.maxCombo,this.#state.combo);this.#state.score+=1000+100*this.#state.combo;}
    else this.#penalty();return clone(result);
  }
  advance() {
    this.tick();if(this.#paused||this.finished||this.#state.phase!=='cleared')return false;
    if(this.#state.index===this.#catalog.levels.length-1){this.#finish();return true;}
    this.#state.index++;this.#state.plan=[];this.#state.selected=null;this.#state.phase='editing';this.#lastResult=null;return true;
  }
  hint(){if(!this.#editable())return {message:this.#paused?'일시 정지를 해제한 뒤 힌트를 사용하세요.':'편집 중인 라운드에서 힌트를 사용할 수 있습니다.'};const hint=hintFor(this.level,this.#state.plan);this.#penalty();return hint;}
  pause(){this.tick();this.#paused=true;return this.state;}
  resume(){if(!this.#paused)return this.tick();this.#lastTime=Math.max(this.#lastTime,this.#readTime());this.#paused=false;return this.state;}
  snapshot(){this.tick();return this.state;}
  toResult() {
    this.tick();requireValue(this.finished,'Finish the run before creating a result.');
    return {id:this.#state.runId,mode:this.#state.mode,score:this.#state.score,total:8,solved:this.#state.solved,durationMs:this.#state.elapsedMs,maxCombo:this.#state.maxCombo,date:this.#state.finishedAt||this.#state.startedAt};
  }
}
