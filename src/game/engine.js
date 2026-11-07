// Displayed source is inert text. This bounded JSON graph is the entire executable model.
const CATALOG_ID='dead-drop-v1';
const MAX_STEPS=4096;
const forbidden=new Set(['__proto__','constructor','prototype']);
const clone=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const identity=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value)&&!forbidden.has(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
function record(value,required,optional=[],name='Object') {
  requireValue(plain(value),`${name} must be a plain object.`);
  const allowed=new Set([...required,...optional]);
  requireValue(Reflect.ownKeys(value).every(key=>typeof key==='string'&&allowed.has(key)&&!forbidden.has(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')),`${name} contains an unsupported property.`);
  requireValue(required.every(key=>Object.hasOwn(value,key)),`${name} is missing a required property.`);
}
function list(value,min,max,name) {
  requireValue(Array.isArray(value)&&value.length>=min&&value.length<=max,`${name} must contain ${min}–${max} entries.`);
  const allowed=new Set(['length',...Array.from({length:value.length},(_,index)=>String(index))]);
  requireValue(Reflect.ownKeys(value).length===allowed.size&&Reflect.ownKeys(value).every(key=>allowed.has(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')),`${name} must be a dense data array without extra properties.`);
}
function text(value,name,max=600) {requireValue(typeof value==='string'&&value.length>0&&value.length<=max,`${name} must be nonempty text of at most ${max} characters.`);}
function primitive(value,maxString=512,maxNumber=1000000) {
  return value===null||typeof value==='boolean'||(typeof value==='string'&&value.length<=maxString)||(finite(value)&&Math.abs(value)<=maxNumber);
}
function validateExpression(expr,refs,inputs,budget,depth=0) {
  requireValue(depth<=12&&++budget.nodes<=128,'Expression exceeds the bounded graph limit.');
  requireValue(plain(expr),'Expression requires a registered op.');
  const operation=Object.getOwnPropertyDescriptor(expr,'op');
  requireValue(operation&&Object.hasOwn(operation,'value')&&typeof operation.value==='string','Expression requires a data op.');
  switch(expr.op) {
    case 'const':record(expr,['op','value'],[],'Constant');requireValue(primitive(expr.value),'Constant must be a bounded primitive.');break;
    case 'input':record(expr,['op','key'],[],'Input');requireValue(identity(expr.key),'Input key is unsafe or invalid.');inputs.add(expr.key);break;
    case 'ref':record(expr,['op','id'],[],'Reference');requireValue(identity(expr.id),'Reference ID is invalid.');refs.add(expr.id);break;
    case 'add':case 'mul':case 'concat':case 'eq':
      record(expr,['op','args'],[],'Binary expression');list(expr.args,2,2,'Arguments');
      for(const child of expr.args)validateExpression(child,refs,inputs,budget,depth+1);break;
    case 'choose':
      record(expr,['op','test','yes','no'],[],'Lazy choice');
      for(const key of ['test','yes','no'])validateExpression(expr[key],refs,inputs,budget,depth+1);break;
    default:throw new TypeError(`Unsupported expression op: ${String(expr.op).slice(0,40)}.`);
  }
}
function shape(level) {
  record(level,['id','title','subtitle','mission','lesson','cards','scenarios','roots','hint'],[],'Level');
  requireValue(identity(level.id),'Level ID is invalid.');
  for(const key of ['title','subtitle','mission','lesson','hint'])text(level[key],key,1200);
  list(level.cards,2,24,'Cards');list(level.scenarios,2,12,'Scenarios');list(level.roots,1,12,'Roots');
  const cards=new Map(),dependencies=new Map(),inputs=new Set();
  for(const card of level.cards) {
    record(card,['id','label','description','code','expr'],[],'Card');
    requireValue(identity(card.id)&&!cards.has(card.id),'Card IDs must be unique and valid.');
    text(card.label,'Card label',120);text(card.description,'Card description',600);text(card.code,'Display code',2400);
    const refs=new Set();validateExpression(card.expr,refs,inputs,{nodes:0});cards.set(card.id,card);dependencies.set(card.id,refs);
  }
  for(const [id,refs] of dependencies)for(const ref of refs)requireValue(cards.has(ref),`Block "${id}" refers to unknown block "${ref}".`);
  const visiting=new Set(),visited=new Set();
  function visit(id){requireValue(!visiting.has(id),`Dependency cycle includes "${id}".`);if(visited.has(id))return;visiting.add(id);for(const ref of dependencies.get(id))visit(ref);visiting.delete(id);visited.add(id);}
  for(const id of cards.keys())visit(id);
  const scenarios=new Set();
  for(const scenario of level.scenarios) {
    record(scenario,['id','label','input'],[],'Scenario');requireValue(identity(scenario.id)&&!scenarios.has(scenario.id),'Scenario IDs must be unique and valid.');scenarios.add(scenario.id);text(scenario.label,'Scenario label',120);
    requireValue(plain(scenario.input)&&Reflect.ownKeys(scenario.input).length<=16,'Scenario input must be a small primitive record.');
    for(const key of Reflect.ownKeys(scenario.input))requireValue(identity(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(scenario.input,key),'value')&&primitive(scenario.input[key]),'Scenario input contains an unsafe key or value.');
    for(const key of inputs)requireValue(Object.hasOwn(scenario.input,key),`Scenario "${scenario.id}" is missing input "${key}".`);
  }
  const roots=new Set();
  for(const root of level.roots) {
    record(root,['id','type','label','card'],['channel','unknown'],'Root');
    requireValue(identity(root.id)&&!roots.has(root.id),'Root IDs must be unique and valid.');roots.add(root.id);text(root.label,'Root label',120);
    requireValue(['output','effect','callback','external'].includes(root.type)&&cards.has(root.card),'Root type or target is invalid.');
    if(root.type==='effect')requireValue(['notify','store'].includes(root.channel)&&!Object.hasOwn(root,'unknown'),'Effects require a registered channel.');
    else requireValue(!Object.hasOwn(root,'channel'),'Only effect roots have channels.');
    if(root.type==='external')requireValue(root.unknown===true,'External callers must retain the unknown-use boundary.');
    else requireValue(!Object.hasOwn(root,'unknown'),'Only external roots have unknown callers.');
  }
  return {cards,dependencies};
}
function execute(level,scenarioIndex,removed=new Set()) {
  const scenario=level.scenarios[scenarioIndex],cards=new Map(level.cards.map(card=>[card.id,card]));
  const trace=[],output=[],effects=[],cache=new Map();let steps=0;
  const step=()=>requireValue(++steps<=MAX_STEPS,'지원하는 실행 단계 한도를 넘었습니다.');
  function evaluate(expr,from) {
    step();
    switch(expr.op) {
      case 'const':return expr.value;
      case 'input':return scenario.input[expr.key];
      case 'ref':return block(expr.id,from);
      case 'choose':{const test=evaluate(expr.test,from);requireValue(typeof test==='boolean',`"${from}"의 분기 조건은 참 또는 거짓이어야 합니다.`);return evaluate(test?expr.yes:expr.no,from);}
      default:{
        const [left,right]=expr.args.map(child=>evaluate(child,from));let value;
        if(expr.op==='eq')return left===right;
        if(expr.op==='concat')value=String(left)+String(right);
        else {requireValue(finite(left)&&finite(right),`"${from}"의 계산에는 유한한 숫자가 필요합니다.`);value=expr.op==='add'?left+right:left*right;}
        requireValue(primitive(value,4096,1e12),`"${from}"의 결과가 지원하는 값의 범위를 넘었습니다.`);return value;
      }
    }
  }
  function block(id,from) {
    step();requireValue(!removed.has(id),`필요한 블록 "${id}"을(를) 제거했습니다. "${from}"에서 이 블록을 참조합니다.`);
    if(cache.has(id))return cache.get(id);
    trace.push(id);const value=evaluate(cards.get(id).expr,id);cache.set(id,value);return value;
  }
  try {
    for(const root of level.roots) {
      const value=block(root.card,`root:${root.id}`);
      if(root.type==='effect')effects.push({root:root.id,channel:root.channel,value});
      else output.push({root:root.id,kind:root.type,value});
    }
    return {output,effects,trace,scenarioId:scenario.id};
  }catch(error){return {output,effects,trace,scenarioId:scenario.id,error:error instanceof Error?error.message:'실행을 완료할 수 없습니다.'};}
}
function analyze(level,metadata=shape(level)) {
  const references=level.scenarios.map((_,index)=>execute(level,index)),live=new Set(references.flatMap(run=>run.trace)),external=new Map();
  function protect(id,root){if(external.has(id))return;external.set(id,root);live.add(id);for(const dependency of metadata.dependencies.get(id))protect(dependency,root);}
  for(const root of level.roots)if(root.type==='external')protect(root.card,root.id);
  return {references,external,required:level.cards.filter(card=>!live.has(card.id)).map(card=>card.id)};
}
const observation=run=>({output:clone(run.output),effects:clone(run.effects),...(run.error?{error:run.error}:{})});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function removalSet(level,removed) {
  list(removed,0,level.cards.length,'Removal plan');const known=new Set(level.cards.map(card=>card.id));
  requireValue(removed.every(id=>identity(id)&&known.has(id)),'Removal plan contains an unknown block.');
  requireValue(new Set(removed).size===removed.length,'A block cannot be removed twice.');return new Set(removed);
}
export function validateLevel(level) {
  const metadata=shape(level),{references,required}=analyze(level,metadata);
  requireValue(references.every(run=>!run.error),`Reference program failed: ${references.find(run=>run.error)?.error||''}`);
  requireValue(required.length>0,'Every mission must contain at least one dead block.');
  const removed=new Set(required);
  references.forEach((reference,index)=>requireValue(same(observation(reference),observation(execute(level,index,removed))),'Dead-block removal changed a declared observation.'));
  return level;
}
export function validateCatalog(catalog) {
  record(catalog,['schema','id','levels'],[],'Catalog');requireValue(catalog.schema===1&&catalog.id===CATALOG_ID,'Unsupported catalog identity or schema.');
  list(catalog.levels,8,8,'Levels');const ids=new Set();
  for(const level of catalog.levels){validateLevel(level);requireValue(!ids.has(level.id),'Level IDs must be unique.');ids.add(level.id);}
  requireValue(JSON.stringify(catalog).length<=131072,'Catalog exceeds the bounded size limit.');return catalog;
}
export function runReference(level,scenarioIndex=0) {
  shape(level);requireValue(Number.isInteger(scenarioIndex)&&scenarioIndex>=0&&scenarioIndex<level.scenarios.length,'Scenario index is outside the declared finite model.');return execute(level,scenarioIndex);
}
export function assessPlan(level,removedIds) {
  let analysis,removed,expected={output:[],effects:[]};
  try {
    analysis=analyze(level);requireValue(analysis.references.every(run=>!run.error),'Reference program is invalid.');
    expected=observation(analysis.references[0]);removed=removalSet(level,removedIds);
  }catch(error){return {correct:false,message:error.message,expected,actual:{output:[],effects:[]},trace:[],removed:[],required:analysis?.required||[]};}
  const common={removed:[...removed],required:analysis.required};let preview;
  for(let index=0;index<level.scenarios.length;index++) {
    const actual=execute(level,index,removed);preview??=actual;const reference=analysis.references[index];
    if(actual.error||!same(observation(reference),observation(actual))) {
      const scenario=level.scenarios[index];
      return {correct:false,message:`${scenario.label}: ${actual.error||'출력 또는 관찰 가능한 효과의 순서가 달라졌습니다.'}`,expected:observation(reference),actual:observation(actual),trace:actual.trace,...common,counterexample:{scenarioId:scenario.id,label:scenario.label,input:clone(scenario.input),expected:observation(reference),actual:observation(actual),...(actual.error?{error:actual.error}:{})}};
    }
  }
  const protectedId=[...removed].find(id=>analysis.external.has(id));
  if(protectedId)return {correct:false,message:`외부 진입점 "${analysis.external.get(protectedId)}"의 호출 조건을 알 수 없어 "${protectedId}"은(는) 유지해야 합니다. 실행 흔적에 없다는 이유로 제거할 수 없습니다.`,expected,actual:observation(preview),trace:preview.trace,...common};
  const incomplete=analysis.required.filter(id=>!removed.has(id));
  if(incomplete.length)return {correct:false,message:`죽은 블록 ${incomplete.length}개가 남아 있습니다. 선언된 진입점과 시나리오에서 사용하지 않는 블록을 모두 제거하세요.`,expected,actual:observation(preview),trace:preview.trace,...common};
  return {correct:true,message:'선언된 모든 시나리오에서 출력·콜백 결과·효과 순서를 보존했습니다. 죽은 블록을 모두 제거했습니다.',expected,actual:observation(preview),trace:preview.trace,...common};
}
export function hintFor(level,removedIds=[]) {
  const result=assessPlan(level,removedIds);
  if(result.counterexample)return {message:result.message};
  const protectedId=result.removed.find(id=>!result.required.includes(id));
  if(protectedId)return {message:result.message,cardId:protectedId};
  const id=result.required.find(candidate=>!result.removed.includes(candidate));
  return id?{message:`${level.hint} "${level.cards.find(card=>card.id===id).label}"을(를) 살펴보세요.`,cardId:id}:{message:'모델 내 정리가 끝났습니다. 제거 검증을 실행하세요.'};
}
