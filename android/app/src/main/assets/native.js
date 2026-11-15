(() => {
  const pending = new Map(); let count=0;
  const bridge=window.CricAndroid;
  if(!bridge)return;
  bridge.onmessage=e=>{try{const r=JSON.parse(e.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(r.error)):p.resolve(r.value);}catch{}};
  function request(action,args={}){return new Promise((resolve,reject)=>{const id=String(++count),timer=setTimeout(()=>{pending.delete(id);reject(Error('Android request timed out'));},180000);pending.set(id,{resolve,reject,timer});bridge.postMessage(JSON.stringify({id,action,...args}));});}
  window.CricNative={signIn:()=>request('signIn'),drive:(interactive,email)=>request('drive',{interactive,email}),signOut:()=>request('signOut')};
  document.addEventListener('click',async e=>{const a=e.target.closest?.('a[download]');if(!a||!a.href.startsWith('blob:'))return;e.preventDefault();try{const blob=await (await fetch(a.href)).text();await request('save',{filename:a.download,content:blob});}catch(err){alert(err.message);}},true);
})();