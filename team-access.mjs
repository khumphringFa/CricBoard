const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n;};
export async function setupTeamAccess(account){
  const panel=el('section',null,document.querySelector('#adminApp .sidebar'));panel.className='ta-panel';
  el('h2','Team manager access',panel);
  el('p','Invite trusted people to manage their own squad and player profiles.',panel).className='ta-description';
  const message=el('p','',panel);message.className='ta-status';message.setAttribute('role','status');
  const button=(text,parent,action)=>{const b=el('button',text,parent);b.className='btn btn-outline';b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message.textContent=e.message;}finally{b.disabled=false;}};return b;};
  const invite=el('div',null,panel);invite.className='ta-invite';
  el('h3','Assign a manager',invite);
  const form=el('div',null,invite);form.className='ta-form';
  const teamLabel=el('label','Team',form),emailLabel=el('label','Google email',form);
  const select=el('select',null,teamLabel),email=el('input',null,emailLabel);select.className=email.className='field';email.type='email';email.placeholder='manager@example.com';email.setAttribute('aria-label','Manager Google email');select.setAttribute('aria-label','Team to assign');
  el('p','Sync your tournament first. The manager must sign in and receive administrator approval.',invite).className='ta-description';
  const grants=el('div',null,panel),managed=el('div',null,panel);grants.className='ta-grants';managed.className='ta-managed';
  const reminder=el('details',null,panel);reminder.className='ta-reminder';el('summary','How squad updates reach the organizer',reminder);el('p','After a manager saves, restore the central copy in Settings before continuing to score or sync.',reminder);
  async function refresh(){
    const central=await account.api('central');select.replaceChildren(new Option('Select a synced team',''));
    for(const t of central.data?.teams||[])select.add(new Option(t.name,t.id));
    grants.replaceChildren();el('h3','Current access',grants);
    for(const g of await account.api('team-access')){const row=el('p',(central.data?.teams.find(t=>t.id===g.team_id)?.name||g.team_id)+' / '+g.email,grants);button('Revoke',row,async()=>{await account.api('team-access','DELETE',{teamId:g.team_id,email:g.email});await refresh();});}
    managed.replaceChildren();el('h3','Teams assigned to me',managed);
    const teams=await account.api('managed-teams');
    if(!teams.length)el('p','No assigned teams yet.',managed);
    for(const item of teams){
      const box=el('details',null,managed);box.className='ta-squad';el('summary',item.team.name+' / '+item.players.length+' players',box);const rows=el('div',null,box);rows.className='ta-players';let editors=[];
      function add(p){const card=el('details',null,rows);card.className='ta-player';card.open=!p.name;el('summary',p.name||'New player',card);const row=el('div',null,card);row.className='ta-profile';const fields={};for(const [key,label] of [['name','Player name'],['role','Playing role'],['jersey','Jersey number'],['batting','Batting style'],['bowling','Bowling style'],['bio','Introduction']]){const wrap=el('label',label,row);const choices={role:['','Batter','Bowler','All-rounder','Wicketkeeper','Wicketkeeper-batter'],batting:['','Right-handed','Left-handed'],bowling:['','Right-arm pace','Left-arm pace','Right-arm medium','Left-arm medium','Off spin','Leg spin','Left-arm orthodox','Left-arm wrist spin']};const input=el(choices[key]?'select':key==='bio'?'textarea':'input',null,wrap);input.className='field';for(const choice of choices[key]||[])input.add(new Option(choice||'Not specified',choice));input.value=key==='name'?p.name||'':p.profile?.[key]||'';input.setAttribute('aria-label',label);fields[key]=input;}editors.push({id:p.id,fields});}
      item.players.forEach(add);const actions=el('div',null,box);actions.className='ta-actions';button('+ Add player',actions,()=>add({id:crypto.randomUUID()}));
      button('Save squad',actions,async()=>{const players=editors.map(({id,fields:f})=>({id,name:f.name.value.trim(),profile:Object.fromEntries(Object.entries(f).filter(([k])=>k!=='name').map(([k,v])=>[k,v.value.trim()]))}));const result=await account.api('managed-teams','PUT',{owner:item.owner,teamId:item.team.id,revision:item.revision,players});item.revision=result.revision;message.textContent='Squad saved centrally. The organizer must restore the central copy before continuing on another device.';});
    }
  }
  button('Assign manager',form,async()=>{if(!email.checkValidity()||!email.value||!select.value)throw Error('Select a synced team and enter a valid email');await account.api('team-access','POST',{teamId:select.value,email:email.value});await refresh();email.value='';message.textContent='Manager assigned.';});
  const refreshButton=button('Refresh teams and access',panel,refresh);refreshButton.classList.add('ta-refresh');
  try{await refresh();}catch(e){message.textContent=e.message;}
}