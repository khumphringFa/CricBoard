// Private Google Drive snapshots. Every write creates a new file: concurrent
// devices can branch, but can never overwrite one another's score records.
import { recalc, finishResult, deliveryInfo, wicketLimit, validatePlayerMatch } from './engine.mjs';

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const MAX_BYTES = 10 * 1024 * 1024;
const APP = 'CricBoard';
const MARKER = 'cricboard-backup-v1';
const fail = () => { throw new Error('Invalid CricBoard backup. No scores were replaced.'); };
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const text = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;

export function validateStore(input) {
  // Validate before this data can reach scoring, standings, or localStorage.
  const raw = JSON.stringify(input);
  if (!raw || new TextEncoder().encode(raw).length > MAX_BYTES) fail();
  const data = JSON.parse(raw, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail();
    return value;
  });
  if (!data || !Array.isArray(data.tournaments) || !data.tournaments.length ||
      !Array.isArray(data.teams) || !Array.isArray(data.matches)) fail();
  const unique = values => {
    const ids = new Set();
    for (const value of values) { if (!value || !id(value.id) || ids.has(value.id)) fail(); ids.add(value.id); }
    return ids;
  };
  const tournaments = unique(data.tournaments), teams = unique(data.teams), matches = unique(data.matches);
  if (!tournaments.has(data.activeTournamentId) || (data.activeMatchId !== null && !matches.has(data.activeMatchId))) fail();
  for (const t of data.tournaments) if (!text(t.name, 64)) fail();
  for (const t of data.teams) if (!text(t.name, 45) || !tournaments.has(t.tournamentId)) fail();
  if (data.players !== undefined) {
    if (!Array.isArray(data.players)) fail(); unique(data.players);
    for (const p of data.players) if (!text(p.name, 60) || !teams.has(p.teamId) ||
      !data.teams.some(t => t.id === p.teamId && t.tournamentId === p.tournamentId)) fail();
  }
  for(const p of data.players||[]){
    const profile=p.profile;if(profile===undefined)continue;
    if(!profile||typeof profile!=="object"||Array.isArray(profile))fail();
    const allowed={role:["","Batter","Bowler","All-rounder","Wicketkeeper","Wicketkeeper-batter"],batting:["","Right-handed","Left-handed"],bowling:["","Right-arm pace","Left-arm pace","Right-arm medium","Left-arm medium","Off spin","Leg spin","Left-arm orthodox","Left-arm wrist spin"]};
    for(const [key,values]of Object.entries(allowed))if(profile[key]!==undefined&&!values.includes(profile[key]))fail();
    if(profile.jersey!==undefined&&(typeof profile.jersey!=="string"||!/^([0-9]{1,3})?$/.test(profile.jersey)))fail();
    if(profile.bio!==undefined&&(typeof profile.bio!=="string"||profile.bio.length>240))fail();
  }
  const teamById = new Map(data.teams.map(t => [t.id, t]));
  for (const m of data.matches) {
    if (!tournaments.has(m.tournamentId) || !teams.has(m.teamA) || !teams.has(m.teamB) || m.teamA === m.teamB ||
        teamById.get(m.teamA).tournamentId !== m.tournamentId || teamById.get(m.teamB).tournamentId !== m.tournamentId ||
        ![m.teamA, m.teamB].includes(m.battingFirst) || !Number.isInteger(m.overs) || m.overs < 1 || m.overs > 50 ||
        typeof m.label !== 'string' || m.label.length > 80 || !['scheduled', 'live', 'break', 'completed'].includes(m.status) ||
        !Array.isArray(m.innings) || m.innings.length > 2 || !Number.isFinite(Date.parse(m.updatedAt))) fail();
    if ((m.status === 'scheduled' && m.innings.length !== 0) || (m.status !== 'scheduled' && !m.innings.length) ||
        (m.status === 'break' && m.innings.length !== 1) || (m.status === 'completed' && m.innings.length !== 2)) fail();
    for (const [index, inn] of m.innings.entries()) {
      if (!inn || ![m.teamA, m.teamB].includes(inn.batting) || ![m.teamA, m.teamB].includes(inn.bowling) ||
          inn.batting === inn.bowling || (index === 0 && inn.batting !== m.battingFirst) ||
          (index === 1 && inn.batting === m.innings[0].batting) || !Array.isArray(inn.deliveries) ||
          !count(inn.runs) || !count(inn.balls) || !count(inn.wickets) || inn.balls > m.overs * 6 || inn.wickets > 10) fail();
      let computed;
      try { computed = recalc({ deliveries: inn.deliveries }); } catch { fail(); }
      if (computed.runs !== inn.runs || computed.balls !== inn.balls || computed.wickets !== inn.wickets ||
          !inn.extras || Object.keys(computed.extras).some(k => computed.extras[k] !== inn.extras[k])) fail();
      let balls = 0, wickets = 0, runs = 0;
      for (const d of inn.deliveries) {
        if (balls >= m.overs * 6 || wickets >= 10 || (index === 1 && runs > m.innings[0].runs)) fail();
        const info = deliveryInfo(d);
        balls += info.legal ? 1 : 0;
        wickets += info.wicket ? 1 : 0;
        runs += info.total;
      }
    }
    if (m.playerMode) {
      try {
        validatePlayerMatch(m);
        for (const inn of m.innings) if (inn.wickets > wicketLimit(m, inn.batting)) fail();
      } catch { fail(); }
    }
    if (m.status === 'completed') {
      const result = finishResult(m);
      if (!m.result || m.result.winner !== result.winner || m.result.margin !== result.margin) fail();
    }
  }
  return data;
}

export async function fingerprint(data) {
  // Sort object keys so property order does not create a false conflict.
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(data))));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}

export function backupHeads(files) {
  const parents = new Set(files.flatMap(f => f.parents));
  return files.filter(f => !parents.has(f.revision));
}

export function syncPlan(localHash, base, heads, pristine = false) {
  if (!heads.length) return 'upload';
  if (heads.length > 1) return 'conflict';
  const remote = heads[0];
  if (remote.hash === localHash) return 'equal';
  if (base?.revision === remote.revision) return 'upload';
  if ((base?.hash && base.hash === localHash) || pristine) return 'download';
  return 'conflict';
}

function parseMetadata(file) {
  let info;
  try { info = JSON.parse(file.description); } catch { fail(); }
  if (!id(info.revision) || !Array.isArray(info.parents) || !info.parents.every(id) ||
      !/^[a-f0-9]{64}$/.test(info.hash) || !Number.isFinite(Date.parse(info.savedAt))) fail();
  return { ...info, id: file.id, name: file.name };
}

export class DriveSnapshots {
  constructor(token, request = (url, options) => fetch(url, options)) { this.token = token; this.request = request; }
  async api(url, options = {}) {
    const response = await this.request(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + this.token }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google session expired. Connect Google again; local scores are safe.');
      if (response.status === 403) throw new Error('Google Drive access was denied. Enable the Drive API and allow CricBoard backup access.');
      if (response.status === 429 || response.status >= 500) throw new Error('Google Drive is busy. Try again later; local scores are safe.');
      throw new Error('Google Drive request failed (' + response.status + '). Local scores are safe.');
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).length > MAX_BYTES + 65536) fail();
    return JSON.parse(body);
  }
  async list() {
    let pageToken = '', files = [];
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000',
        q: "trashed = false and appProperties has { key='application' and value='" + MARKER + "' }",
        fields: 'nextPageToken,files(id,name,description)', ...(pageToken ? { pageToken } : {}) });
      const page = await this.api('https://www.googleapis.com/drive/v3/files?' + params);
      files.push(...page.files.map(parseMetadata));
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return files.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async download(file) {
    if (!id(file.id)) fail();
    const backup = await this.api('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
    const data = readBackup(backup);
    if (backup.revision !== file.revision || await fingerprint(data) !== file.hash) fail();
    return data;
  }
  async upload(input, parents) {
    const data = validateStore(input), hash = await fingerprint(data);
    const info = { revision: crypto.randomUUID(), parents: [...new Set(parents)], hash, savedAt: new Date().toISOString() };
    const backup = { app: APP, version: 1, ...info, data };
    const boundary = 'cb_' + crypto.randomUUID();
    const metadata = { name: 'CricBoard-' + info.savedAt.replace(/[:.]/g, '-') + '.json', mimeType: 'application/json',
      parents: ['appDataFolder'], appProperties: { application: MARKER }, description: JSON.stringify(info) };
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(backup) + '\r\n--' + boundary + '--';
    const result = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    return { ...info, id: result.id, name: metadata.name };
  }
}

export function readBackup(value) {
  if (!value || value.app !== APP || value.version !== 1) fail();
  return validateStore(value.data);
}

export function initCloud({ getStore, replaceStore, storage = localStorage, expectedSub = null }) {
  const $ = id => document.getElementById(id);
  const clientKey = 'cricboard-google-client-id';
  const recoveryKey = 'cricboard-recovery-v1';
  const autoKey = 'cricboard-google-auto';
  let drive = null, account = null, expires = 0, files = [], busy = false, timer, epoch = 0;
  let pending = false;
  const native=window.CricNative;let renewing=false;
  const read = key => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => storage.setItem(key, value);
  const message = value => { $('cloudStatus').textContent = value; };
  const baseKey = () => 'cricboard-google-base:' + account.sub;
  const base = () => { try { return JSON.parse(read(baseKey())); } catch { return null; } };
  const remember = file => write(baseKey(), JSON.stringify({ revision: file.revision, hash: file.hash }));
  const auto = () => $('cloudAuto').checked;
  const active = () => Boolean(drive && account && Date.now() < expires);
  const pristine = data => !data.teams.length && !data.matches.length && data.tournaments.length === 1 && data.tournaments[0].name === 'My Local Tournament';
  function controls() {
    for (const name of ['cloudBackup', 'cloudSync', 'cloudRefresh', 'cloudRestore']) $(name).disabled = busy || !active();
    $('cloudRestore').disabled ||= !files.length;
    $('cloudConnect').disabled = busy;
    $('cloudDisconnect').disabled = busy || !drive;
    $('cloudVersions').disabled = busy || !files.length;
    $('cloudImport').disabled = busy;
    $('cloudRecovery').disabled = !read(recoveryKey);
  }
  function versions() {
    const selected = $('cloudVersions').value;
    const heads = new Set(backupHeads(files).map(f => f.revision));
    $('cloudVersions').replaceChildren();
    for (const file of files) $('cloudVersions').add(new Option(new Date(file.savedAt).toLocaleString() + (heads.has(file.revision) ? ' • Current version' : ' • Earlier backup'), file.id));
    if (files.some(f => f.id === selected)) $('cloudVersions').value = selected;
    controls();
  }
  function checkpoint() {
    // Abort restore if recovery cannot be persisted (for example, storage full).
    write(recoveryKey, JSON.stringify({ app: APP, version: 1, savedAt: new Date().toISOString(), data: validateStore(getStore()) }));
    controls();
  }
  async function useDownloaded(data, expectedHash) {
    if (await fingerprint(getStore()) !== expectedHash) throw new Error('Scores changed during download. Try Sync again when scoring is paused.');
    checkpoint();
    replaceStore(data);
  }
  async function run(operation) {
    if (busy) { pending = true; return; }
    busy = true; controls();
    try { await operation(); }
    catch (error) { message(error.name === 'TimeoutError' ? 'Google Drive timed out. Local scores are safe; retry later.' : error.message); }
    finally {
      busy = false; controls();
      if (pending) { pending = false; changed(); }
    }
  }
  function requireConnection() {
    if (!active()) throw new Error('Connect Google to continue. Sign-in is needed again after a page reload or session expiry.');
    if (!navigator.onLine) throw new Error('Offline: scores remain saved on this device. Sync when internet returns.');
  }
  async function refresh() { requireConnection(); files = await drive.list(); versions(); return backupHeads(files); }
  async function synchronize(forceLocal = false) {
    requireConnection();
    message('Checking Google Drive…');
    const heads = await refresh();
    const data = validateStore(getStore()), hash = await fingerprint(data);
    const plan = syncPlan(hash, base(), heads, pristine(data));
    if (forceLocal && heads.length && plan !== 'equal') {
      if (!confirm('Make this device’s scores the current cloud version? Other device edits will remain in earlier backups. Use only one scoring device at a time.')) return message('Backup cancelled. No scores changed.');
    } else if (plan === 'conflict') {
      return message('Different versions found. Pause scoring, then choose Restore selected backup or Backup this device. Earlier backups are preserved.');
    }
    if (plan === 'equal') { remember(heads[0]); return message('Up to date with Google Drive.'); }
    if (plan === 'download' && !forceLocal) {
      const downloaded = await drive.download(heads[0]);
      await useDownloaded(downloaded, hash); remember(heads[0]);
      return message('Synced from Google Drive. Previous device data is available under Download recovery copy.');
    }
    const file = await drive.upload(data, heads.map(h => h.revision));
    remember(file); files.unshift(file); versions();
    // Recheck immutable heads: another device may have written during upload.
    const after = await refresh();
    message(after.length > 1 ? 'Backup saved, but another device also changed scores. Choose a version before continuing sync.' : 'Backup saved to Google Drive at ' + new Date(file.savedAt).toLocaleTimeString() + '.');
    if (await fingerprint(getStore()) !== hash) { pending = true; message('Backup saved. Newer local edits are waiting for the next sync.'); }
  }
  async function restore() {
    requireConnection();
    const file = files.find(f => f.id === $('cloudVersions').value);
    if (!file) return;
    const hash = await fingerprint(getStore());
    const data = await drive.download(file);
    if (!confirm('Restore ' + new Date(file.savedAt).toLocaleString() + '? This replaces device data with ' + data.tournaments.length + ' tournament(s), ' + data.teams.length + ' team(s), and ' + data.matches.length + ' match(es). A recovery copy of current device data will be kept.')) return;
    await useDownloaded(data, hash); remember(file);
    $('cloudAuto').checked = false; write(autoKey, '0'); clearTimeout(timer);
    message('Restored on this device. Auto sync paused. Use Backup this device to make these scores the current cloud version.');
  }
  function changed() {
    clearTimeout(timer);
    if (!auto()) return;
    if (!active()) {if(native&&navigator.onLine)connectNative(false);return message('Scores saved on this device. Google authorization is needed to resume backup.');}
    if (!navigator.onLine) return message('Offline: scores saved on this device. Automatic sync will retry when connected.');
    message('Local changes saved. Google sync pending…');
    timer = setTimeout(() => run(() => synchronize()), 15000);
  }
  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function disconnect() {
    epoch++; drive = null; account = null; expires = 0; files = []; clearTimeout(timer);
    $('cloudAccount').textContent = 'Not connected'; versions();
    message('Disconnected on this device. Local scores and existing Google Drive backups are kept.'); controls();
  }
  const clientId = () => (read(clientKey) || document.querySelector('meta[name="google-client-id"]')?.content || '').trim();
  $('googleClientId').value = clientId();
  $('cloudAuto').checked = read(autoKey) === '1';
  $('cloudSaveClient').onclick = () => {
    const value = $('googleClientId').value.trim();
    if (!/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) return message('Enter a Web application OAuth client ID ending in .apps.googleusercontent.com. Never enter a client secret.');
    if (drive) disconnect();
    try { write(clientKey, value); message('Google setup saved for this browser. Select Connect Google.'); }
    catch { message('Browser settings could not be saved. Allow local storage and try again.'); }
  };
  // Loaded only on the scoring page; spectator pages never initialize Google.
  if(!native){const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
  script.onerror = () => message('Google sign-in could not load. Check internet access; local scoring still works.');
  document.head.append(script);}
  async function connectNative(interactive){
    if(!native||renewing||busy)return;
    renewing=true;const session=++epoch;
    try{const token=await native.drive(interactive,window.cricboardAccount.email);if(!token||session!==epoch)return;
      await run(async()=>{const candidate=new DriveSnapshots(token);const profile=await candidate.api('https://www.googleapis.com/oauth2/v3/userinfo');
        if(profile.sub!==expectedSub)throw Error('Authorize the same Google account used for CricBoard.');
        if(session!==epoch)return;drive=candidate;account=profile;expires=Date.now()+45*60000;
        $('cloudAccount').textContent=profile.email;
        if(interactive){$('cloudAuto').checked=true;write(autoKey,'1');}
        await refresh();if(auto())await synchronize();
      });
    }catch(e){message(e.message+' Local scores remain safe.');}finally{renewing=false;controls();}
  }
  $('cloudConnect').onclick = () => {
    if(native){connectNative(true);return;}
    if (!clientId()) { $('cloudSetup').open = true; return message('One-time setup required: enter your Google OAuth Web client ID below.'); }
    if (!window.google?.accounts?.oauth2) return message('Google sign-in is still loading or blocked. Check your connection and try again.');
    const session = ++epoch;
    busy = true; controls(); message('Complete Google sign-in in the popup…');
    const oauth = window.google.accounts.oauth2;
    const client = oauth.initTokenClient({ client_id: clientId(), scope: 'openid email profile ' + SCOPE,
      include_granted_scopes: false,
      callback: async response => {
        if (session !== epoch) return;
        busy = false;
        if (response.error || !oauth.hasGrantedAllScopes(response, SCOPE, 'openid', 'email')) { controls(); return message('Google access was not granted. Local scores are safe.'); }
        await run(async () => {
          const candidate = new DriveSnapshots(response.access_token);
          const profile = await candidate.api('https://www.googleapis.com/oauth2/v3/userinfo');
          if (!profile.sub || !profile.email) throw new Error('Could not identify the Google account. Try connecting again.');
          if (expectedSub && profile.sub !== expectedSub) throw new Error('Connect the same Google account used to sign in to CricBoard.');
          if (session !== epoch) return;
          drive = candidate; account = profile; expires = Date.now() + Math.max(0, Number(response.expires_in) - 60) * 1000;
          // An account switch must not silently copy the previous account's data.
          $('cloudAuto').checked = false; write(autoKey, '0'); clearTimeout(timer);
          $('cloudAccount').textContent = profile.email;
          await refresh();
          message('Connected. Select Sync now to compare device and cloud data, or restore an earlier backup. Enable automatic sync after checking the account.');
          // Connecting to a different account never uploads data automatically.
        });
      }, error_callback: () => { if (session === epoch) { busy = false; controls(); message('Google popup closed or blocked. Select Connect Google to try again.'); } }
    });
    try { client.requestAccessToken({ prompt: 'select_account' }); }
    catch { busy = false; controls(); message('Google sign-in could not start. Try again.'); }
  };
  $('cloudDisconnect').onclick = ()=>{if(native){$('cloudAuto').checked=false;write(autoKey,'0');}disconnect();};
  $('cloudBackup').onclick = () => run(() => synchronize(true));
  $('cloudSync').onclick = () => run(() => synchronize());
  $('cloudRefresh').onclick = () => run(async () => { await refresh(); message(files.length + ' backup version(s) available.'); });
  $('cloudRestore').onclick = () => run(restore);
  $('cloudAuto').onchange = () => {
    try { write(autoKey, auto() ? '1' : '0'); }
    catch { $('cloudAuto').checked = false; return message('Could not save automatic sync preference.'); }
    if (auto()) changed(); else { clearTimeout(timer); message('Automatic sync paused. Local scoring still saves on this device.'); }
  };
  $('cloudExport').onclick = () => run(async () => download({ app: APP, version: 1, savedAt: new Date().toISOString(), data: validateStore(getStore()) }, 'CricBoard-backup.json'));
  $('cloudRecovery').onclick = () => run(async () => {
    const recovery = JSON.parse(read(recoveryKey)); readBackup(recovery); download(recovery, 'CricBoard-recovery.json');
  });
  $('cloudImport').onchange = event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    run(async () => {
      if (file.size > MAX_BYTES) fail();
      const hash = await fingerprint(getStore());
      const data = readBackup(JSON.parse(await file.text()));
      if (!confirm('Replace device scores with this backup? A recovery copy of current device data will be saved first.')) return;
      await useDownloaded(data, hash); $('cloudAuto').checked = false; write(autoKey, '0'); clearTimeout(timer);
      message('File restored. Google auto sync paused so you can review the scores first.');
    });
  };
  window.addEventListener('online', changed);
  window.addEventListener('offline', () => { if (auto()) message('Offline: keep scoring. Changes are saved on this device.'); });
  // Poll while connected; token renewal is always a user-initiated Google popup.
  setInterval(() => { controls(); if (auto() && navigator.onLine && !busy) {if(active())run(() => synchronize());else if(native)connectNative(false);} }, 60000);
  if(native&&auto()&&navigator.onLine)connectNative(false);
  controls();
  message(clientId() ? 'Local scores are saved. Connect Google for private backup and restore.' : 'Google backup needs one-time setup. Download a backup file anytime.');
  return { changed };
}
