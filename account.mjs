const $=id=>document.getElementById(id);
const remote=new URLSearchParams(location.search).has('display');
const api=async(path,method='GET',data)=>{
  const res=await fetch('/api/'+path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store'});
  const body=await res.json(); if(!res.ok) throw Error(body.error||'Account service unavailable'); return body;
};
const status=message=>{$('accountStatus').textContent=message;};
async function logout(){try{await api('logout','POST');location.replace(location.pathname);}catch(e){status(e.message);}}
async function show(account){
  $('accountLogout').hidden=false; $('googleLogin').hidden=true;
  if(account.status!=='approved'){status(account.email+' — '+(account.status==='pending'?'Awaiting administrator approval. Refresh after approval.':'Account suspended.'));return;}
  // Legacy scores can only be claimed by the designated administrator and only explicitly.
  const key='cricboard-tournaments-v1:'+account.sub;
  if(account.role==='admin'&&!localStorage.getItem(key)&&localStorage.getItem('cricboard-tournaments-v1')&&confirm('Import your existing local tournament records into this administrator account? The original copy will remain untouched.')) localStorage.setItem(key,localStorage.getItem('cricboard-tournaments-v1'));
  window.cricboardAccount={...account,key,api};
  $('accountGate').hidden=true; $('adminApp').hidden=false; $('accountEmail').textContent=account.email; $('signOut').onclick=logout;
  if(account.role==='admin'){
    $('accountsPanel').hidden=false;
    const refresh=async()=>{const list=await api('accounts');$('accountList').replaceChildren();for(const user of list){const row=document.createElement('div');row.className='team-chip';const label=document.createElement('span');label.textContent=user.email+' · '+user.status;row.append(label);if(user.role!=='admin'){for(const [label,value] of [['Approve','approved'],['Suspend','suspended']]){const b=document.createElement('button');b.className='btn btn-small btn-outline';b.textContent=label;b.disabled=user.status===value;b.onclick=async()=>{try{await api('accounts','POST',{sub:user.sub,status:value});await refresh();}catch(e){alert(e.message);}};row.append(b);}}$('accountList').append(row);}};
    $('refreshAccounts').onclick=()=>refresh().catch(e=>alert(e.message));refresh().catch(e=>{$('accountList').textContent=e.message;});
  }
  await import('./app.js');
  setInterval(async()=>{try{const current=await api('me');if(current.status!=='approved'||current.sub!==account.sub)location.reload();}catch{location.reload();}},60000);
}
async function init(){
  if(remote){$('accountGate').hidden=true;await import('./app.js');return;}
  $('accountLogout').onclick=logout;
  try {await show(await api('me'));return;}catch(e){status(e.message);}
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
  script.onerror=()=>status('Google sign-in failed to load.');script.onload=()=>{
    google.accounts.id.initialize({client_id:document.querySelector('meta[name="google-client-id"]').content,callback:async response=>{try{await show(await api('login','POST',{credential:response.credential}));}catch(e){status(e.message);}}});
    google.accounts.id.renderButton($('googleLogin'),{theme:'outline',size:'large',text:'continue_with'});
  };document.head.append(script);
}
init().catch(e=>status(e.message));
