const $=id=>document.getElementById(id);
const remote=new URLSearchParams(location.search).has('display');
const api=async(path,method='GET',data)=>{
  const res=await fetch('/api/'+path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});
  const body=await res.json(); if(!res.ok) throw Object.assign(Error(body.error||'Account service unavailable'),{status:res.status}); return body;
};
const native=window.CricNative;
const cacheKey='cricboard-native-approved-v1';
const cached=()=>{try{return JSON.parse(localStorage.getItem(cacheKey));}catch{return null;}};
const status=message=>{$('accountStatus').textContent=message;};
async function logout(){try{if(native){localStorage.removeItem(cacheKey);try{await api('logout','POST');}catch{}await native.signOut(); location.replace('?manage=1');return;}await api('logout','POST');location.replace(location.pathname);}catch(e){status(e.message);}}
async function show(account,offline=false){
  $('accountLogout').hidden=false; $('googleLogin').hidden=true;
  if(account.status!=='approved'){status(account.email+' - '+(account.status==='pending'?'Awaiting administrator approval. Refresh after approval.':'Account suspended.'));return;}
  const terms=offline?{accepted:true}:await api('terms');
  if(!terms.accepted){
    $('organizerTerms').hidden=false;status('Review the organizer terms to continue.');
    $('acceptTerms').onclick=async()=>{try{if(!$('termsAgree').checked)return;await api('terms','POST',{version:terms.version,accept:true});$('organizerTerms').hidden=true;await show(account);}catch(e){status(e.message);}};
    return;
  }
  // Legacy scores can only be claimed by the designated administrator and only explicitly.
  const key='cricboard-tournaments-v1:'+account.sub;
  if(account.role==='admin'&&!localStorage.getItem(key)&&localStorage.getItem('cricboard-tournaments-v1')&&confirm('Import your existing local tournament records into this administrator account? The original copy will remain untouched.')) localStorage.setItem(key,localStorage.getItem('cricboard-tournaments-v1'));
  if(native&&!offline)localStorage.setItem(cacheKey,JSON.stringify({...account,verifiedAt:Date.now()}));
  window.cricboardAccount={...account,key,api};
  $('accountGate').hidden=true; $('adminApp').hidden=false; $('accountEmail').textContent=account.email; $('signOut').onclick=logout;
  if(account.role==='admin'){
    $('accountsPanel').hidden=false;
    const refresh=async()=>{const list=await api('accounts');$('accountList').replaceChildren();for(const user of list){const row=document.createElement('div');row.className='team-chip';const label=document.createElement('span');label.textContent=user.email+' � '+user.status;row.append(label);if(user.role!=='admin'){for(const [label,value] of [['Approve','approved'],['Suspend','suspended']]){const b=document.createElement('button');b.className='btn btn-small btn-outline';b.textContent=label;b.disabled=user.status===value;b.onclick=async()=>{try{await api('accounts','POST',{sub:user.sub,status:value});await refresh();}catch(e){alert(e.message);}};row.append(b);}}$('accountList').append(row);}};
    $('refreshAccounts').onclick=()=>refresh().catch(e=>alert(e.message));refresh().catch(e=>{$('accountList').textContent=e.message;});
  }
  await import('./app.js');
  if(!offline) await (await import('./team-access.mjs')).setupTeamAccess(window.cricboardAccount);
  const recheck=async()=>{try{const current=await api('me');if(current.status!=='approved'||current.sub!==account.sub){localStorage.removeItem(cacheKey);location.reload();}else if(native){const terms=await api('terms');if(!terms.accepted){localStorage.removeItem(cacheKey);location.reload();}else localStorage.setItem(cacheKey,JSON.stringify({...current,verifiedAt:Date.now()}));}}catch(e){if(!native||e.status===401||e.status===403){if(native)localStorage.removeItem(cacheKey);location.reload();}}};setInterval(recheck,60000);if(native)window.addEventListener('online',recheck);
}
async function init(){
  if(remote){$('accountGate').hidden=true;await import('./app.js');return;}
  const params=new URLSearchParams(location.search);
  if(params.has('public')||params.has('tournament')||(!params.has('manage')&&!params.has('local'))){await (await import('./portal.mjs')).initPortal();return;}
  $('accountGate').hidden=false;
  $('accountLogout').onclick=logout;
  try {await show(await api('me'));return;}catch(e){status(e.message);if(native){const prior=cached();if(!e.status&&!navigator.onLine&&prior?.status==='approved'&&Date.now()-prior.verifiedAt<86400000){await show(prior,true);return;}if(e.status===401||e.status===403)localStorage.removeItem(cacheKey);}}
  if(native){const button=document.createElement('button');button.className='btn btn-primary';button.textContent='Sign in with Google';button.onclick=async()=>{button.disabled=true;try{const credential=await native.signIn();await show(await api('login','POST',{credential}));}catch(e){status(e.message);}finally{button.disabled=false;}};$('googleLogin').append(button);return;}
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  script.onerror=()=>status('Google sign-in failed to load.');script.onload=()=>{
    google.accounts.id.initialize({client_id:document.querySelector('meta[name="google-client-id"]').content,callback:async response=>{try{await show(await api('login','POST',{credential:response.credential}));}catch(e){status(e.message);}}});
    google.accounts.id.renderButton($('googleLogin'),{theme:'outline',size:'large',text:'continue_with'});
  };document.head.append(script);
}
init().catch(e=>status(e.message));

