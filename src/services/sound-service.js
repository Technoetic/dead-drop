export class SoundService {
  constructor(){this.enabled=false;this.context=null;}
  toggle(){this.enabled=!this.enabled;if(this.enabled)this.play('select');return this.enabled;}
  play(kind='select'){
    if(!this.enabled)return;
    try{
      this.context??=new (globalThis.AudioContext||globalThis.webkitAudioContext)();
      if(this.context.state==='suspended')this.context.resume().catch(()=>{});
      const oscillator=this.context.createOscillator();const gain=this.context.createGain();
      const now=this.context.currentTime;
      const frequencies={select:440,move:440,clear:880,pass:880,invalid:110,fail:110,hint:330};
      oscillator.type=kind==='invalid'?'sawtooth':'sine';oscillator.frequency.setValueAtTime(frequencies[kind]||440,now);
      oscillator.frequency.exponentialRampToValueAtTime((frequencies[kind]||440)*(kind==='clear'?1.5:.75),now+.12);
      gain.gain.setValueAtTime(.045,now);gain.gain.exponentialRampToValueAtTime(.001,now+.18);
      oscillator.connect(gain).connect(this.context.destination);oscillator.start(now);oscillator.stop(now+.19);
    }catch{this.enabled=false;}
  }
  dispose(){this.enabled=false;try{this.context?.close()?.catch(()=>{});}catch{}this.context=null;}
}
