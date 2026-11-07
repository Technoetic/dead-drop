import {VersionService} from './services/version-service.js';
import {StorageService} from './services/storage-service.js';
import {LevelService} from './services/level-service.js';
import {SoundService} from './services/sound-service.js';
import {Router} from './services/router.js';
import {GameScreen} from './screens/game-screen.js';
import {HomeScreen,GuideScreen,RecordsScreen,ResultScreen,NotFoundScreen} from './screens/info-screens.js';

class DeadDropApp {
  constructor(){
    this.root=document.querySelector('#app');this.sequence=0;this.current=null;
    this.baseUrl=new URL('./',location.href);this.loadedBuild=document.querySelector('meta[name="app-build"]').content;
    this.storage=new StorageService();this.sound=new SoundService();this.levels=new LevelService({baseUrl:this.baseUrl});
    this.version=new VersionService({baseUrl:this.baseUrl,loadedBuild:this.loadedBuild});
    this.ctx={baseUrl:this.baseUrl,loadedBuild:this.loadedBuild,storage:this.storage,sound:this.sound,levels:this.levels,version:this.version,lastResult:null,resultSaveError:false,
      assetUrl:name=>new URL('assets/'+name.replace('.svg','.'+this.loadedBuild+'.svg'),this.baseUrl).href,toast:message=>this.toast(message)};
    this.router=new Router({baseUrl:this.baseUrl,version:this.version,readState:()=>this.readState(),onNavigate:route=>this.show(route),onProtect:details=>this.protect(details),onUpdate:()=>this.update(),onError:error=>this.toast(error.message||'화면을 이동하지 못했어요. 잠시 후 다시 시도해 주세요.')});
    this.ctx.router=this.router;
    document.querySelector('.sound-toggle').addEventListener('click',()=>{const enabled=this.sound.toggle();const button=document.querySelector('.sound-toggle');button.setAttribute('aria-pressed',String(enabled));button.innerHTML='<span aria-hidden="true">'+(enabled?'◉':'◌')+'</span> '+(enabled?'소리 켜짐':'소리 꺼짐');});
    addEventListener('beforeunload',event=>{const state=this.readState();if(state.dirty||state.saving){event.preventDefault();event.returnValue='';}});
  }
  readState(){const state=this.current?.readState()||{dirty:false,saving:false};return {...state,saving:state.saving||this.storage.saving};}
  async show(route){
    const sequence=++this.sequence;this.current?.dispose();
    const Screen={'/':HomeScreen,'/play':GameScreen,'/guide':GuideScreen,'/records':RecordsScreen,'/result':ResultScreen}[route.path]||NotFoundScreen;
    const screen=new Screen(this.ctx,this.root,route);this.current=screen;
    await screen.mount();if(sequence!==this.sequence)return;
    document.querySelectorAll('a[data-route]').forEach(a=>{if(a.dataset.route.split('?')[0]===route.path)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(screen.paused)screen.focusPause();else this.root.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
  }
  update(){const banner=document.querySelector('#update-banner');banner.hidden=!this.version.pendingBuild;if(!banner.hidden)banner.textContent='새 버전이 준비됐어요. 지금 게임을 저장하고 화면을 이동하면 새 버전으로 이어집니다.';}
  toast(message){const el=document.querySelector('#toast');el.textContent=message;el.hidden=false;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>el.hidden=true,4500);}
  async protect({changed}){
    this.current?.pause?.();
    const dialog=document.querySelector('#guard-dialog'),error=document.querySelector('#guard-error');
    error.hidden=true;document.querySelector('#guard-description').textContent=changed?'새 버전이 준비됐어요. 현재 제거 상태와 남은 시간을 저장하면 이동 후에도 이어할 수 있어요.':'현재 제거 상태와 남은 시간을 저장하고, 다음에 이어서 플레이할 수 있어요.';
    const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=false);
    return new Promise(resolve=>{
      let busy=false;
      const finish=value=>{dialog.removeEventListener('click',click);dialog.removeEventListener('cancel',cancel);dialog.close();resolve(value);};
      const cancel=event=>{event.preventDefault();if(!busy)finish(false);};
      const click=async event=>{
        const action=event.target.closest('[data-guard]')?.dataset.guard;if(!action||busy)return;
        if(action==='stay'){finish(false);return;}
        busy=true;buttons.forEach(b=>b.disabled=true);
        try{if(action==='discard')await this.current?.discard?.();else await this.current.save();finish(true);}
        catch{error.hidden=false;error.textContent='저장을 마치지 못했어요. 진행은 그대로 보관 중입니다. 다시 시도하거나 여기에 머물러 주세요.';busy=false;buttons.forEach(b=>b.disabled=false);}
      };
      dialog.addEventListener('click',click);dialog.addEventListener('cancel',cancel);dialog.showModal();
    });
  }
  async start(){await this.router.start();}
}
const app=new DeadDropApp();
Object.defineProperty(window,'deadDrop',{value:Object.freeze({app,get current(){return app.current;},get state(){return app.current?.session?.state||null;}}),writable:false});
app.start().catch(error=>{console.error(error);document.querySelector('#app').textContent='흐름을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.';});
