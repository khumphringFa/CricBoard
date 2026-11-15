import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle,verifyGoogle,canonicalEmail,registerVerifiedIdentity} from './worker.mjs';

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
  const DB={prepare:statement=>({bind:(...args)=>({first:async()=>sql.prepare(statement).get(...args),run:async()=>({meta:sql.prepare(statement).run(...args)}),all:async()=>({results:sql.prepare(statement).all(...args)})})})};
  const tokens=['a'.repeat(64),'b'.repeat(64)];
  for(const [i,token] of tokens.entries()){
    const sub='user'+i;sql.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(sub,sub+'@gmail.com','organizer','approved',Date.now());
    const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest,sub,Date.now()+60000);
  }
  const request=(i,path,method='GET',body)=>handle(new Request('https://example.com/api/'+path,{method,headers:{Cookie:'__Host-cricboard='+tokens[i],Origin:'https://example.com','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{DB});
  const data={tournaments:[{id:'t',name:'Private league'}],teams:[],matches:[],activeTournamentId:'t',activeMatchId:null};
  assert.equal((await request(0,'snapshot','PUT',{revision:null,data})).status,200);
  assert.equal((await (await request(1,'snapshot')).json()).data,null);
  assert.equal((await request(0,'snapshot','PUT',{revision:null,data})).status,409);
  assert.equal((await request(1,'accounts')).status,404);
  assert.deepEqual((await (await request(0,'snapshot')).json()).data,data);
});
