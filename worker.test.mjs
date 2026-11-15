import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle,verifyGoogle,canonicalEmail,registerVerifiedIdentity} from './worker.mjs';
import {publicTournament} from './public-data.mjs';
import {centralStore,centralSummary} from './central-data.mjs';
import {createMatch,startMatch,selectPlayers,applyDelivery} from './engine.mjs';

test('public scorecards are opt-in and derive scores without exposing raw deliveries',()=>{
  const squads={A:[{id:'A1',name:'Batter one'},{id:'A2',name:'Batter two'}],B:[{id:'B1',name:'Bowler one'},{id:'B2',name:'Bowler two'}]};
  let m=startMatch(createMatch({tournamentId:'t',teamA:'A',teamB:'B',battingFirst:'A',overs:2,squads}));
  m=selectPlayers(m,{striker:'A1',nonStriker:'A2',bowler:'B1'});m=applyDelivery(m,{kind:'bat',runs:4});
  const data={tournaments:[{id:'t',name:'Cup'}],teams:[{id:'A',name:'Alpha',tournamentId:'t'},{id:'B',name:'Beta',tournamentId:'t'}],matches:[m],activeTournamentId:'t',activeMatchId:m.id};
  const teamOnly=publicTournament(data);assert.equal(teamOnly.matches[0].innings[0].runs,4);assert.doesNotMatch(JSON.stringify(teamOnly),/Batter one|Bowler one|deliveries/);
  const detail=publicTournament(data,true);assert.equal(detail.batting[0].runs,4);assert.equal(detail.bowling[0].runs,4);assert.equal(detail.matches[0].innings[0].batting[0].name,'Batter one');assert.doesNotMatch(JSON.stringify(detail),/deliveries|lineup|A1/);
});

test('verified Gmail aliases promote only the configured administrator and retain data',async()=>{
  const sql=new DatabaseSync(':memory:'); sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const DB={prepare:statement=>({statement,bind:(...args)=>({first:async()=>sql.prepare(statement).get(...args),run:async()=>sql.prepare(statement).run(...args)})}),batch:async entries=>{for(const entry of entries)sql.exec(entry.statement);}};
  const configured='sampleadmin@gmail.com';
  const adminHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(configured))).toString('hex');
  sql.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run('owner','sample.admin@gmail.com','organizer','pending',100);
  sql.prepare('INSERT INTO snapshots VALUES(?,?,?)').run('owner','revision','{}');
  const owner=await registerVerifiedIdentity(DB,{sub:'owner',email:'sample.admin@gmail.com'},adminHash);
  assert.equal(owner.role,'admin'); assert.equal(owner.status,'approved'); assert.equal(owner.email,'sample.admin@gmail.com');
  assert.equal(sql.prepare('SELECT revision FROM snapshots WHERE sub=?').get('owner').revision,'revision');
  assert.equal((await registerVerifiedIdentity(DB,{sub:'other',email:'sample.admin@example.com'},adminHash)).status,'pending');
  sql.prepare("UPDATE accounts SET status='suspended' WHERE sub='other'").run();
  assert.equal((await registerVerifiedIdentity(DB,{sub:'other',email:'sample.admin@example.com'},adminHash)).status,'suspended');
  assert.equal(canonicalEmail('Sample.Admin@gmail.com'),configured);
  assert.equal(canonicalEmail('Sample.Admin@example.com'),'sample.admin@example.com');
});

test('Google identity verifies signature, audience and verified email',async()=>{
  const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test';
  const fetcher=async()=>Response.json({keys:[jwk]});
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const claims={iss:'https://accounts.google.com',aud:'342863663518-8raaefvf2qt3skk5jfbego0vfob8441f.apps.googleusercontent.com',sub:'123',email:'test@gmail.com',email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600};
  const sign=async c=>{const head=encode({alg:'RS256',kid:'test'})+'.'+encode(c);return head+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(head))).toString('base64url');};
  assert.deepEqual(await verifyGoogle(await sign(claims),fetcher),{sub:'123',email:'test@gmail.com'});
  for(const bad of [{aud:'wrong'},{email_verified:false},{exp:1}]) await assert.rejects(verifyGoogle(await sign({...claims,...bad}),fetcher));
});
test('public spectator assets do not need account; private API fails closed',async()=>{
  const env={ASSETS:{fetch:()=>new Response('public view')}};
  assert.equal(await (await handle(new Request('https://example.com/?display=abcdef'),env)).text(),'public view');
  assert.equal((await handle(new Request('https://example.com/api/me'),env)).status,503);
  assert.equal((await handle(new Request('https://example.com/api/me'),{DB:{}})).status,401);
  assert.equal((await handle(new Request('https://example.com/api/login',{method:'POST',headers:{Origin:'https://evil.test'}}),{DB:{}})).status,403);
});
test('pending or suspended users cannot read or update account records',async()=>{
  for(const status of ['pending','suspended']){
    const DB={prepare:()=>({bind:()=>({first:async()=>({sub:'x',role:'organizer',status})})})};
    const headers={Cookie:'__Host-cricboard='+'a'.repeat(64),Origin:'https://example.com'};
    assert.equal((await handle(new Request('https://example.com/api/snapshot',{headers}),{DB})).status,403);
    assert.equal((await handle(new Request('https://example.com/api/accounts',{headers}),{DB})).status,403);
  }
});
test('real SQL isolates account snapshots and rejects stale revisions',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const DB={prepare:statement=>{const bound=(...args)=>({first:async()=>sql.prepare(statement).get(...args),run:async()=>({meta:sql.prepare(statement).run(...args)}),all:async()=>({results:sql.prepare(statement).all(...args)})});return {...bound(),bind:bound};}};
  const tokens=['a'.repeat(64),'b'.repeat(64)];
  for(const [i,token] of tokens.entries()){
    const sub='user'+i;sql.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(sub,sub+'@gmail.com','organizer','approved',Date.now());
    const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,sub,Date.now()+60000);
  }
  const request=(i,path,method='GET',body)=>handle(new Request('https://example.com/api/'+path,{method,headers:{Cookie:'__Host-cricboard='+tokens[i],Origin:'https://example.com','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB});
  for(const i of [0,1])assert.equal((await request(i,'terms','POST',{version:'central-required-v1',accept:true})).status,200);
  const data={tournaments:[{id:'t',name:'Private league'}],teams:[],matches:[],activeTournamentId:'t',activeMatchId:null};
  assert.equal((await request(0,'snapshot','PUT',{revision:null,data})).status,200);
  assert.equal((await (await request(1,'snapshot')).json()).data,null);
  assert.equal((await request(0,'snapshot','PUT',{revision:null,data})).status,409);
  assert.equal((await request(1,'accounts')).status,404);
  assert.deepEqual((await (await request(0,'snapshot')).json()).data,data);
});
test('public portal requires explicit publication, isolates owners, hides suspended users and blocks stale updates',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const DB={prepare:statement=>{const bound=(...args)=>({first:async()=>sql.prepare(statement).get(...args),run:async()=>({meta:sql.prepare(statement).run(...args)}),all:async()=>({results:sql.prepare(statement).all(...args)})});return {...bound(),bind:bound};}};
  const tokens=['a'.repeat(64),'b'.repeat(64)];
  for(const [i,token] of tokens.entries()){
    const sub='owner'+i;sql.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(sub,sub+'@gmail.com','organizer','approved',Date.now());
    const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,sub,Date.now()+60000);
  }
  const req=(i,path,method='GET',body)=>handle(new Request('https://example.com/api/'+path,{method,headers:{...(i===null?{}:{Cookie:'__Host-cricboard='+tokens[i]}),Origin:'https://example.com','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB});
  const data={tournaments:[{id:'t',name:'Public league',privateNote:'never expose'}],teams:[{id:'a',name:'Alpha',tournamentId:'t',contact:'private phone'}],players:[{id:'p',name:'Private Player',teamId:'a',tournamentId:'t'}],matches:[],activeTournamentId:'t',activeMatchId:null,secret:'never expose'};
  for(const i of [0,1])assert.equal((await req(i,'terms','POST',{version:'central-required-v1',accept:true})).status,200);
  assert.deepEqual(await (await req(null,'public')).json(),[]);
  assert.equal((await req(null,'publications','POST',{data})).status,401);
  const pub=await (await req(0,'publications','POST',{data})).json();assert.ok(pub.slug);
  const view=await (await req(null,'public/'+pub.slug)).json();assert.equal(view.name,'Public league');assert.deepEqual(view.teams,['Alpha']);assert.doesNotMatch(JSON.stringify(view),/private|never expose|owner0|Private Player/);
  assert.equal((await (await req(null,'public')).json()).length,1);
  assert.deepEqual(await (await req(1,'publications')).json(),[]);
  assert.equal((await req(1,'publications','DELETE',{tournamentId:'t'})).status,200);assert.equal((await req(null,'public/'+pub.slug)).status,200);
  assert.equal((await req(0,'publications','PUT',{data,updatedAt:pub.updated_at})).status,200);
  assert.equal((await req(0,'publications','PUT',{data,updatedAt:pub.updated_at})).status,409);
  sql.prepare("UPDATE accounts SET status='suspended' WHERE sub='owner0'").run();assert.equal((await req(null,'public/'+pub.slug)).status,404);
  sql.prepare("UPDATE accounts SET status='approved' WHERE sub='owner0'").run();assert.equal((await req(0,'publications','DELETE',{tournamentId:'t'})).status,200);
  assert.equal((await req(null,'public/'+pub.slug)).status,404);assert.equal((await req(0,'publications','PUT',{data,updatedAt:pub.updated_at})).status,409);
  const again=await (await req(0,'publications','POST',{data})).json();assert.equal(again.slug,pub.slug);
});
test('mandatory central sync requires terms, cannot be disabled and preserves private backups',async()=>{
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const DB={prepare:statement=>{const bound=(...args)=>({first:async()=>sql.prepare(statement).get(...args),run:async()=>({meta:sql.prepare(statement).run(...args)}),all:async()=>({results:sql.prepare(statement).all(...args)})});return {...bound(),bind:bound};}};
  const tokens=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
  for(const [i,token] of tokens.entries()){
    const sub='user'+i;sql.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(sub,sub+'@gmail.com',i===0?'admin':'organizer','approved',Date.now());const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,sub,Date.now()+60000);
  }
  const req=(i,path,method='GET',body)=>handle(new Request('https://example.com/api/'+path,{method,headers:{...(i===null?{}:{Cookie:'__Host-cricboard='+tokens[i]}),Origin:'https://example.com','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB});
  let data={tournaments:[{id:'t',name:'Shared league',secret:'private metadata'}],teams:[],matches:[],activeTournamentId:'t',activeMatchId:null,secret:'private metadata'};
  assert.equal((await req(1,'central','POST',{revision:null,data,consent:true})).status,403);
  assert.equal((await req(1,'snapshot','PUT',{revision:null,data})).status,403);
  assert.equal((await req(1,'terms','POST',{version:'old',accept:true})).status,400);
  assert.equal((await req(1,'terms','POST',{version:'central-required-v1',accept:false})).status,400);
  for(const i of [1,2])assert.equal((await req(i,'terms','POST',{version:'central-required-v1',accept:true})).status,200);
  await req(1,'snapshot','PUT',{revision:null,data});
  assert.equal((await req(0,'central-admin/user1')).status,404);
  assert.equal((await req(null,'central-admin')).status,401);
  assert.equal((await req(2,'central-admin')).status,404);
  assert.equal((await req(1,'central','POST',{revision:null,data})).status,400);
  assert.equal((await req(1,'central','PUT',{revision:null,data})).status,409);
  const first=await (await req(1,'central','POST',{revision:null,data,consent:true})).json();assert.ok(first.revision);
  const overview=await (await req(0,'central-admin')).json();assert.equal(overview.find(x=>x.sub==='user1').summary.tournaments,1);assert.equal(overview.find(x=>x.sub==='user2').summary,null);
  const detail=await (await req(0,'central-admin/user1')).json();assert.equal(detail.data.tournaments[0].name,'Shared league');assert.doesNotMatch(JSON.stringify(detail),/private metadata/);
  assert.equal((await req(2,'central-admin/user1')).status,404);
  assert.equal((await req(1,'central','PUT',{revision:first.revision,data})).status,200);assert.equal((await req(1,'central','PUT',{revision:first.revision,data})).status,409);
  const latest=await (await req(1,'central')).json();assert.equal((await req(1,'central','DELETE')).status,403);
  assert.equal((await req(0,'central-admin/user1')).status,200);assert.equal((await req(1,'central','PUT',{revision:latest.revision,data})).status,200);
  assert.equal((await (await req(1,'snapshot')).json()).data.secret,'private metadata');
  assert.equal((await (await req(1,'central')).json()).enabled,true);
});
test('central backup retains cricket deliveries and computes global tournament leaders',()=>{
  const squads={A:[{id:'A1',name:'Batter one'},{id:'A2',name:'Batter two'}],B:[{id:'B1',name:'Bowler one'},{id:'B2',name:'Bowler two'}]};
  let m=startMatch(createMatch({tournamentId:'t',teamA:'A',teamB:'B',battingFirst:'A',overs:2,squads}));m=selectPlayers(m,{striker:'A1',nonStriker:'A2',bowler:'B1'});m=applyDelivery(m,{kind:'bat',runs:4});
  const clean=centralStore({tournaments:[{id:'t',name:'Cup'}],teams:[{id:'A',name:'Alpha',tournamentId:'t'},{id:'B',name:'Beta',tournamentId:'t'}],matches:[m],activeTournamentId:'t',activeMatchId:m.id});
  assert.equal(clean.matches[0].innings[0].deliveries[0].runs,4);const summary=centralSummary(clean);assert.equal(summary.batting[0].runs,4);assert.equal(summary.bowling[0].runs,4);assert.equal(summary.live,1);
});
