import {fingerprint,validateStore} from './cloud.mjs';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const table=(headers,rows)=>'<div class="table-wrap"><table class="standings"><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const timestamp=t=>t?new Date(t).toLocaleString():'Not synchronized';
const syncStatus=r=>!r.termsAccepted?'Terms pending':r.summary?'Synchronized':'Awaiting first sync';
const csvCell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const exportCsv=(name,rows)=>download(name,'\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
export function setupCentral({account,getStore,replaceStore,storage}){
  const status=s=>{$('centralStatus').textContent=s;};let remote=null,busy=false,dirty=false,timer,conflict=false,retryDelay=1800;
  const baseKey='central-base-v1', base=()=>{try{return JSON.parse(storage.getItem(baseKey))||{};}catch{return {};}};
  const controls=()=>{$('centralEnable').disabled=busy||!conflict||!remote;$('centralSync').disabled=busy||!remote||conflict;$('centralRestore').disabled=busy||!remote?.data;};
  const remember=(revision,hash)=>storage.setItem(baseKey,JSON.stringify({revision,hash}));
  const schedule=()=>{dirty=true;clearTimeout(timer);if(!conflict)timer=setTimeout(sync,retryDelay);};
  async function upload(consent=false){
    if(busy)return;busy=true;dirty=false;controls();status("Syncing tournament records…");
    try{const data=validateStore(getStore()),hash=await fingerprint(data);if(!consent&&base().hash===hash){status("Central copy up to date · Last synced "+timestamp(remote.updatedAt));return;}const saved=await account.api('central',consent?'POST':'PUT',{revision:remote?.revision??null,data,consent});remote={...saved,data};remember(saved.revision,hash);conflict=false;retryDelay=1800;status('Central sharing enabled · Last synced '+timestamp(saved.updatedAt));}
    catch(e){if(e instanceof TypeError||e.status>=500){dirty=true;retryDelay=Math.min(60000,retryDelay*2);status('Central sync queued; local scores are safe. Retrying when the connection returns.');}else{conflict=true;status(e.message+' Local records are safe. Restore or replace the central copy.');}}
    finally{busy=false;controls();if(dirty&&!conflict)schedule();}
  }
  async function sync(){if(conflict)return;if(busy){dirty=true;return;}if(!remote){await initialize();return;}await upload(!remote.enabled);}
  $('centralEnable').onclick=async()=>{if(!confirm('Share all your tournament records, team names, player names and match scores with the CricBoard Super Admin? This does not share your private Google Drive or publish anything on the public portal. If a central copy exists, the current device will replace it.'))return;try{remote=await account.api('central');await upload(true);}catch(e){status(e.message);}};
  $('centralSync').onclick=sync;
  $('centralRestore').onclick=async()=>{if(!confirm('Restore the centrally saved tournament copy? Your current device records will be kept in a local recovery copy.'))return;busy=true;controls();try{remote=await account.api('central');if(!remote.data)throw Error('No central copy');const data=validateStore(remote.data);replaceStore(data);remember(remote.revision,await fingerprint(getStore()));conflict=false;dirty=false;status('Central copy restored · '+timestamp(remote.updatedAt));}catch(e){status(e.message);}finally{busy=false;controls();if(!remote?.enabled&&!conflict)schedule();}};
  async function initialize(){if(busy)return;busy=true;controls();try{remote=await account.api('central');if(window.CricNative && remote.data && !base().revision){
      const local=getStore(), pristine=!local.teams.length&&!local.matches.length&&local.tournaments.length===1&&local.tournaments[0].name==='My Local Tournament';
      if(pristine){const before=await fingerprint(local);const restored=validateStore(remote.data);if(await fingerprint(getStore())===before){replaceStore(restored);remember(remote.revision,await fingerprint(getStore()));}}
    }
    conflict=Boolean(remote.data)&&base().revision!==remote.revision;status(conflict?'Central copy exists on another device or changed. Restore or replace to resume required synchronization.':'Central synchronization required · '+timestamp(remote.updatedAt));}catch(e){status('Central sync pending: '+e.message);retryDelay=Math.min(60000,retryDelay*2);}finally{busy=false;controls();if(!conflict)schedule();}}
  initialize();
  window.addEventListener('online',()=>{if(!conflict){retryDelay=1800;schedule();}});
  controls();if(account.role==='admin')setupAdmin(account);return {changed:schedule};
}
function setupAdmin(account){
  $('centralAdminPanel').hidden=false;let rows=[],selected=null;
  const status=s=>{$('centralAdminStatus').textContent=s;};
  const render=()=>{
    const q=$('centralSearch').value.toLowerCase(),shown=rows.filter(r=>r.email.toLowerCase().includes(q));
    const totals=key=>shown.reduce((sum,r)=>sum+(r.summary?.[key]||0),0);
    $('centralMetrics').innerHTML=[['Organizers',shown.length],['Sharing',shown.filter(r=>r.summary).length],['Tournaments',totals('tournaments')],['Matches',totals('matches')],['Live',totals('live')],['Completed',totals('completed')]].map(([label,value])=>`<span class="team-chip"><strong>${value}</strong> ${label}</span>`).join('');
    $('centralOrganizers').innerHTML=table(['Organizer','Sync status','Tournaments','Teams','Players','Matches','Last sync'],shown.map(r=>[r.email,syncStatus(r),r.summary?.tournaments??'—',r.summary?.teams??'—',r.summary?.players??'—',r.summary?.matches??'—',timestamp(r.updatedAt)]));
    const select=$('centralOrganizer');const old=select.value;select.replaceChildren(new Option('Select shared organizer',''));for(const r of shown.filter(r=>r.summary))select.add(new Option(r.email,r.sub));if([...select.options].some(o=>o.value===old))select.value=old;
    const batting=shown.flatMap(r=>(r.summary?.batting||[]).map(p=>({...p,owner:r.email}))).sort((a,b)=>b.runs-a.runs).slice(0,10), bowling=shown.flatMap(r=>(r.summary?.bowling||[]).map(p=>({...p,owner:r.email}))).sort((a,b)=>b.wickets-a.wickets||a.runs-b.runs).slice(0,10);
    $('centralLeaders').innerHTML='<h3>Top batting (shared records)</h3>'+table(['Player','Team','Tournament','Organizer','Runs','HS','SR'],batting.map(p=>[p.name,p.team,p.tournament,p.owner,p.runs,p.highest,p.strikeRate]))+'<h3>Top bowling (shared records)</h3>'+table(['Player','Team','Tournament','Organizer','W','R','O','Econ'],bowling.map(p=>[p.name,p.team,p.tournament,p.owner,p.wickets,p.runs,p.overs,p.economy]));
  };
  async function refresh(){try{rows=[];selected=null;$('centralDetail').replaceChildren();$('centralDownload').disabled=true;$('centralTournamentCsv').disabled=true;let next;do{next=await account.api('central-admin?offset='+rows.length);rows.push(...next);}while(next.length===50&&rows.length<5000);render();status(rows.length>=5000?'Showing up to 5,000 approved accounts.':'Updated '+timestamp(Date.now()));}catch(e){status(e.message);}}
  $('centralRefresh').onclick=refresh;$('centralSearch').oninput=render;
  $('centralCsv').onclick=()=>exportCsv('cricboard-organizers.csv',[['Organizer','Sync status','Tournaments','Teams','Players','Matches','Live','Completed','Last sync'],...rows.map(r=>[r.email,syncStatus(r),r.summary?.tournaments,r.summary?.teams,r.summary?.players,r.summary?.matches,r.summary?.live,r.summary?.completed,timestamp(r.updatedAt)])]);
  $('centralOrganizer').onchange=async()=>{selected=null;$('centralDownload').disabled=true;$('centralTournamentCsv').disabled=true;$('centralDetail').replaceChildren();if(!$('centralOrganizer').value)return;try{const sub=$('centralOrganizer').value;const entry=await account.api('central-admin/'+encodeURIComponent(sub));if($('centralOrganizer').value!==sub)return;selected={sub,...entry};const d=entry.data;$('centralDetail').innerHTML='<h3>'+esc(entry.email)+'</h3>'+table(['Tournament','Teams','Matches','Live','Completed'],d.tournaments.map(t=>[t.name,d.teams.filter(x=>x.tournamentId===t.id).length,d.matches.filter(x=>x.tournamentId===t.id).length,d.matches.filter(x=>x.tournamentId===t.id&&['live','break'].includes(x.status)).length,d.matches.filter(x=>x.tournamentId===t.id&&x.status==='completed').length]));$('centralDownload').disabled=false;$('centralTournamentCsv').disabled=false;}catch(e){status(e.message);}};
  async function freshSelected(){if(!selected)throw Error('Choose an organizer');return account.api('central-admin/'+encodeURIComponent(selected.sub));}
  $('centralDownload').onclick=async()=>{try{const entry=await freshSelected();download('cricboard-central-recovery.json',JSON.stringify({app:'CricBoard',version:1,savedAt:new Date(entry.updatedAt).toISOString(),data:entry.data},null,2),'application/json');}catch(e){status(e.message);}};
  $('centralTournamentCsv').onclick=async()=>{try{const {data:d}=await freshSelected();const name=id=>d.teams.find(t=>t.id===id)?.name;exportCsv('cricboard-match-records.csv',[['Tournament','Match','Team A','Team B','Status','Updated'],...d.matches.map(m=>[d.tournaments.find(t=>t.id===m.tournamentId)?.name,m.label,name(m.teamA),name(m.teamB),m.status,m.updatedAt])]);}catch(e){status(e.message);}};
  refresh();
}
