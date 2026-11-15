import { validateStore } from './cloud.mjs';

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
const cookie = (token, age) => `__Host-cricboard=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const sessionToken = req => /(?:^|;\s*)__Host-cricboard=([a-f0-9]{64})(?:;|$)/.exec(req.headers.get('Cookie')||'')?.[1];

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
    if(path==='/api/login'&&request.method==='POST') {
      let identity; try {identity=await verifyGoogle((await request.json()).credential);} catch {return json({error:'Google identity could not be verified'},401);}
      const admin=await hash(identity.email)===(env.ADMIN_EMAIL_HASH||ADMIN_HASH);
      await db.batch(schema.map(sql=>db.prepare(sql)));
      await db.prepare('INSERT INTO accounts(sub,email,role,status,created_at) VALUES(?,?,?,?,?) ON CONFLICT(sub) DO UPDATE SET email=excluded.email').bind(identity.sub,identity.email,admin?'admin':'organizer',admin?'approved':'pending',Date.now()).run();
      const account=await db.prepare('SELECT sub,email,role,status FROM accounts WHERE sub=?').bind(identity.sub).first();
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
