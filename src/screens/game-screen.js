import {runReference} from '../game/engine.js';
import {GameSession} from '../game/session.js';

const node=(tag,cls,text)=>{const element=document.createElement(tag);if(cls)element.className=cls;if(text!==undefined)element.textContent=String(text);return element;};
const json=value=>JSON.stringify(value,null,2)??'—';
const clone=value=>JSON.parse(JSON.stringify(value));
const RESULT_KEY='dead-drop:last-result';
const rootLabels={output:'OUTPUT',effect:'SIDE EFFECT',callback:'CALLBACK',external:'EXTERNAL'};

export class GameScreen {
  constructor(ctx,root,route){
    Object.assign(this,{ctx,root,route});this.abort=new AbortController();this.closed=false;this.dirty=false;this.loading=true;this.finishing=false;this.feedback=null;this.hintMessage=null;this.savedSnapshot=null;this.scenarioIndex=0;
  }
  get paused(){return this.session?.paused||false;}
  get state(){return this.session?.state;}
  get level(){return this.session?.level;}
  readState(){return {dirty:this.dirty,saving:!!this.saveBusy||this.ctx.storage.saving};}
  async mount(){
    this.root.innerHTML='<div class="loading-screen"><span class="status-dot"></span> 코드 리액터를 연결하고 있어요…</div>';
    let restoring=false;
    try{
      this.catalog=await this.ctx.levels.load({signal:this.abort.signal});if(this.closed)return;
      const resume=this.route.params.get('resume')==='1';let snapshot=null;
      if(resume){restoring=true;snapshot=await this.ctx.storage.loadRun();if(!snapshot)throw Error('저장된 도전이 없어요. 시작 화면에서 새 도전을 열어 주세요.');}
      if(this.closed)return;
      this.session=new GameSession({catalog:this.catalog,mode:this.route.params.get('mode')==='practice'?'practice':'challenge',snapshot});
      this.savedSnapshot=snapshot?clone(snapshot):null;this.loading=false;this.dirty=!snapshot;this.feedback=this.session.lastResult||null;
      this.buildShell();this.render();
      this.root.addEventListener('click',event=>this.click(event),{signal:this.abort.signal});
      this.root.addEventListener('focusin',event=>this.focusCard(event),{signal:this.abort.signal});
      document.addEventListener('keydown',event=>this.key(event),{signal:this.abort.signal});
      document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pause();},{signal:this.abort.signal});
      addEventListener('blur',()=>this.pause(),{signal:this.abort.signal});
      this.interval=setInterval(()=>this.tick(),100);
      if(document.hidden||!document.hasFocus())this.pause();
      if(snapshot)this.ctx.toast('저장한 코드와 남은 시간을 불러왔어요. 계속하기를 누르면 시작해요.');
      if(this.session.finished)this.finish();
    }catch(error){
      if(this.closed||error.name==='AbortError')return;
      this.loading=true;this.root.innerHTML='<section class="info-screen error-screen"><p class="eyebrow">REACTOR OFFLINE</p><h1>'+(restoring?'저장한 도전을<br>연결하지 못했어요.':'코드 리액터가<br>응답하지 않아요.')+'</h1><p id="load-error"></p><div class="hero-actions"><button class="btn btn-primary" data-action="retry-load">다시 연결 ↗</button><a class="btn btn-secondary" href="#/" data-route="/">시작 화면으로</a></div></section>';
      this.root.querySelector('#load-error').textContent=restoring?'저장된 진행은 그대로 보관하고 있어요. '+error.message:'문제 데이터를 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
      this.root.querySelector('[data-action="retry-load"]').onclick=()=>this.mount();
    }
  }
  buildShell(){
    this.root.innerHTML=`<section class="game-screen dd-game">
      <div class="dd-game-top"><div class="dd-round-meta"><p class="eyebrow" id="round-label"></p><h1 class="dd-level-title"></h1><p class="dd-level-subtitle"></p></div><div class="dd-hud"><div class="dd-hud-item"><span>SCORE</span><strong id="score">0000</strong></div><div class="dd-hud-item dd-combo"><span>COMBO</span><strong id="combo">×0</strong></div><div class="dd-hud-item dd-timer"><span id="timer-label">TIME LEFT</span><strong id="timer">90</strong></div><button class="mini-btn dd-pause" data-action="pause" aria-label="일시 정지" title="일시 정지 (Esc)">Ⅱ</button></div></div>
      <div class="dd-energy" role="progressbar" aria-label="남은 에너지" aria-valuemin="0" aria-valuemax="90" aria-valuenow="90"><span></span><i></i></div>
      <div class="dd-progress" aria-label="8개 스테이지 진행"></div>
      <div class="dd-mission"><span class="label">MISSION</span><p id="mission"></p><button class="text-link" data-action="hint">힌트 <span id="hint-cost">−5초</span><span aria-hidden="true">↗</span></button></div><p id="hint" class="dd-hint" role="status" hidden></p>
      <div class="dd-workspace"><section class="dd-code-panel" aria-labelledby="code-title"><header class="dd-panel-heading"><h2 id="code-title"><span class="status-dot"></span> 코드에서 사라질 것들</h2><span class="label"><b id="removed-count">0</b> DROPPED / <span id="card-count">0</span></span></header><div class="dd-editor-title"><span><i></i><i></i><i></i> reactor.js</span><span>CLICK TO DROP / RESTORE</span></div><div class="dd-card-list" aria-label="코드 조각"></div><div class="dd-board-controls"><button class="btn btn-primary" data-action="check">삭제 검증 <span class="dd-mobile-time" id="mobile-time" aria-hidden="true">90s</span><span aria-hidden="true">↗</span></button><button class="text-link" data-action="reset">전체 복구 <span aria-hidden="true">↺</span></button><button class="text-link" data-action="save">진행 저장 <span aria-hidden="true">↓</span></button></div><div class="dd-feedback" id="feedback" role="status" aria-live="polite" hidden></div></section>
      <aside class="dd-inspector" aria-label="동작 관찰실"><div class="dd-inspector-title"><span class="dd-scope-icon" aria-hidden="true">⌁</span><div><p class="eyebrow">BEHAVIOR MONITOR</p><h2>동작은 살아 있어야 해.</h2></div><span class="dd-live">LIVE</span></div>
        <section class="dd-observation"><div class="dd-panel-heading"><h3>관찰할 입력</h3><span class="label">SCENARIO</span></div><div id="scenarios" class="dd-scenarios"></div><details class="dd-input-details"><summary>입력 데이터 <span aria-hidden="true">↗</span></summary><pre id="scenario-input"></pre></details></section>
        <section class="dd-observation dd-trace-panel"><div class="dd-panel-heading"><h3>이번 입력의 실행 흔적</h3><span class="label">TRACE</span></div><div id="trace" class="dd-trace"></div><p class="dd-caution"><span aria-hidden="true">!</span> 실행되지 않았다는 이유만으로 지우면 위험해요. 다른 입력·부수 효과·외부 사용도 확인하세요.</p></section>
        <section class="dd-observation"><div class="dd-panel-heading"><h3>보존할 결과</h3><span class="label">ORIGINAL</span></div><div class="dd-output"><span class="label">RETURN / OUTPUT</span><pre id="target-output"></pre></div><div class="dd-output dd-effects"><span class="label">SIDE EFFECTS</span><pre id="target-effects"></pre></div></section>
        <section class="dd-observation dd-roots-panel"><div class="dd-panel-heading"><h3>외부와 연결된 곳</h3><span class="label">ROOTS</span></div><div class="dd-roots" id="roots"></div></section>
        <p class="dd-monitor-note">검증은 준비된 모든 입력의 결과와 부수 효과, 외부 진입점의 의존성을 함께 확인해요.</p>
      </aside></div>
      <div class="dd-keyboard"><span><kbd>↑</kbd><kbd>↓</kbd> 선택</span><span><kbd>Enter</kbd> / <kbd>Delete</kbd> 삭제·복구</span><span><kbd>Space</kbd> 검증</span><span><kbd>Esc</kbd> 일시 정지</span><span class="dd-keyboard-motto">LESS CODE. SAME BEHAVIOR.</span></div>
      <div class="pause-overlay dd-pause-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="modal-card"><p class="eyebrow"><span class="status-dot"></span> REACTOR PAUSED</p><h2 id="pause-title">숨 고르고,<br><span>다시 DROP.</span></h2><p>남은 시간과 코드가 여기에 있어요.<br>준비되면 계속하세요.</p><div class="hero-actions"><button class="btn btn-primary" data-action="resume">계속하기 ↗</button><button class="btn btn-secondary" data-action="save">진행 저장 ↓</button><a class="text-link" href="#/" data-route="/">시작 화면으로 ↗</a></div><p class="save-status" role="status"></p></div></div><div class="celebration dd-celebration" aria-hidden="true"></div>
    </section>`;
  }
  render(){
    if(this.closed||this.loading)return;
    const s=this.state,l=this.level,editing=s.phase==='editing'&&!this.paused;
    this.root.querySelector('.dd-game').dataset.phase=s.phase;
    this.root.querySelector('#round-label').textContent=(s.mode==='practice'?'PRACTICE / NO LIMIT':'90 SECOND CHALLENGE')+' — STAGE '+String(s.index+1).padStart(2,'0')+' / '+String(this.catalog.levels.length).padStart(2,'0');
    this.root.querySelector('.dd-level-title').textContent=l.title;this.root.querySelector('.dd-level-subtitle').textContent=l.subtitle;this.root.querySelector('#mission').textContent=l.mission;
    this.root.querySelector('#hint-cost').textContent=s.mode==='practice'?'무료':'−5초';
    const hint=this.root.querySelector('#hint');hint.hidden=!this.hintMessage;hint.textContent=this.hintMessage||'';
    this.root.querySelector('.dd-progress').replaceChildren(...this.catalog.levels.map((level,index)=>{const step=node('span','dd-progress-step');step.dataset.state=index<s.solved?'done':index===s.index?'current':'next';step.append(node('b','',index<s.solved?'✓':String(index+1).padStart(2,'0')),node('span','',index===s.index?'IN PROGRESS':index<s.solved?'CLEARED':'LOCKED'));step.setAttribute('aria-label',String(index+1)+'번 '+(index<s.solved?'완료':index===s.index?'진행 중':'대기'));return step;}));
    this.root.querySelector('#removed-count').textContent=s.plan.length;this.root.querySelector('#card-count').textContent=l.cards.length;
    this.root.querySelector('.dd-card-list').replaceChildren(...l.cards.map((card,index)=>this.codeCard(card,index)));
    this.root.querySelector('#scenarios').replaceChildren(...l.scenarios.map((scenario,index)=>{const button=node('button','dd-scenario',scenario.label);button.type='button';button.dataset.action='scenario';button.dataset.index=index;button.setAttribute('aria-pressed',String(index===this.scenarioIndex));button.disabled=!editing;return button;}));
    this.renderObservation();
    this.root.querySelector('#roots').replaceChildren(...l.roots.map(root=>{const item=node('div','dd-root');item.append(node('span','',rootLabels[root.type]||root.type),node('code','',root.card),node('small','',root.label));return item;}));
    for(const action of ['check','reset','hint'])this.root.querySelector('[data-action="'+action+'"]').disabled=!editing;
    this.renderFeedback();this.updateHud();this.renderPause();
  }
  codeCard(card,index){
    const removed=this.state.plan.includes(card.id),button=node('button','dd-code-card');button.type='button';button.dataset.action='toggle';button.dataset.id=card.id;button.dataset.removed=String(removed);button.dataset.selected=String(this.state.selected===card.id);button.disabled=this.state.phase!=='editing'||this.paused;
    button.setAttribute('aria-pressed',String(removed));button.setAttribute('aria-label',card.label+' — '+(removed?'삭제 예정. 누르면 복구':'유지 중. 누르면 삭제'));button.setAttribute('aria-keyshortcuts','Enter Delete');
    const number=node('span','dd-line-number',String(index+1).padStart(2,'0')),content=node('span','dd-card-content'),meta=node('span','dd-card-meta');meta.append(node('strong','',card.id),node('span','',card.label));
    content.append(meta,node('code','dd-card-code',card.code),node('span','dd-card-description',card.description));
    const action=node('span','dd-card-action');action.append(node('b','',removed?'↶':'−'),node('span','',removed?'RESTORE':'DROP'));
    button.append(number,content,action);return button;
  }
  renderObservation(){
    const scenario=this.level.scenarios[this.scenarioIndex]||this.level.scenarios[0],reference=runReference(this.level,this.scenarioIndex);
    this.root.querySelector('#scenario-input').textContent=json(scenario.input);
    this.root.querySelector('#target-output').textContent=json(reference.output);
    this.root.querySelector('#target-effects').textContent=reference.effects.length?json(reference.effects):'없음 / NO SIDE EFFECTS';
    const trace=this.root.querySelector('#trace');trace.replaceChildren(...reference.trace.map((id,index)=>{const step=node('span','dd-trace-step',id);if(index)step.prepend(node('i','','→'));return step;}));
    if(!reference.trace.length)trace.append(node('span','dd-trace-empty','실행 흔적 없음'));
    for(const card of this.root.querySelectorAll('.dd-code-card'))card.dataset.traced=String(reference.trace.includes(card.dataset.id));
  }
  focusCard(event){
    const card=event.target.closest('.dd-code-card');if(!card||this.paused||this.state.phase!=='editing'||this.state.selected===card.dataset.id)return;
    this.session.select(card.dataset.id);this.dirty=true;this.markSelected();
  }
  markSelected(){for(const card of this.root.querySelectorAll('.dd-code-card'))card.dataset.selected=String(card.dataset.id===this.state.selected);}
  click(event){
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;
    if(action==='pause'){this.pause();return;}
    if(action==='resume'){if(this.saveBusy)return;this.session.resume();this.dirty=true;this.render();this.restoreFocus();return;}
    if(action==='save'){this.saveFromButton(button);return;}
    if(this.paused||this.finishing)return;
    if(action==='next'){this.next();return;}
    if(this.state.phase!=='editing')return;
    if(action==='scenario'){this.scenarioIndex=Number(button.dataset.index);this.render();this.root.querySelectorAll('.dd-scenario')[this.scenarioIndex]?.focus({preventScroll:true});return;}
    if(action==='hint'){const hint=this.session.hint();this.hintMessage=typeof hint==='string'?hint:hint?.message||'실행 흔적뿐 아니라 외부 사용과 의존성도 살펴보세요.';this.ctx.sound.play('hint');this.dirty=true;this.render();if(this.session.finished)this.finish();return;}
    if(action==='check'){this.verify();return;}
    if(action==='reset'){this.session.reset();this.ctx.sound.play('move');this.changed();return;}
    if(action==='toggle')this.toggle(button.dataset.id);
  }
  toggle(id){
    this.session.toggle(id);this.ctx.sound.play(this.state.plan.includes(id)?'clear':'move');this.changed();
    const card=[...this.root.querySelectorAll('.dd-code-card')].find(element=>element.dataset.id===id);if(card){card.classList.add('dd-card-hit');clearTimeout(this.hitTimer);this.hitTimer=setTimeout(()=>card.classList.remove('dd-card-hit'),320);}
  }
  changed(){
    this.dirty=true;this.feedback=null;const focused=document.activeElement,focusId=focused?.closest('[data-id]')?.dataset.id,action=focused?.dataset.action;this.render();
    if(focusId)this.restoreFocus(focusId);else if(action)this.root.querySelector('[data-action="'+action+'"]')?.focus({preventScroll:true});
    if(this.session.finished)this.finish();
  }
  restoreFocus(id=this.state.selected){if(this.state.phase==='cleared'){this.root.querySelector('[data-action="next"]')?.focus({preventScroll:true});return;}const card=[...this.root.querySelectorAll('.dd-code-card')].find(element=>element.dataset.id===id);(card||this.root.querySelector('[data-action="check"]'))?.focus({preventScroll:true});}
  verify(){
    const result=this.session.check();if(!result)return;
    this.feedback=result;this.dirty=true;this.ctx.sound.play(result.correct?'pass':'fail');this.render();
    if(result.correct){this.celebrate();this.root.querySelector('[data-action="next"]')?.focus({preventScroll:true});}
    this.root.querySelector('#feedback').scrollIntoView({behavior:'instant',block:'nearest'});
    if(this.session.finished)this.finish();
  }
  renderFeedback(){
    const area=this.root.querySelector('#feedback');let result=this.feedback;
    if(!result&&this.state.phase==='cleared')result={correct:true,message:'저장한 정답이에요. 다음 스테이지로 이어가세요.'};
    area.hidden=!result;if(!result)return;area.dataset.status=result.correct?'pass':'fail';
    area.replaceChildren(node('p','eyebrow',result.correct?'CLEAN DROP / BEHAVIOR PRESERVED':'SIGNAL LOST / RESTORE & RETRY'),node('h2','',result.correct?'덜어냈다. 동작은 그대로.':'삭제 계획을 다시 살펴봐요.'),node('p','',result.message||''));
    if(result.correct){area.append(node('p','dd-lesson',this.level.lesson));const next=node('button','btn btn-primary',this.state.index===this.catalog.levels.length-1?'최종 결과 보기 ↗':'다음 스테이지 ↗');next.type='button';next.dataset.action='next';area.append(next);}
    if(!result.correct&&result.counterexample){
      const example=result.counterexample,detail=node('details','dd-counterexample');detail.open=true;detail.append(node('summary','','동작이 달라지는 입력 · '+(example.label||example.scenarioId||'확인하기')));
      if(example.input!==undefined)detail.append(node('span','label','INPUT'),node('pre','',json(example.input)));
      const grid=node('div','dd-output-grid');for(const [label,value]of [['BEFORE / 원래 동작',example.expected??result.expected],['AFTER / 삭제 후',example.actual??result.actual]]){const cell=node('div','dd-output-cell');cell.append(node('span','label',label),node('pre','',json(value)));grid.append(cell);}detail.append(grid);area.append(detail);
    }else if(!result.correct&&result.expected!==undefined&&result.actual!==undefined){const grid=node('div','dd-output-grid');for(const [label,value]of [['BEFORE',result.expected],['AFTER',result.actual]]){const cell=node('div','dd-output-cell');cell.append(node('span','label',label),node('pre','',json(value)));grid.append(cell);}area.append(grid);}
    if(!result.correct)area.append(node('p','dd-retry-note',this.state.mode==='challenge'?'−5초 · 콤보가 초기화됐어요. 코드를 복구하고 다시 검증하세요.':'연습에는 시간 제한이 없어요. 코드를 복구하며 차이를 살펴보세요.'));
  }
  next(){
    if(this.state.phase!=='cleared'||this.paused||this.finishing)return;
    this.session.advance();this.dirty=true;this.feedback=null;this.hintMessage=null;this.scenarioIndex=0;
    if(this.session.finished){this.finish();return;}
    this.render();this.root.querySelector('.dd-level-title').scrollIntoView({block:'start',behavior:'instant'});this.root.focus({preventScroll:true});
  }
  updateHud(){
    if(this.loading||this.closed)return;const seconds=Math.max(0,Math.ceil(this.state.remainingMs/1000)),practice=this.state.mode==='practice';
    this.root.querySelector('#score').textContent=String(this.state.score).padStart(4,'0');this.root.querySelector('#combo').textContent='×'+this.state.combo;
    this.root.querySelector('#timer').textContent=practice?'∞':String(seconds).padStart(2,'0');this.root.querySelector('#timer-label').textContent=practice?'NO LIMIT':'TIME LEFT';
    this.root.querySelector('#mobile-time').textContent=practice?'∞':String(seconds)+'s';
    this.root.querySelector('.dd-timer').dataset.warning=String(!practice&&seconds<=15);
    const energy=this.root.querySelector('.dd-energy');energy.style.setProperty('--energy',practice?1:Math.max(0,this.state.remainingMs/90000));energy.dataset.warning=String(!practice&&seconds<=15);energy.setAttribute('aria-valuenow',String(practice?90:seconds));energy.setAttribute('aria-valuetext',practice?'연습 모드: 시간 제한 없음':seconds+'초 남음');
    this.root.querySelector('.dd-combo').dataset.active=String(this.state.combo>1);
  }
  tick(){
    if(this.closed||this.loading||this.finishing)return;const wasPaused=this.paused;this.session.tick();
    if(!wasPaused&&!this.session.finished)this.dirty=true;this.updateHud();if(this.session.finished)this.finish();
  }
  pause(){
    if(this.closed||this.loading||this.finishing||this.paused||this.session.finished)return;this.session.pause();this.updateHud();this.renderPause();if(this.session.finished)this.finish();
  }
  renderPause(){
    if(this.loading||this.closed)return;
    const overlay=this.root.querySelector('.pause-overlay'),wasHidden=overlay.hidden;overlay.hidden=!this.paused;overlay.querySelector('[data-action="resume"]').disabled=!!this.saveBusy;
    for(const child of this.root.querySelector('.dd-game').children)if(child!==overlay)child.inert=this.paused;
    if(this.paused&&wasHidden)this.focusPause();
  }
  focusPause(){this.root.querySelector('.pause-overlay [data-action="resume"]')?.focus({preventScroll:true});}
  async saveFromButton(button){
    if(this.saveBusy)return;button.disabled=true;
    try{await this.save();this.ctx.toast('코드와 남은 시간을 저장했어요.');const status=this.root.querySelector('.save-status');if(status)status.textContent='저장 완료 · 시작 화면에서 이어 할 수 있어요.';}
    catch{this.ctx.toast('저장하지 못했어요. 현재 진행은 그대로예요. 다시 시도해 주세요.');}
    finally{if(!this.closed)button.disabled=false;}
  }
  async save(){
    if(!this.session||this.loading)throw Error('저장할 도전이 없어요.');if(this.savePromise)return this.savePromise;
    this.pause();this.saveBusy=true;this.renderPause();const snapshot=this.session.snapshot();
    this.savePromise=(async()=>{try{await this.ctx.storage.saveRun(snapshot);this.savedSnapshot=clone(snapshot);this.dirty=JSON.stringify(this.session.snapshot())!==JSON.stringify(snapshot);}
      finally{this.saveBusy=false;this.savePromise=null;if(!this.closed)this.renderPause();}})();return this.savePromise;
  }
  async discard(){await this.ctx.storage.clearRunIfMatches(this.savedSnapshot);this.dirty=false;}
  async finish(){
    if(this.finishing||this.closed)return;this.finishing=true;clearInterval(this.interval);
    const result=this.session.toResult();this.ctx.lastResult=result;this.ctx.resultSaveError=false;
    const envelope={result,saved:false,savedRun:this.savedSnapshot};try{sessionStorage.setItem(RESULT_KEY,JSON.stringify(envelope));}catch{}
    try{await this.ctx.storage.saveResult(result);await this.ctx.storage.clearRunIfMatches(this.savedSnapshot);envelope.saved=true;}catch{this.ctx.resultSaveError=true;}
    try{sessionStorage.setItem(RESULT_KEY,JSON.stringify(envelope));}catch{}
    if(this.closed)return;this.dirty=false;await this.ctx.router.navigate('/result');
  }
  key(event){
    if(this.closed||this.loading||document.querySelector('#guard-dialog[open]'))return;
    const key=event.code==='Space'?' ':event.key;
    const target=event.target?.closest?event.target:document.body;if(target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(this.paused){if(key==='Tab'){const buttons=[...this.root.querySelectorAll('.pause-overlay button:not(:disabled),.pause-overlay a')],index=buttons.indexOf(document.activeElement);event.preventDefault();buttons[(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();}else if(key==='Escape')event.preventDefault();return;}
    if(key==='Escape'){event.preventDefault();this.pause();return;}
    if(this.finishing||event.altKey||event.ctrlKey||event.metaKey||event.repeat)return;
    if(key===' '&&target.closest('.dd-code-card')){event.preventDefault();this.verify();return;}
    if((key===' '||key==='Enter')&&target.closest('button,a,summary'))return;
    if(this.state.phase==='cleared'){if(key===' '||key==='Enter'){event.preventDefault();this.next();}return;}
    if(key==='ArrowUp'||key==='ArrowDown'){
      event.preventDefault();const ids=this.level.cards.map(card=>card.id),index=ids.indexOf(this.state.selected);this.session.select(ids[index<0?(key==='ArrowDown'?0:ids.length-1):(index+(key==='ArrowDown'?1:-1)+ids.length)%ids.length]);this.dirty=true;this.markSelected();this.restoreFocus();return;
    }
    if(key==='Enter'||key==='Delete'||key==='Backspace'){const id=target.closest('.dd-code-card')?.dataset.id||this.state.selected;if(id){event.preventDefault();this.toggle(id);}return;}
    if(key===' '){event.preventDefault();this.verify();}
  }
  celebrate(){
    const area=this.root.querySelector('.celebration');area.replaceChildren(...Array.from({length:20},(_,index)=>{const spark=node('i');spark.style.setProperty('--i',index);spark.style.setProperty('--x',((index*37)%101)+'%');return spark;}));clearTimeout(this.celebrationTimer);this.celebrationTimer=setTimeout(()=>area.replaceChildren(),1200);
  }
  dispose(){this.closed=true;this.abort.abort();clearInterval(this.interval);clearTimeout(this.celebrationTimer);clearTimeout(this.hitTimer);}
}
