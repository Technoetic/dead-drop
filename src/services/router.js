import {parseRoute,routeUrl} from '../shared/routes.js';

export class Router {
  constructor({baseUrl,version,readState,onNavigate,onProtect,onUpdate,onError}){
    Object.assign(this,{baseUrl,version,readState,onNavigate,onProtect,onUpdate,onError});
    this.abort=new AbortController();this.sequence=0;this.protecting=false;this.approvedHistory=null;this.restoring=null;this.pendingHistory=null;
    const existing=history.state?.deadDrop;
    this.key=existing?.key||crypto.randomUUID();this.index=Number.isInteger(existing?.index)?existing.index:0;
    this.committedUrl=location.href;this.lastHistoryUrl=null;
    history.replaceState({...history.state,deadDrop:{key:this.key,index:this.index}},'',location.href);
    const historyHandler=()=>this._history().catch(error=>this.onError(error));
    addEventListener('popstate',historyHandler,{signal:this.abort.signal});
    addEventListener('hashchange',historyHandler,{signal:this.abort.signal});
    document.addEventListener('click',event=>{
      const link=event.target.closest('a[data-route]');
      if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      event.preventDefault();this.navigate(link.dataset.route).catch(error=>this.onError(error));
    },{signal:this.abort.signal});
    const check=async()=>{await this.version.refresh();this.onUpdate(this.version);};
    addEventListener('focus',()=>check(),{signal:this.abort.signal});
    addEventListener('pageshow',()=>check(),{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();},{signal:this.abort.signal});
  }
  unsafe(){const state=this.readState();return state.dirty||state.saving;}
  async start(){await this.onNavigate(parseRoute(location.hash));this.version.refresh().then(()=>this.onUpdate(this.version));}
  async _history(){
    const url=location.href;const hash=location.hash;
    const state=history.state?.deadDrop;
    const targetIndex=state?.key===this.key&&Number.isInteger(state.index)?state.index:this.index+1;
    if(this.restoring){
      if(url===this.committedUrl){this.pendingHistory=null;this.lastHistoryUrl=url;this.restoring.resolve();}
      return;
    }
    if(url===this.lastHistoryUrl)return;this.lastHistoryUrl=url;
    if(this.approvedHistory&&hash===this.approvedHistory.hash){
      const approved=this.approvedHistory;this.approvedHistory=null;
      if(this.unsafe()){
        this.pendingHistory={index:targetIndex,restored:false};
        await this.navigate(hash,{historyInfo:this.pendingHistory});return;
      }
      if(approved.reload){this.loadDocument(url,true);return;}
      await this.commit(hash,targetIndex);return;
    }
    if(this.protecting){if(targetIndex!==this.index)history.go(this.index-targetIndex);return;}
    this.pendingHistory={index:targetIndex,restored:false};
    await this.navigate(hash,{historyInfo:this.pendingHistory});
  }
  async restoreHistory(targetIndex){
    if(this.restoring)return this.restoring.promise;
    if(location.href===this.committedUrl){this.pendingHistory=null;return;}
    const delta=this.index-targetIndex;
    if(!delta){history.replaceState({...history.state,deadDrop:{key:this.key,index:this.index}},'',this.committedUrl);this.pendingHistory=null;this.lastHistoryUrl=this.committedUrl;return;}
    const restoration={};let timer;
    restoration.promise=new Promise((resolve,reject)=>{
      restoration.resolve=()=>{clearTimeout(timer);this.restoring=null;resolve();};
      restoration.reject=error=>{clearTimeout(timer);this.restoring=null;reject(error);};
      timer=setTimeout(()=>restoration.reject(Error('화면 이동을 되돌리지 못했어요. 현재 진행을 먼저 저장해 주세요.')),2500);
    });
    this.restoring=restoration;history.go(delta);
    return restoration.promise;
  }
  async navigate(route,{historyInfo=null}={}){
    if(this.protecting||this.abort.signal.aborted)return;
    const sequence=++this.sequence;const target=routeUrl(route,this.baseUrl);
    // A browser traversal has already moved the address bar. A newer link must
    // restore that entry before cancelling its lookup or opening another guard.
    if(!historyInfo&&this.pendingHistory){
      await this.restoreHistory(this.pendingHistory.index);
      if(sequence!==this.sequence)return;
    }
    const decision=await this.version.navigation(target.href,()=>this.readState());
    if(sequence!==this.sequence)return;
    this.onUpdate(this.version);
    if(decision.kind==='protect'||this.unsafe()){
      if(historyInfo&&!historyInfo.restored){await this.restoreHistory(historyInfo.index);historyInfo={...historyInfo,restored:true};if(sequence!==this.sequence)return;}
      this.protecting=true;let proceed;
      try{proceed=await this.onProtect({target,changed:!!this.version.pendingBuild});}finally{this.protecting=false;}
      if(!proceed)return;
      return this.navigate(route,{historyInfo});
    }
    // The read happens immediately before every document/history transition.
    if(this.unsafe())return this.navigate(route,{historyInfo});
    if(historyInfo?.restored){
      this.approvedHistory={hash:target.hash,reload:decision.kind==='reload'};
      const delta=historyInfo.index-this.index;
      if(delta){history.go(delta);return;}
      this.approvedHistory=null;
    }
    if(decision.kind==='reload'){
      this.loadDocument(target.href,!!historyInfo);
      return;
    }
    if(historyInfo){await this.commit(target.hash,historyInfo.index);return;}
    const same=location.hash===target.hash;const index=same?this.index:this.index+1;
    history[same?'replaceState':'pushState']({...history.state,deadDrop:{key:this.key,index}},'',target.href);
    await this.commit(target.hash,index);
  }
  loadDocument(target,replace){
    const url=new URL(target);
    // Hash-only assign/replace stays in the current document. Change the query
    // for every transition while keeping the requested screen fragment intact.
    url.searchParams.set('_dd',`${this.version.pendingBuild||this.version.loadedBuild}-${crypto.randomUUID()}`);
    location[replace?'replace':'assign'](url.href);
  }
  async commit(hash,index){
    this.index=index;this.committedUrl=location.href;this.lastHistoryUrl=location.href;this.pendingHistory=null;
    if(history.state?.deadDrop?.key!==this.key)history.replaceState({...history.state,deadDrop:{key:this.key,index}},'',location.href);
    await this.onNavigate(parseRoute(hash));
  }
  dispose(){this.sequence++;this.abort.abort();this.restoring?.reject(new DOMException('Router disposed','AbortError'));this.pendingHistory=null;}
}
