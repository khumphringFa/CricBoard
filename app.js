import { makeId, createMatch, startMatch, applyDelivery, undoDelivery, advanceInnings, endInnings, summary, standings, oversText, lastOverDeliveries } from "./engine.mjs";
import { initCloud, validateStore } from "./cloud.mjs";

const KEY = "cricboard-tournaments-v1";
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const empty = () => { const id = makeId(); return { tournaments: [{ id, name: "My Local Tournament" }], teams: [], matches: [], activeTournamentId: id, activeMatchId: null }; };
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return value && Array.isArray(value.tournaments) && Array.isArray(value.matches) && Array.isArray(value.teams) ? value : empty();
  } catch { return empty(); }
}
let store = read();
let cloud = null;
let peer = null;
let liveMatchId = null;
let liveConnections = new Set();
let liveId = "";
let toastTimer;
let watcher = null;
let watchConnection = null;
let watchEnded = false;
let watchPacket = null;
const query = new URLSearchParams(location.search);
const remoteId = query.get("display");
const localId = query.get("local");
const spectator = Boolean(remoteId || localId);

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); cloud?.changed(); }
  catch { notify("Browser storage is unavailable. Scores may not be saved."); }
}
function notify(message) {
  const node = $("toast");
  node.textContent = message; node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.hidden = true, 3400);
}
const tournament = () => store.tournaments.find(t => t.id === store.activeTournamentId) || store.tournaments[0];
const teams = () => store.teams.filter(t => t.tournamentId === tournament()?.id);
const matches = () => store.matches.filter(m => m.tournamentId === tournament()?.id);
const current = () => store.matches.find(m => m.id === store.activeMatchId && m.tournamentId === tournament()?.id) || null;
const nameOf = id => store.teams.find(t => t.id === id)?.name || "Unknown team";
const statusLabel = status => ({ scheduled: "Scheduled", live: "● Live", break: "Innings break", completed: "Full time" })[status] || status;
function updateMatch(transform) {
  const idx = store.matches.findIndex(m => m.id === store.activeMatchId);
  if (idx < 0) return;
  try { store.matches[idx] = transform(store.matches[idx]); save(); render(); broadcast(); }
  catch (err) { notify(err.message || "Could not update score"); }
}
function options(select, values, preferred, placeholder) {
  const old = preferred ?? select.value;
  select.replaceChildren();
  if (placeholder) select.add(new Option(placeholder, ""));
  for (const item of values) select.add(new Option(item.name, item.id));
  if (values.some(item => item.id === old)) select.value = old;
  else if (values.length && !placeholder) select.value = values[0].id;
}
function render() {
  if (!tournament()) { store = empty(); save(); }
  const t = tournament(), ts = teams(), ms = matches();
  options($("tournamentSelect"), store.tournaments, t.id);
  $("teamCount").textContent = String(ts.length);
  $("matchCount").textContent = String(ms.length);
  $("teamsList").innerHTML = ts.length ? ts.map((team, i) =>
    '<div class="team-chip"><span class="team-emblem">' + esc(team.name.slice(0, 2).toUpperCase()) + '</span><span>' + esc(team.name) + '</span><span class="counter">' + (i + 1) + '</span></div>').join("") :
    '<div class="empty-line">No teams yet. Add your first team above.</div>';
  const teamItems = ts.map(({id,name}) => ({id,name}));
  const aBefore = $("teamA").value, bBefore = $("teamB").value, battingBefore = $("battingFirst").value;
  options($("teamA"), teamItems, aBefore, "Choose Team A");
  options($("teamB"), teamItems, bBefore, "Choose Team B");
  if ($("teamB").value === $("teamA").value && ts.length > 1) $("teamB").value = ts.find(team => team.id !== $("teamA").value)?.id || "";
  updateBattingFirst(battingBefore);
  $("statsBar").innerHTML = [
    ["♧", ts.length, "Registered teams"], ["⚑", ms.length, "Total fixtures"], ["◉", ms.filter(m => m.status === "completed").length, "Matches completed"]
  ].map(item => '<div class="stat-card"><span class="stat-icon">' + item[0] + '</span><div><strong>' + item[1] + '</strong><span>' + item[2] + '</span></div></div>').join("");
  if (!current() && ms.length) store.activeMatchId = ms[0].id;
  renderMatches(ms);
  renderScore();
  renderPoints(ts, ms);
  renderShare();
}
function updateBattingFirst(preferred) {
  const list = [$("teamA").value, $("teamB").value].filter(Boolean).map(id => ({id,name:nameOf(id)}));
  options($("battingFirst"), list, preferred);
}
function renderMatches(ms) {
  const ordered = [...ms].reverse();
  $("matchesList").innerHTML = ordered.length ? ordered.map((m, i) => {
    const inn = m.innings[m.innings.length - 1];
    const score = inn ? " • " + inn.runs + "/" + inn.wickets + " in " + oversText(inn.balls) + " overs" : "";
    return '<button class="match-item ' + (m.id === store.activeMatchId ? "selected" : "") + '" data-match="' + esc(m.id) + '">' +
      '<span class="match-num">' + (ordered.length - i) + '</span><span class="match-item-body"><strong>' + esc(nameOf(m.teamA)) + ' vs ' + esc(nameOf(m.teamB)) + '</strong><small>' +
      esc(m.label || m.overs + "-over match") + esc(score) + '</small></span><span class="match-tag">' + esc(statusLabel(m.status)) + '</span></button>';
  }).join("") : '<div class="empty-line">Fixtures you create will appear here.</div>';
}
function scoreMarkup(m) {
  const s = summary(m), inn = s.current;
  const last = lastOverDeliveries(inn);
  const trail = '<div class="ball-trail"><span class="overname">LATEST BALLS</span>' + (last.length ? last.map(d =>
    '<span class="ball ' + (d.wicket ? "wicket" : d.kind !== "bat" ? "extra" : d.runs === 4 ? "four" : d.runs === 6 ? "six" : "") + '">' + esc(d.symbol) + '</span>').join("") : '<span class="empty-line">Waiting for first delivery</span>') + '</div>';
  const result = m.status === "completed" && m.result ? (m.result.winner ? nameOf(m.result.winner) + " won by " + m.result.margin : m.result.margin) : "";
  const chase = s.target !== null ? '<span class="score-target">TARGET ' + s.target + ' · NEED ' + s.runsNeeded + ' FROM ' + s.ballsLeft + ' BALLS</span>' : '<span class="score-target">' + esc(result || "1ST INNINGS") + '</span>';
  return '<div class="score-card"><div class="score-top"><span class="score-kicker">' + esc(m.label || tournament()?.name || "CRICKET MATCH") + '</span><span class="score-format">' + m.overs + ' OVERS / INNINGS</span></div>' +
    '<div class="score-center"><div class="score-team"><div class="score-team-name">' + esc(nameOf(inn.batting)) + '</div><div class="score-team-sub">BATTING · INNINGS ' + m.innings.length + '</div></div><div class="score-big">' + inn.runs + '<small>/' + inn.wickets + '</small></div></div>' +
    '<div class="score-bottom"><span class="score-overs">OVERS <strong>' + oversText(inn.balls) + '</strong> / ' + m.overs + '</span>' + chase + '</div></div>' +
    '<div class="innings-grid"><div class="mini-metric"><b>' + s.rate + '</b><span>CURRENT RUN RATE</span></div><div class="mini-metric"><b>' +
    (s.requiredRate ?? "—") + '</b><span>REQUIRED RUN RATE</span></div><div class="mini-metric"><b>' +
    (inn.extras.wide + inn.extras.noBall + inn.extras.bye + inn.extras.legBye) + '</b><span>EXTRAS</span></div></div>' + trail +
    (m.innings.length > 1 ? '<p class="hint">First innings: ' + esc(nameOf(m.innings[0].batting)) + ' ' + m.innings[0].runs + '/' + m.innings[0].wickets + ' (' + oversText(m.innings[0].balls) + ' ov)</p>' : "") +
    (result ? '<p style="font-weight:800;color:#109b7f;margin:13px 0 0">' + esc(result) + '</p>' : "");
}
function renderScore() {
  const m = current();
  const pill = $("matchStatePill");
  const actions = $("matchActions");
  actions.innerHTML = "";
  if (!m) {
    pill.textContent = "No match selected"; pill.className = "pill";
    $("matchScore").className = "score-placeholder";
    $("matchScore").innerHTML = '<span class="empty-ball">●</span><h3>Ready for the first ball?</h3><p>Add two teams and create a fixture to begin scoring.</p>';
    $("scoringControls").hidden = true;
    return;
  }
  pill.textContent = statusLabel(m.status);
  pill.className = "pill " + (m.status === "live" ? "live" : m.status === "completed" ? "completed" : "");
  if (m.status === "scheduled") {
    $("matchScore").className = "score-placeholder";
    $("matchScore").innerHTML = '<span class="empty-ball">●</span><h3>' + esc(nameOf(m.teamA)) + ' vs ' + esc(nameOf(m.teamB)) + '</h3><p>' + m.overs + ' overs · ' + esc(nameOf(m.battingFirst)) + ' bats first</p>';
    actions.innerHTML = '<button class="btn btn-primary btn-wide" data-action="start">Start match</button>';
  } else {
    $("matchScore").className = "";
    $("matchScore").innerHTML = scoreMarkup(m);
    if (m.status === "break") actions.innerHTML = '<button class="btn btn-primary" data-action="next">Start second innings</button><button class="btn btn-light" data-action="undo">↶ Undo last ball</button>';
    if (m.status === "completed") actions.innerHTML = '<button class="btn btn-light" data-action="undo">↶ Correct last ball</button>';
  }
  $("scoringControls").hidden = m.status !== "live";
}
function renderPoints(ts, ms) {
  if (!ts.length) { $("pointsTable").innerHTML = '<p class="empty-line">Add teams to see the table.</p>'; return; }
  const data = standings(ms,ts.map(t=>t.id));
  $("pointsTable").innerHTML = '<div class="table-wrap"><table class="standings"><thead><tr><th>TEAM</th><th>P</th><th>W</th><th>L</th><th>T</th><th>PTS</th></tr></thead><tbody>' +
    data.map(r => '<tr><td>' + esc(nameOf(r.id)) + '</td><td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.lost + '</td><td>' + r.tied + '</td><td>' + r.points + '</td></tr>').join("") + '</tbody></table></div>';
}
function renderShare(message) {
  const activeBroadcast = Boolean(peer && liveId);
  const text = message || (activeBroadcast ? "Live • " + liveConnections.size + " spectator" + (liveConnections.size === 1 ? "" : "s") + " connected" :
    peer ? "Connecting to the live service…" : "Not broadcasting");
  $("sharingStatus").innerHTML = '<span class="status-dot ' + (activeBroadcast ? "" : "amber") + '"></span>' + esc(text) +
    (activeBroadcast && liveMatchId !== store.activeMatchId ? " (another match)" : "");
  $("startLive").disabled = Boolean(peer) || !current();
  $("stopLive").disabled = !peer;
  $("copyLive").disabled = !liveId;
  $("openLocal").disabled = !current();
}
function eventScore(kind, runs) {
  updateMatch(m => applyDelivery(m, {kind, runs}));
}
function packetFor(matchId) {
  const m = store.matches.find(item => item.id === matchId);
  if (!m) return null;
  const t = store.tournaments.find(item => item.id === m.tournamentId);
  const idToName = id => store.teams.find(team => team.id === id)?.name || "Team";
  return { kind: "score", version: 1, match: m, tournament: t?.name || "Local Cricket Tournament",
    teamA: idToName(m.teamA), teamB: idToName(m.teamB), sentAt: new Date().toISOString() };
}
function sendOne(conn) {
  const data = packetFor(liveMatchId);
  if (conn.open && data) { try { conn.send(data); } catch { /* disconnected client */ } }
}
function broadcast() {
  if (!liveMatchId) return;
  for (const conn of liveConnections) sendOne(conn);
}
function randomId() {
  const numbers = new Uint8Array(16);
  crypto.getRandomValues(numbers);
  return "cricboard-" + Array.from(numbers, n => n.toString(16).padStart(2, "0")).join("");
}
function stopLive() {
  for (const conn of liveConnections) { try { if (conn.open) conn.send({kind:"ended"}); } catch {} try { conn.close(); } catch {} }
  liveConnections.clear();
  if (peer) { try { peer.destroy(); } catch {} }
  peer = null; liveId = ""; liveMatchId = "";
  $("shareLink").value = "";
  renderShare();
}
function startLive() {
  if (!current()) return notify("Create and select a match first.");
  if (peer) return;
  if (!window.Peer) return notify("PeerJS could not load. Check internet access and try again.");
  if (!window.crypto?.getRandomValues) return notify("Live sharing needs a secure HTTPS website.");
  liveMatchId = current().id;
  try {
    peer = new window.Peer(randomId());
    peer.on("open", id => {
      liveId = id;
      const url = new URL(location.href);
      url.search = ""; url.hash = "";
      url.searchParams.set("display", id);
      $("shareLink").value = url.href;
      renderShare();
      notify("Live display is ready. Copy the link to share.");
    });
    peer.on("connection", conn => {
      // Spectators are read-only. Never accept score updates from connected clients.
      liveConnections.add(conn);
      conn.on("open", () => { sendOne(conn); renderShare(); });
      conn.on("close", () => { liveConnections.delete(conn); renderShare(); });
      conn.on("error", () => { liveConnections.delete(conn); renderShare(); });
    });
    peer.on("error", err => {
      notify("Live connection failed: " + (err.type || err.message || "network error"));
      stopLive();
    });
    peer.on("disconnected", () => renderShare("Live signaling disconnected. Trying to reconnect…"));
    renderShare();
  } catch (err) { stopLive(); notify("Could not start broadcast: " + err.message); }
}
async function copyLive() {
  const value = $("shareLink").value;
  if (!value) return notify("Start live sharing first.");
  try { await navigator.clipboard.writeText(value); notify("Display link copied."); }
  catch { $("shareLink").focus(); $("shareLink").select(); notify("Copy the selected URL manually."); }
}
function renderDisplay(packet) {
  if (!packet?.match) return;
  watchPacket = packet;
  const m = packet.match, s = summary(m);
  const a = m.innings.find(i => i.batting === m.teamA);
  const b = m.innings.find(i => i.batting === m.teamB);
  const displayScore = inn => inn ? inn.runs + '<small>/' + inn.wickets + '</small>' : "—";
  const overLine = inn => inn ? oversText(inn.balls) + " OVERS" : "YET TO BAT";
  const msg = m.status === "completed" ? (m.result?.winner ? (m.result.winner === m.teamA ? packet.teamA : packet.teamB) + " won by " + m.result.margin : "Match tied") :
    m.status === "break" ? "INNINGS BREAK · TARGET " + (m.innings[0].runs + 1) :
    s.target !== null ? "TARGET " + s.target + " · NEED " + s.runsNeeded + " FROM " + s.ballsLeft + " BALLS" :
    m.status === "scheduled" ? "MATCH NOT STARTED" : "FIRST INNINGS IN PROGRESS";
  $("displayContent").innerHTML = '<div class="display-match-title">' + esc(packet.tournament) + ' · ' + esc(m.label || m.overs + "-over match") + '</div>' +
    '<div class="display-vs"><div class="display-side"><div class="display-team-name">' + esc(packet.teamA) + '</div><div class="display-score">' + displayScore(a) + '</div><div class="display-team-sub">' + overLine(a) + (s.current?.batting === m.teamA && m.status === "live" ? " · BATTING" : "") + '</div></div>' +
    '<div class="display-versus">VS</div><div class="display-side"><div class="display-team-name">' + esc(packet.teamB) + '</div><div class="display-score">' + displayScore(b) + '</div><div class="display-team-sub">' + overLine(b) + (s.current?.batting === m.teamB && m.status === "live" ? " · BATTING" : "") + '</div></div></div>' +
    '<div class="display-highlights"><div><strong>' + (s.current ? oversText(s.current.balls) : "0.0") + '</strong><span>Current overs</span></div><div><strong>' + m.overs + '</strong><span>Overs limit</span></div><div><strong>' + s.rate + '</strong><span>Run rate</span></div><div><strong>' + (s.requiredRate ?? "—") + '</strong><span>Required rate</span></div></div><div class="display-message">' + esc(msg) + '</div>';
  $("displayUpdated").textContent = "Updated " + new Date(packet.sentAt || Date.now()).toLocaleTimeString();
  document.title = packet.teamA + " vs " + packet.teamB + " · CricBoard";
}
function setDisplayConnection(message, connected) {
  $("displayConnection").textContent = message;
  $("displayDot").className = "status-dot " + (connected ? "" : "off");
}
function showLost(message) {
  setDisplayConnection(message, false);
  if (!watchPacket) $("displayContent").innerHTML = '<div class="display-wait"><div class="load-ball">●</div><h1>Waiting for the scoreboard</h1><p>' + esc(message) + '</p></div>';
}
function initDisplay() {
  document.body.classList.add("display-mode");
  $("adminApp").hidden = true;
  $("displayApp").hidden = false;
  if (localId) {
    const refresh = () => {
      const data = read();
      const m = data.matches.find(item => item.id === localId);
      if (!m) return showLost("This match is not available in this browser.");
      const t = data.tournaments.find(item => item.id === m.tournamentId);
      const name = id => data.teams.find(team => team.id === id)?.name || "Team";
      renderDisplay({kind:"score",match:m,tournament:t?.name || "Local cricket",teamA:name(m.teamA),teamB:name(m.teamB),sentAt:m.updatedAt});
      setDisplayConnection("LOCAL SCREEN • SYNCED", true);
    };
    refresh();
    window.addEventListener("storage", e => { if (e.key === KEY) refresh(); });
    return;
  }
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(remoteId || "")) return showLost("Invalid spectator link.");
  if (!window.Peer) return showLost("Live service unavailable. Check the internet connection.");
  try {
    watcher = new window.Peer();
    watcher.on("open", connectToHost);
    watcher.on("error", () => showLost("Connection failed. Retrying while the scorer is online…"));
    watcher.on("disconnected", () => showLost("Signal disconnected. Trying again…"));
    window.setInterval(() => { if (!watchEnded && watcher && !watcher.destroyed && watcher.open && !watchConnection?.open) connectToHost(); }, 5000);
  } catch { showLost("Unable to start the live display."); }
}
function connectToHost() {
  if (watchEnded || !watcher || watcher.destroyed || watchConnection?.open) return;
  try {
    if (watchConnection) { try { watchConnection.close(); } catch {} }
    watchConnection = watcher.connect(remoteId, {reliable:true});
    watchConnection.on("open", () => setDisplayConnection("CONNECTED · AWAITING SCORE", true));
    watchConnection.on("data", data => {
      if (data?.kind === "ended") {
        watchEnded = true;
        showLost("This temporary display link has expired.");
        return;
      }
      if (data?.kind === "score" && data.match && data.version === 1) {
        renderDisplay(data);
        setDisplayConnection("LIVE · SCOREKEEPER CONNECTED", true);
      }
    });
    watchConnection.on("close", () => { if (!watchEnded) showLost("Scorer offline. Waiting to reconnect…"); });
    watchConnection.on("error", () => { if (!watchEnded) showLost("Network issue. Retrying…"); });
  } catch { showLost("Unable to connect. Retrying…"); }
}
function bindUI() {
  $("tournamentSelect").addEventListener("change", e => {
    store.activeTournamentId = e.target.value; store.activeMatchId = null; save(); render();
  });
  $("tournamentForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = e.currentTarget.elements.tournament, name = input.value.trim();
    if (!name) return;
    const id = makeId();
    store.tournaments.push({id,name}); store.activeTournamentId = id; store.activeMatchId = null;
    input.value = ""; save(); render(); notify("Tournament created.");
  });
  $("teamForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = e.currentTarget.elements.team, name = input.value.trim();
    if (!name) return;
    if (teams().some(t => t.name.toLowerCase() === name.toLowerCase())) return notify("That team already exists.");
    store.teams.push({id:makeId(),name,tournamentId:tournament().id});
    input.value = ""; save(); render(); notify("Team added.");
  });
  $("teamA").addEventListener("change", () => updateBattingFirst());
  $("teamB").addEventListener("change", () => updateBattingFirst());
  $("matchForm").addEventListener("submit", e => {
    e.preventDefault();
    try {
      const m = createMatch({tournamentId:tournament().id,teamA:$("teamA").value,teamB:$("teamB").value,battingFirst:$("battingFirst").value,overs:Number($("overs").value),label:$("matchLabel").value.trim()});
      store.matches.push(m); store.activeMatchId = m.id;
      $("matchLabel").value = ""; save(); render(); notify("Fixture created. Select Start match to score.");
    } catch (err) { notify(err.message); }
  });
  document.addEventListener("click", e => {
    const fixture = e.target.closest("[data-match]");
    if (fixture) { store.activeMatchId = fixture.dataset.match; save(); render(); return; }
    const run = e.target.closest("[data-kind]");
    if (run) return eventScore(run.dataset.kind, Number(run.dataset.runs));
    const action = e.target.closest("[data-action]");
    if (!action) return;
    const cmd = action.dataset.action;
    if (cmd === "extra") return eventScore($("extraType").value, Number($("extraRuns").value));
    if (cmd === "start") return updateMatch(startMatch);
    if (cmd === "undo") return updateMatch(undoDelivery);
    if (cmd === "next") return updateMatch(advanceInnings);
    if (cmd === "end") { if (confirm("End the current innings now?")) updateMatch(endInnings); }
    if (cmd === "wicket") return eventScore("wicket", 0);
  });
  $("startLive").addEventListener("click", startLive);
  $("stopLive").addEventListener("click", () => { stopLive(); notify("Temporary link has been stopped."); });
  $("copyLive").addEventListener("click", copyLive);
  $("openLocal").addEventListener("click", () => {
    if (!current()) return notify("Select a match first.");
    const url = new URL(location.href);
    url.search = ""; url.hash = ""; url.searchParams.set("local", current().id);
    window.open(url.href, "_blank", "noopener");
  });
  window.addEventListener("beforeunload", () => { if (peer) peer.destroy(); });
}
if (spectator) initDisplay();
else {
  bindUI(); render();
  cloud = initCloud({
    getStore: () => store,
    replaceStore: input => {
      const restored = validateStore(input);
      // Persist successfully before changing the score screen or stopping a broadcast.
      localStorage.setItem(KEY, JSON.stringify(restored));
      stopLive(); store = restored; render();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    // Keep another scorer tab from overwriting this tab's newer scores.
    store = read(); render(); broadcast(); cloud.changed();
  });
}

