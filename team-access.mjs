const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n;};
export async function setupTeamAccess(account){
  const panel=el('section',null,document.getElementById('adminApp'));panel.className='card';panel.style.margin='24px';
  el('h2','Team manager access',panel);
  el('p','Assign an approved Google account to edit a team squad. Sync your tournament first. After a manager saves, restore the central copy in Settings before scoring or syncing from your own device.',panel);
  const message=el('p','',panel);message.setAttribute('role','status');
  const button=(text,parent,action)=>{const b=el('button',text,parent);b.className='btn btn-outline';b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message.textContent=e.message;}finally{b.disabled=false;}};return b;};
  const select=el('select',null,panel),email=el('input',null,panel);email.type='email';email.placeholder='Manager Google email';email.setAttribute('aria-label','Manager Google email');select.setAttribute('aria-label','Team to assign');
  const grants=el('div',null,panel),managed=el('div',null,panel);
  async function refresh(){
    const central=await account.api('central');select.replaceChildren();
    for(const t of central.data?.teams||[])select.add(new Option(t.name,t.id));
    grants.replaceChildren();
    for(const g of await account.api('team-access')){const row=el('p',(central.data?.teams.find(t=>t.id===g.team_id)?.name||g.team_id)+' � '+g.email,grants);button('Revoke',row,async()=>{await account.api('team-access','DELETE',{teamId:g.team_id,email:g.email});await refresh();});}
    managed.replaceChildren();el('h3','Teams assigned to me',managed);
    const teams=await account.api('managed-teams');
    if(!teams.length)el('p','No assigned teams yet.',managed);
    for(const item of teams){
      const box=el('details',null,managed);el('summary',item.team.name,box);const rows=el('div',null,box);let editors=[];
      function add(p){const row=el('fieldset',null,rows);el('legend',p.name||'New player',row);const fields={};for(const [key,label] of [['name','Player name'],['role','Role (Batter, Bowler, All-rounder, Wicketkeeper)'],['jersey','Jersey number'],['batting','Batting style'],['bowling','Bowling style'],['bio','Introduction']]){el('label',label,row);const choices={role:['','Batter','Bowler','All-rounder','Wicketkeeper','Wicketkeeper-batter'],batting:['','Right-handed','Left-handed'],bowling:['','Right-arm pace','Left-arm pace','Right-arm medium','Left-arm medium','Off spin','Leg spin','Left-arm orthodox','Left-arm wrist spin']};const input=el(choices[key]?'select':'input',null,row);for(const choice of choices[key]||[])input.add(new Option(choice||'Not specified',choice));input.value=key==='name'?p.name||'':p.profile?.[key]||'';input.setAttribute('aria-label',label);fields[key]=input;}editors.push({id:p.id,fields});}
      item.players.forEach(add);button('Add player',box,()=>add({id:crypto.randomUUID()}));
      button('Save squad',box,async()=>{const players=editors.map(({id,fields:f})=>({id,name:f.name.value.trim(),profile:Object.fromEntries(Object.entries(f).filter(([k])=>k!=='name').map(([k,v])=>[k,v.value.trim()]))}));const result=await account.api('managed-teams','PUT',{owner:item.owner,teamId:item.team.id,revision:item.revision,players});item.revision=result.revision;message.textContent='Squad saved centrally. The organizer must restore the central copy before continuing on another device.';});
    }
  }
  button('Assign manager',panel,async()=>{if(!email.checkValidity()||!email.value||!select.value)throw Error('Select a synced team and enter a valid email');await account.api('team-access','POST',{teamId:select.value,email:email.value});await refresh();message.textContent='Manager assigned.';});
  button('Refresh teams and access',panel,refresh);
  try{await refresh();}catch(e){message.textContent=e.message;}
}

