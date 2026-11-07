export class VersionService {
  constructor({baseUrl,loadedBuild,fetcher=globalThis.fetch.bind(globalThis),timeoutMs=3500}) {
    if(!loadedBuild) throw new Error('Loaded build identity is required');
    this.baseUrl=new URL(baseUrl);this.loadedBuild=loadedBuild;this.fetcher=fetcher;this.timeoutMs=timeoutMs;
    this.pendingBuild=null;this.status='idle';this.inFlight=null;this.lastError=null;
  }
  async refresh() {
    if(this.inFlight) return this.inFlight;
    this.inFlight=this._refresh().finally(()=>{this.inFlight=null;});
    return this.inFlight;
  }
  async _refresh() {
    const controller=new AbortController();let timer;
    try {
      const request=(async()=>{
        const response=await this.fetcher(new URL('version.json',this.baseUrl),{cache:'no-store',signal:controller.signal});
        if(!response.ok) throw Error('Version response failed');
        const body=await response.json();
        if(!body || typeof body.buildId!=='string' || !/^[a-z\d][a-z\d-]{2,79}$/i.test(body.buildId)) throw Error('Invalid version identity');
        return body.buildId;
      })();
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Version request timed out'));},this.timeoutMs);});
      const buildId=await Promise.race([request,timeout]);
      this.pendingBuild=buildId===this.loadedBuild?null:buildId;this.status='available';this.lastError=null;
    } catch(error) {
      this.status='unavailable';this.lastError=error;
    } finally {clearTimeout(timer);}
    return {changed:!!this.pendingBuild,buildId:this.pendingBuild,status:this.status};
  }
  async navigation(target,readState) {
    await this.refresh();
    const {dirty,saving}=readState();
    return {kind:dirty||saving?'protect':this.pendingBuild?'reload':'spa',target,changed:!!this.pendingBuild};
  }
}
