// Thin client: no wallet arithmetic or simulation mutations are trusted here.
const API='https://wirewalk-labs.wirewalk-upload.workers.dev';
const $=id=>document.getElementById(id),KEY='wirewalk-lab-token';
export class HostedLab extends EventTarget {
 constructor(){super();this.client=crypto.randomUUID();this.lab=document.querySelector('[data-lab]')?.dataset.lab||'cluster';this.token='';this.active=false;this.queue=Promise.resolve();this.lastBalance=null;this.purchase=null;try{this.token=sessionStorage.getItem(KEY)||''}catch{}
  $('lab-login').addEventListener('submit',async e=>{e.preventDefault();const submit=e.target.querySelector('button');submit.disabled=true;try{const d=await this.request('/api/login',{email:$('lab-email').value,password:$('lab-password').value},false);this.token=d.token;try{sessionStorage.setItem(KEY,this.token)}catch{}$('lab-password').value='';await this.connect();}catch(e){this.note(e.message)}finally{submit.disabled=false}});
  $('lab-buy').addEventListener('click',()=>this.buy());$('lab-check-payment').addEventListener('click',()=>this.reconcile());$('lab-logout').addEventListener('click',()=>this.logout());
  this.timer=setInterval(()=>{if(this.active&&!document.hidden&&!this.polling){this.polling=true;this.postMessage({type:'heartbeat'},()=>this.polling=false)}this.countdown()},1500);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.pauseOnExit()});window.addEventListener('pagehide',()=>this.pauseOnExit());
  if(new URLSearchParams(location.search).has('checkout_cancelled'))this.returnToLab();
  if(this.token)queueMicrotask(()=>this.connect());
 }
 note(text){$('lab-access-status').textContent=text}
 async request(path,body,auth=true,keepalive=false){if(path==='/api/lab')body={...body,lab:this.lab};const r=await fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.token}:{})},body:JSON.stringify(body),keepalive});let d;try{d=await r.json()}catch{throw Error('The lab service did not return a valid response. Try again shortly.')}if(!r.ok){const e=Error(d.error||'The lab request failed.');e.status=r.status;throw e}return d}
 emit(data){this.dispatchEvent(new MessageEvent('message',{data}))}
 async connect(){try{const d=await this.request('/api/lab',{client:this.client,data:{type:'state'}});this.showAccount(true);this.update(d);if(d.state)this.emit(d);this.note('Signed in. Launch or resume the lab when ready.');if(new URLSearchParams(location.search).get('checkout'))await this.reconcile();}catch(e){this.active=false;this.note(e.message);this.showAccount(false)}}
 showAccount(on){$('lab-login').hidden=on;$('lab-account-help').hidden=on;$('lab-logout').hidden=!this.token;$('lab-buy').disabled=!on;$('lab-check-payment').hidden=!on||!new URLSearchParams(location.search).get('checkout');}
 update(d){if(!d.balance)return;this.lastBalance={...d.balance,at:Date.now()};this.active=d.playing??false;this.countdown();}
 countdown(){if(!this.lastBalance)return;const b=this.lastBalance;const ms=Math.max(0,b.remainingMs-(this.active?Math.min(4000,Date.now()-b.at):0));const sec=Math.ceil(ms/1000);$('lab-balance').textContent=Math.floor(sec/60)+'m '+String(sec%60).padStart(2,'0')+'s remaining'+(b.paidMs<0?' · refunded credit adjustment':'')+(this.active?' · running':' · paused');}
 postMessage(data,done=()=>{}){this.queue=this.queue.then(async()=>{try{
   if(!this.token)throw Error('Sign in with your verified Wirewalk account to launch the lab.');
   const d=await this.request('/api/lab',{client:this.client,data});this.update(d);this.emit(d);
   if(d.balance?.remainingMs===0)this.note('Your lab time has run out. Progress is saved. Add an hour whenever you want to continue.');
   else if(data.type==='play')this.note(data.value?'Lab running. Time is being used.':'Lab paused. No time is being used.');
  }catch(e){if(!e.status||[401,402,409,503].includes(e.status)){this.active=false;this.emit({type:'state',state:null,playing:false,balance:this.lastBalance});}this.note(e.message);this.emit({type:'error',message:e.message});}finally{done()}});return this.queue;}
 pauseOnExit(){if(!this.active||!this.token)return;this.active=false;this.request('/api/lab',{client:this.client,data:{type:'play',value:false}},true,true).catch(()=>{});}
 async buy(){const button=$('lab-buy');button.disabled=true;try{
   await this.postMessage({type:'play',value:false});
   try{sessionStorage.setItem('wirewalk-lab-return',location.pathname)}catch{}
   this.purchase=this.purchase||crypto.randomUUID();
   const d=await this.request('/api/checkout',{purchase:this.purchase});
   if(!/^https:\/\/checkout\.stripe\.com\//.test(d.url))throw Error('Unexpected checkout destination.');location.assign(d.url);
  }catch(e){this.note(e.message);button.disabled=false}}
 async reconcile(){const session=new URLSearchParams(location.search).get('checkout');if(!session)return;const b=$('lab-check-payment');b.disabled=true;try{const d=await this.request('/api/reconcile',{session});this.lastBalance={...d.balance,at:Date.now()};this.countdown();this.note(d.paid?'Payment confirmed. One prepaid hour is recorded for this purchase. Resume the lab when ready.':'Payment is not confirmed yet. Check again shortly; please do not pay again.');if(d.paid){const u=new URL(location.href);u.searchParams.delete('checkout');history.replaceState(null,'',u);b.hidden=true;this.purchase=null;this.returnToLab();}}catch(e){this.note(e.message)}finally{b.disabled=false}}
 returnToLab(){let path='';try{path=sessionStorage.getItem('wirewalk-lab-return')||'';sessionStorage.removeItem('wirewalk-lab-return')}catch{}if(['/lab/switching/cumulus/','/lab/switching/quantum/','/lab/switching/juniper/','/lab/switching/arista/'].includes(path)&&path!==location.pathname)location.replace(path)}
 async logout(){this.pauseOnExit();const t=this.token;this.token='';this.active=false;try{sessionStorage.removeItem(KEY)}catch{}this.showAccount(false);this.note('Signed out. Your account progress and unused time are saved.');this.request('/api/logout',{token:t},false).catch(()=>{});location.reload();}
}
