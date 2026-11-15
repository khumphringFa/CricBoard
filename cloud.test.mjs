import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startMatch, applyDelivery, endInnings, advanceInnings } from './engine.mjs';
import { validateStore, fingerprint, backupHeads, syncPlan, DriveSnapshots, readBackup, initCloud, SCOPE } from './cloud.mjs';

function sample() {
  const m = startMatch(createMatch({ tournamentId: 'cup', teamA: 'a', teamB: 'b', battingFirst: 'a', overs: 2 }));
  return { tournaments: [{ id: 'cup', name: 'Hill Cup' }], teams: [{ id: 'a', name: 'A', tournamentId: 'cup' }, { id: 'b', name: 'B', tournamentId: 'cup' }], matches: [applyDelivery(m, { kind: 'bat', runs: 4 })], activeTournamentId: 'cup', activeMatchId: m.id };
}
function mockDrive() {
  const files = new Map(), calls = [];
  let sequence = 0;
  const request = async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (url.includes('/userinfo')) return new Response(JSON.stringify({ sub: 'google-1', email: 'scorer@example.com' }));
    if (options.method === 'POST') {
      const parts = options.body.split('\r\n\r\n');
      const metadata = JSON.parse(parts[1].split('\r\n--')[0]);
      const body = JSON.parse(parts[2].split('\r\n--')[0]);
      const fileId = 'file-' + (++sequence);
      files.set(fileId, { id: fileId, ...metadata, body });
      return new Response(JSON.stringify({ id: fileId }));
    }
    if (parsed.searchParams.get('alt') === 'media') {
      const file = files.get(parsed.pathname.split('/').pop());
      return file ? new Response(JSON.stringify(file.body)) : new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify({ files: [...files.values()].map(({ body, ...metadata }) => metadata) }));
  };
  return { api: new DriveSnapshots('memory-only-token', request), files, calls, request };
}

test('round trip retains deliveries, extras, completed result and points inputs', async () => {
  const data = sample();
  let m = applyDelivery(data.matches[0], { kind: 'wide', runs: 1 });
  m = endInnings(m); m = advanceInnings(m); m = applyDelivery(m, { kind: 'bat', runs: 6 }); m = applyDelivery(m, { kind: 'bat', runs: 1 });
  data.matches[0] = m;
  const { api, calls } = mockDrive();
  const file = await api.upload(data, []);
  const listed = await api.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].revision, file.revision);
  assert.deepEqual(await api.download(listed[0]), data);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer memory-only-token');
  assert.match(calls[0].options.body, /appDataFolder/);
  assert.doesNotMatch(calls[0].options.body, /memory-only-token/);
});

test('rejects corrupt or incompatible backups and cross-tournament references', () => {
  for (const mutate of [
    x => x.tournaments.push(x.tournaments[0]),
    x => { x.matches[0].innings[0].runs = 999; },
    x => { x.matches[0].teamB = 'missing'; },
    x => { x.teams[0].tournamentId = 'missing'; },
    x => { x.matches[0].innings = []; },
    x => { x.matches[0].innings[0].deliveries[0].kind = 'invalid'; },
    x => { x.matches[0].status = 'completed'; },
    x => { x.activeMatchId = 'missing'; },
    x => { x.matches[0].innings[0].extras.wide = -1; }
  ]) { const data = sample(); mutate(data); assert.throws(() => validateStore(data), /Invalid CricBoard/); }
  assert.throws(() => readBackup({ app: 'Other', version: 1, data: sample() }));
  assert.throws(() => readBackup({ app: 'CricBoard', version: 999, data: sample() }));
  assert.throws(() => validateStore(JSON.parse('{"__proto__":{},"tournaments":[]}')));
});

test('fingerprints ignore object property order and include offline changes', async () => {
  const data = sample();
  const reordered = Object.fromEntries(Object.entries(data).reverse());
  assert.equal(await fingerprint(data), await fingerprint(reordered));
  const before = await fingerprint(data); data.matches[0] = applyDelivery(data.matches[0], { kind: 'wicket' });
  assert.notEqual(await fingerprint(data), before);
});

test('sync detects independent and simultaneous edits without timestamp guessing', () => {
  const base = { revision: 'r1', hash: 'original' };
  const head = { revision: 'r2', hash: 'remote', parents: ['r1'] };
  assert.equal(syncPlan('local', base, []), 'upload');
  assert.equal(syncPlan('remote', base, [head]), 'equal');
  assert.equal(syncPlan('local', base, [{ revision: 'r1', hash: 'original' }]), 'upload');
  assert.equal(syncPlan('original', base, [head]), 'download');
  assert.equal(syncPlan('local', base, [head]), 'conflict');
  assert.equal(syncPlan('local', null, [head]), 'conflict');
  assert.equal(syncPlan('empty', null, [head], true), 'download');
  assert.equal(syncPlan('remote', base, [head, { revision: 'other', hash: 'remote' }]), 'conflict');
});

test('simultaneous cloud saves preserve both branches; explicit resolution retains history', async () => {
  const { api } = mockDrive();
  const original = await api.upload(sample(), []);
  const a = sample(), b = sample(); a.tournaments[0].name = 'Device A'; b.tournaments[0].name = 'Device B';
  const [left, right] = await Promise.all([api.upload(a, [original.revision]), api.upload(b, [original.revision])]);
  assert.equal(backupHeads(await api.list()).length, 2);
  const resolution = await api.upload(a, [left.revision, right.revision]);
  const history = await api.list();
  assert.equal(history.length, 4);
  assert.deepEqual(backupHeads(history).map(x => x.revision), [resolution.revision]);
  assert.deepEqual(await api.download(right), b);
});

test('lists all pages before finding heads', async () => {
  const { api, files } = mockDrive();
  const a = await api.upload(sample(), []), b = await api.upload(sample(), [a.revision]);
  let page = 0;
  const paged = new DriveSnapshots('token', async url => {
    const parsed = new URL(url); page++;
    assert.equal(parsed.searchParams.get('spaces'), 'appDataFolder');
    const selected = files.get(page === 1 ? a.id : b.id);
    return new Response(JSON.stringify({ files: [selected], ...(page === 1 ? { nextPageToken: 'second' } : {}) }));
  });
  assert.equal(backupHeads(await paged.list())[0].revision, b.revision);
  assert.equal(page, 2);
});

test('download verifies content hash, not just metadata', async () => {
  const { api, files } = mockDrive(); const file = await api.upload(sample(), []);
  files.get(file.id).body.data.tournaments[0].name = 'Tampered';
  await assert.rejects(api.download(file), /Invalid CricBoard/);
});

test('expired, denied and rate limited requests produce actionable errors', async () => {
  for (const [status, expected] of [[401, /expired/], [403, /denied/], [429, /busy/], [503, /busy/]]) {
    const api = new DriveSnapshots('token', async () => new Response('{}', { status }));
    await assert.rejects(api.list(), expected);
  }
});

test('UI integration: connect, backup, offline queue, cloud restore and safe failed recovery', async t => {
  const ids = ['cloudStatus', 'cloudBackup', 'cloudSync', 'cloudRefresh', 'cloudRestore', 'cloudConnect', 'cloudDisconnect', 'cloudVersions', 'cloudImport', 'cloudRecovery', 'cloudAuto', 'cloudAccount', 'googleClientId', 'cloudSaveClient', 'cloudSetup', 'cloudExport'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', disabled: false, checked: false, options: [], add(option) { this.options.push(option); if (!this.value) this.value = option.value; }, replaceChildren() { this.options = []; this.value = ''; } }]));
  const saved = new Map([['cricboard-google-client-id', '123-test.apps.googleusercontent.com']]);
  let denyStorage = false;
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => { if (denyStorage) throw new Error('Storage full'); saved.set(key, value); } };
  let state = sample(), tokenClient, replaced = 0, intervals = [], timeouts = [], confirms = [];
  const events = {};
  const remote = mockDrive();
  const install = (name, value) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  };
  install('document', { getElementById: id => elements[id], querySelector: () => ({ content: '' }), createElement: () => ({}), head: { append() {} } });
  install('window', { google: { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: options => { tokenClient = options; return { requestAccessToken() {} }; } } } }, addEventListener: (name, handler) => { events[name] = handler; } });
  install('navigator', { onLine: true }); install('Option', class { constructor(label, value) { this.text = label; this.value = value; } });
  install('setInterval', fn => { intervals.push(fn); return intervals.length; });
  install('setTimeout', fn => { timeouts.push(fn); return timeouts.length; }); install('clearTimeout', () => {});
  install('confirm', message => { confirms.push(message); return true; }); install('fetch', remote.request);
  const ui = initCloud({ getStore: () => state, replaceStore: data => { state = data; replaced++; }, storage });
  elements.cloudConnect.onclick();
  assert.match(tokenClient.scope, /drive.appdata/);
  await tokenClient.callback({ access_token: 'secret', expires_in: 3600, scope: SCOPE });
  assert.equal(elements.cloudAccount.textContent, 'scorer@example.com');
  assert.equal(remote.files.size, 0, 'connecting does not upload local data');
  await elements.cloudBackup.onclick();
  assert.equal(remote.files.size, 1);
  assert.ok([...saved.values()].every(value => !value.includes('secret')), 'tokens must never be persisted');
  state.matches[0] = applyDelivery(state.matches[0], { kind: 'bat', runs: 2 });
  navigator.onLine = false; elements.cloudAuto.checked = true; elements.cloudAuto.onchange(); ui.changed();
  assert.match(elements.cloudStatus.textContent, /Offline/);
  navigator.onLine = true; events.online(); await timeouts.at(-1)();
  assert.equal(remote.files.size, 2);
  // A different device advances the cloud; unchanged local records can pull it.
  const heads = backupHeads(await remote.api.list()); const other = structuredClone(state); other.tournaments[0].name = 'Synced Cup';
  await remote.api.upload(other, heads.map(h => h.revision));
  await elements.cloudSync.onclick();
  assert.equal(state.tournaments[0].name, 'Synced Cup'); assert.equal(replaced, 1);
  assert.ok(saved.has('cricboard-recovery-v1'));
  const earliest = (await remote.api.list()).at(-1); elements.cloudVersions.value = earliest.id;
  denyStorage = true; await elements.cloudRestore.onclick();
  assert.equal(replaced, 1, 'cannot replace scores without successfully saving recovery');
  assert.match(elements.cloudStatus.textContent, /Storage full/);
  denyStorage = false; await elements.cloudRestore.onclick();
  assert.equal(replaced, 2); assert.equal(elements.cloudAuto.checked, false);
  assert.equal(state.matches[0].innings[0].runs, 4);
  elements.cloudDisconnect.onclick();
  assert.equal(elements.cloudAccount.textContent, 'Not connected');
  assert.equal(elements.cloudBackup.disabled, true);
  assert.equal(remote.files.size, 3, 'restore/disconnect do not delete backup versions');
});
