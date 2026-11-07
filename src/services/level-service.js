import {validateCatalog} from '../game/engine.js';

function abortError(){return new DOMException('A newer screen replaced this request','AbortError');}

export class LevelService {
  constructor({baseUrl,fetcher=globalThis.fetch.bind(globalThis),timeoutMs=7000}) {
    this.baseUrl=new URL(baseUrl);this.fetcher=fetcher;this.timeoutMs=timeoutMs;this.generation=0;this.controller=null;
  }
  async load({signal}={}) {
    this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const generation=++this.generation;let timer,rejectAbort;
    if(signal?.aborted){this.controller=null;throw abortError();}
    const abort=()=>controller.abort();
    const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(abortError());});
    controller.signal.addEventListener('abort',rejectAbort,{once:true});
    signal?.addEventListener('abort',abort,{once:true});
    try {
      const request=(async()=>{
        const response=await this.fetcher(new URL('data/levels.json',this.baseUrl),{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw Error('스테이지를 불러오지 못했어요. 다시 시도해 주세요.');
        const body=await response.json();
        if(controller.signal.aborted||generation!==this.generation)throw abortError();
        return validateCatalog(body);
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('불러오는 시간이 길어지고 있어요. 다시 시도해 주세요.'));controller.abort();},this.timeoutMs);});
      return await Promise.race([request,timeout,aborted]);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);if(this.controller===controller)this.controller=null;}
  }
  cancel(){this.generation++;this.controller?.abort();}
}
