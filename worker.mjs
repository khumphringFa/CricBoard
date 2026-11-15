import { validateStore } from './cloud.mjs';
import { publicTournament } from './public-data.mjs';
import { centralStore, centralSummary } from './central-data.mjs';

const CLIENT = '342863663518-8raaefvf2qt3skk5jfbego0vfob8441f.apps.googleusercontent.com';
// Bootstrap identity fingerprint, not a credential; verified Google email is required.
const ADMIN_HASH = '56913b4e1547dec8ef2087ea8225b721e9412ac91f8c8feed8fa7b2ae581a4f8';
const schema = [
  "CREATE TABLE IF NOT EXISTS accounts (sub TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','organizer')), status TEXT NOT NULL CHECK(status IN ('pending','approved','suspended')), created_at INTEGER NOT NULL)",
  'CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL REFERENCES accounts(sub), expires INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires)',
  'CREATE TABLE IF NOT EXISTS snapshots (sub TEXT PRIMARY KEY REFERENCES accounts(sub), revision TEXT NOT NULL, data TEXT NOT NULL)'
];
const json = (value, status=200, headers={}) => Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
const decode = text => Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const parse = text => JSON.parse(new TextDecoder().decode(decode(text)));
const hash = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
// Gmail ignores dots in consumer Gmail addresses, not custom Workspace domains.
export function canonicalEmail(email) {
  const normalized=email.toLowerCase();
  const [local,domain]=normalized.split('@');
  return domain==='gmail.com' ? `${local.replace(/\./g,'')}@gmail.com` : normalized;
}
// Call only after validating Google's signed identity token.
export async function registerVerifiedIdentity(db, identity, adminHash=ADMIN_HASH) {
  const admin=await hash(canonicalEmail(identity.email))===adminHash || await hash(identity.email)===adminHash;
  await db.batch(schema.map(sql=>db.prepare(sql)));
  await db.prepare(`INSERT INTO accounts(sub,email,role,status,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(sub) DO UPDATE SET email=excluded.email,
    role=CASE WHEN excluded.role='admin' THEN 'admin' ELSE accounts.role END,
    status=CASE WHEN excluded.role='admin' THEN 'approved' ELSE accounts.status END`)
    .bind(identity.sub,identity.email,admin?'admin':'organizer',admin?'approved':'pending',Date.now()).run();
  return db.prepare('SELECT sub,email,role,status FROM accounts WHERE sub=?').bind(identity.sub).first();
}
const cookie = (token, age) => `__Host-cricboard=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const sessionToken = req => /(?:^|;\s*)__Host-cricboard=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('Cookie')||'')?.[1];
const publicSchema = 'CREATE TABLE IF NOT EXISTS published_tournaments (slug TEXT PRIMARY KEY, sub TEXT NOT NULL REFERENCES accounts(sub), tournament_id TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, UNIQUE(sub,tournament_id))';
const centralSchema = 'CREATE TABLE IF NOT EXISTS central_records (sub TEXT PRIMARY KEY REFERENCES accounts(sub), revision TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL, summary TEXT NOT NULL)';

export async function verifyGoogle(token, fetcher=fetch, now=Date.now()) {
  if(typeof token!=='string'||token.length>10000) throw Error('Invalid Google credential');
  const parts=token.split('.'); if(parts.length!==3) throw Error('Invalid Google credential');
  const [h,p,s]=parts, header=parse(h), claims=parse(p);
  if(header.alg!=='RS256'||typeof header.kid!=='string') throw Error('Invalid signature algorithm');
  const response=await fetcher('https://www.googleapis.com/oauth2/v3/certs');
  if(!response.ok) throw Error('Google verification unavailable');
  const key=(await response.json()).keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
  if(!key) throw Error('Unknown signing key');
  const publicKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decode(s),new TextEncoder().encode(h+'.'+p))) throw Error('Invalid signature');
  if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==CLIENT||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!Number.isFinite(claims.iat)||claims.iat*1000>now+60000||claims.email_verified!==true||typeof claims.email!=='string'||typeof claims.sub!=='string'||!claims.sub) throw Error('Invalid identity claims');
  return {sub:claims.sub,email:claims.email.toLowerCase()};
}

export async function handle(request,env) {
  const url=new URL(request.url), path=url.pathname, db=env.DB;
  if(!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if(!db) return json({error:'Account service is not configured'},503);
  if(request.method!=='GET' && request.headers.get('Origin')!==url.origin) return json({error:'Invalid origin'},403);
  try {
    if(path==='/api/public'&&request.method==='GET') {
      const q=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='published_tournaments'").first();
      if(!q) return json([]);
      const offset=Math.min(10000,Math.max(0,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));
      const rows=(await db.prepare("SELECT p.slug,p.name,p.updated_at,p.data FROM published_tournaments p JOIN accounts a ON a.sub=p.sub WHERE p.visible=1 AND a.status='approved' ORDER BY p.updated_at DESC LIMIT 24 OFFSET ?").bind(offset).all()).results;
      return json(rows.map(r=>{const d=JSON.parse(r.data);return {slug:r.slug,name:r.name,updatedAt:r.updated_at,teams:d.teams.length,live:d.matches.filter(m=>m.status==='live'||m.status==='break').length,scheduled:d.matches.filter(m=>m.status==='scheduled').length,completed:d.matches.filter(m=>m.status==='completed').length};}));
    }
    if(path.startsWith('/api/public/')&&request.method==='GET') {
      const slug=path.split('/').at(-1);if(!/^[a-f0-9-]{36}$/.test(slug))return json({error:'Tournament not found'},404);
      const q=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='published_tournaments'").first();
      if(!q)return json({error:'Tournament not found'},404);
      const row=await db.prepare("SELECT p.slug,p.updated_at,p.data FROM published_tournaments p JOIN accounts a ON a.sub=p.sub WHERE p.slug=? AND p.visible=1 AND a.status='approved'").bind(slug).first();
      return row?json({slug:row.slug,updatedAt:row.updated_at,...JSON.parse(row.data)}):json({error:'Tournament not found'},404);
    }
    if(path==='/api/login'&&request.method==='POST') {
      let identity; try {identity=await verifyGoogle((await request.json()).credential);} catch {return json({error:'Google identity could not be verified'},401);}
      const account=await registerVerifiedIdentity(db,identity,env.ADMIN_EMAIL_HASH||ADMIN_HASH);
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
      await db.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()).run();
      await db.prepare('INSERT INTO sessions(hash,sub,expires) VALUES(?,?,?)').bind(await hash(token),identity.sub,Date.now()+86400000).run();
      return json(account,200,{'Set-Cookie':cookie(token,86400)});
    }
    const token=sessionToken(request);
    if(!token) return json({error:'Sign in required'},401);
    const hashed=await hash(token);
    if(path==='/api/logout'&&request.method==='POST') { await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hashed).run(); return json({ok:true},200,{'Set-Cookie':cookie('',0)}); }
    const account=await db.prepare('SELECT a.sub,a.email,a.role,a.status FROM sessions s JOIN accounts a ON a.sub=s.sub WHERE s.hash=? AND s.expires>?').bind(hashed,Date.now()).first();
    if(!account) return json({error:'Sign in required'},401);
    if(path==='/api/me'&&request.method==='GET') return json(account);
    if(account.status!=='approved') return json({error:'Administrator approval required'},403);
    if(path==='/api/central'){
      await db.prepare(centralSchema).run();
      if(request.method==='GET'){
        const row=await db.prepare('SELECT revision,enabled,updated_at,data FROM central_records WHERE sub=?').bind(account.sub).first();
        return json(row?{revision:row.revision,enabled:Boolean(row.enabled),updatedAt:row.updated_at,data:JSON.parse(row.data)}:{revision:null,enabled:false,updatedAt:null,data:null});
      }
      if(request.method==='DELETE'){
        await db.prepare('UPDATE central_records SET enabled=0,revision=? WHERE sub=?').bind(crypto.randomUUID(),account.sub).run();return json({ok:true});
      }
      if(request.method==='POST'||request.method==='PUT'){
        const raw=await request.text();if(new TextEncoder().encode(raw).length>900000)return json({error:'Central copy too large; retain your Drive backup'},413);
        let payload,data;try{payload=JSON.parse(raw);data=centralStore(payload.data);}catch{return json({error:'Invalid tournament records'},400);}
        if(request.method==='POST'&&payload.consent!==true)return json({error:'Explicit central sharing consent required'},400);
        const rev=crypto.randomUUID(),now=Date.now(),serialized=JSON.stringify(data),summary=JSON.stringify(centralSummary(data));
        if(new TextEncoder().encode(serialized+summary).length>930000)return json({error:'Central copy too large'},413);
        const result=request.method==='POST'&&payload.revision===null?await db.prepare('INSERT OR IGNORE INTO central_records(sub,revision,enabled,updated_at,data,summary) VALUES(?,?,1,?,?,?)').bind(account.sub,rev,now,serialized,summary).run():await db.prepare('UPDATE central_records SET revision=?,enabled=1,updated_at=?,data=?,summary=? WHERE sub=? AND revision=? AND (enabled=1 OR ?=1)').bind(rev,now,serialized,summary,account.sub,payload.revision,request.method==='POST'?1:0).run();
        if(!result.meta.changes)return json({error:'Central copy changed or sharing was disabled. Refresh and reconcile before syncing.'},409);
        return json({revision:rev,enabled:true,updatedAt:now});
      }
    }
    if(path==='/api/central-admin'&&request.method==='GET'&&account.role==='admin'){
      await db.prepare(centralSchema).run();
      const offset=Math.min(100000,Math.max(0,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));
      const rows=(await db.prepare('SELECT a.sub,a.email,a.status,c.updated_at,c.summary FROM accounts a LEFT JOIN central_records c ON c.sub=a.sub AND c.enabled=1 WHERE a.status=\'approved\' ORDER BY a.sub LIMIT 50 OFFSET ?').bind(offset).all()).results;
      return json(rows.map(r=>({sub:r.sub,email:r.email,updatedAt:r.updated_at??null,summary:r.summary?JSON.parse(r.summary):null})));
    }
    if(path.startsWith('/api/central-admin/')&&request.method==='GET'&&account.role==='admin'){
      await db.prepare(centralSchema).run();
      const sub=decodeURIComponent(path.slice('/api/central-admin/'.length));
      const row=await db.prepare("SELECT a.email,c.updated_at,c.data FROM central_records c JOIN accounts a ON a.sub=c.sub WHERE c.sub=? AND c.enabled=1 AND a.status='approved'").bind(sub).first();
      return row?json({email:row.email,updatedAt:row.updated_at,data:JSON.parse(row.data)}):json({error:'No shared records available'},404);
    }
    if(path==='/api/publications') {
      await db.prepare(publicSchema).run();
      if(request.method==='GET')return json((await db.prepare('SELECT slug,tournament_id,visible,updated_at FROM published_tournaments WHERE sub=?').bind(account.sub).all()).results);
      if(request.method==='POST'||request.method==='PUT'){
        const raw=await request.text();if(new TextEncoder().encode(raw).length>900000)return json({error:'Tournament too large to publish'},413);
        let payload,view;try{payload=JSON.parse(raw);view=publicTournament(payload.data,payload.includePlayers===true);}catch{return json({error:'Invalid tournament data'},400);}
        const tournamentId=payload.data.tournaments[0].id, serialized=JSON.stringify(view);if(new TextEncoder().encode(serialized).length>900000)return json({error:'Public scorecards too large'},413);
        if(request.method==='PUT'){
          const result=await db.prepare('UPDATE published_tournaments SET name=?,data=?,updated_at=? WHERE sub=? AND tournament_id=? AND visible=1 AND updated_at=?').bind(view.name,serialized,Math.max(Date.now(),Number(payload.updatedAt)+1),account.sub,tournamentId,payload.updatedAt).run();
          if(!result.meta.changes)return json({error:'Publication changed or was unpublished. Publish again explicitly.'},409);
        }else await db.prepare('INSERT INTO published_tournaments(slug,sub,tournament_id,name,data,visible,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(sub,tournament_id) DO UPDATE SET name=excluded.name,data=excluded.data,visible=1,updated_at=excluded.updated_at').bind(crypto.randomUUID(),account.sub,tournamentId,view.name,serialized,Date.now()).run();
        return json(await db.prepare('SELECT slug,visible,updated_at FROM published_tournaments WHERE sub=? AND tournament_id=?').bind(account.sub,tournamentId).first());
      }
      if(request.method==='DELETE'){
        const {tournamentId}=await request.json();if(typeof tournamentId!=='string')return json({error:'Invalid tournament'},400);
        await db.prepare('UPDATE published_tournaments SET visible=0 WHERE sub=? AND tournament_id=?').bind(account.sub,tournamentId).run();return json({ok:true});
      }
    }
    if(path==='/api/accounts'&&request.method==='GET'&&account.role==='admin') return json((await db.prepare('SELECT sub,email,role,status FROM accounts ORDER BY created_at').all()).results);
    if(path==='/api/accounts'&&request.method==='POST'&&account.role==='admin') {
      const {sub,status}=await request.json();
      if(typeof sub!=='string'||!['approved','suspended','pending'].includes(status)||sub===account.sub) return json({error:'Invalid account change'},400);
      await db.prepare("UPDATE accounts SET status=? WHERE sub=? AND role!='admin'").bind(status,sub).run(); return json({ok:true});
    }
    if(path==='/api/snapshot'&&request.method==='GET') {
      const row=await db.prepare('SELECT revision,data FROM snapshots WHERE sub=?').bind(account.sub).first();
      return json(row?{revision:row.revision,data:JSON.parse(row.data)}:{revision:null,data:null});
    }
    if(path==='/api/snapshot'&&request.method==='PUT') {
      const raw=await request.text(); if(new TextEncoder().encode(raw).length>900000) return json({error:'Snapshot too large; use Drive backup'},413);
      const {revision,data}=JSON.parse(raw); let checked; try{checked=validateStore(data);}catch{return json({error:'Invalid scores'},400);}
      const next=crypto.randomUUID();
      const result=revision===null?await db.prepare('INSERT OR IGNORE INTO snapshots(sub,revision,data) VALUES(?,?,?)').bind(account.sub,next,JSON.stringify(checked)).run():await db.prepare('UPDATE snapshots SET revision=?,data=? WHERE sub=? AND revision=?').bind(next,JSON.stringify(checked),account.sub,revision).run();
      if(!result.meta.changes) return json({error:'Cloud copy changed; download or reconcile before uploading'},409);
      return json({revision:next});
    }
    return json({error:'Not found or not authorized'},404);
  } catch {return json({error:'Account service temporarily unavailable'},503);}
}
export default {fetch:handle};
