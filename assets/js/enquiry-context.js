/* First-party, same-tab attribution. No requests, cookies, identifiers or form-body logging. */
(function(){
  'use strict';
  const key='wirewalk.enquiry-context.v1',ttl=30*60*1000;
  const sourceNames=new Set(['linkedin','referral','partner','email','search','direct']);
  const mediumNames=new Set(['social','referral','email','organic','video']);
  function publicPath(path){return path.length<=180&&/^[a-z0-9/_-]+$/.test(path)&&/^\/(?:writing|services|guides|lab|investigations|samples|procurement|capabilities|partners|experience|infrastructure|working-together|contact)(?:\/|$)/.test(path)||path==='/'?path:'/';}
  let context=null;
  if(navigator.globalPrivacyControl!==true){
    try{
      const saved=JSON.parse(sessionStorage.getItem(key)||'null');
      if(saved&&typeof saved.created==='number'&&Date.now()-saved.created>=0&&Date.now()-saved.created<ttl&&typeof saved.landing_page==='string'&&saved.landing_page===publicPath(saved.landing_page))context=saved;
      if(!context){
        const q=new URLSearchParams(location.search);let ref='';try{const u=new URL(document.referrer);if(u.hostname!==location.hostname)ref=u.hostname;}catch(e){}
        const source=q.get('utm_source'),medium=q.get('utm_medium'),campaign=q.get('utm_campaign')||'';
        context={created:Date.now(),landing_page:publicPath(location.pathname),referrer_host:ref,utm_source:sourceNames.has(source)?source:'',utm_medium:mediumNames.has(medium)?medium:'',utm_campaign:/^[a-z0-9_-]{1,48}$/.test(campaign)?campaign:''};
        sessionStorage.setItem(key,JSON.stringify(context));
      }
    }catch(e){context=null;}
  }
  function event(name,target){const detail={event:name,path:publicPath(location.pathname),target:target};window.dispatchEvent(new CustomEvent('wirewalk:interaction',{detail:detail}));}
  if(location.pathname.startsWith('/services/'))event('service_view',location.pathname);
  document.addEventListener('click',function(e){
    const a=e.target.closest('a');if(!a)return;let u;try{u=new URL(a.href,location.href)}catch(err){return}
    if(u.origin===location.origin&&/^\/assets\/(?:lab-tools|examples)\//.test(u.pathname))event('resource_download_click',u.pathname);
    else if(u.protocol==='mailto:'||u.protocol==='tel:')event('contact_click',u.protocol.slice(0,-1));
    else if(u.origin===location.origin&&u.pathname==='/contact/')event('contact_click','form');
  });
  const form=document.querySelector('#enquiry-form');
  if(form){
    const interest=new URLSearchParams(location.search).get('interest');const select=form.querySelector('[name=interest]');
    if(select&&[...select.options].some(x=>x.value===interest))select.value=interest;
    form.addEventListener('submit',function(){
      if(!form.checkValidity())return;
      form.querySelectorAll('[data-visit-context]').forEach(x=>x.remove());
      const opt=form.querySelector('[name=include_visit_context]');
      if(opt&&opt.checked&&context&&Date.now()-context.created<ttl){
        for(const field of ['landing_page','referrer_host','utm_source','utm_medium','utm_campaign']){
          const value=context[field];if(typeof value!=='string'||!value)continue;
          const input=document.createElement('input');input.type='hidden';input.name=field;input.value=value;input.dataset.visitContext='true';form.append(input);
        }
      }
      event('contact_submit_attempt','form');
      // A browser submit is not a confirmed enquiry, quote, engagement or payment.
    });
  }
  const clear=document.querySelector('#clear-visit-context');
  if(clear)clear.addEventListener('click',function(){try{sessionStorage.removeItem(key)}catch(e){}context=null;document.querySelector('#visit-context-status').textContent='Visit context cleared in this tab.';});
})();
