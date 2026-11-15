// CricBoard scoring engine — no external dependencies.
export const makeId = () => "cb-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const oversText = (legalBalls = 0) => Math.floor(legalBalls / 6) + "." + (legalBalls % 6);
export const inningsFor = (batting, bowling) => ({
  batting, bowling, runs: 0, wickets: 0, balls: 0,
  extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
  deliveries: []
});
const emptyLineup = () => ({ striker: null, nonStriker: null, bowler: null, lastBowler: null, freeHit: false });
export const wicketLimit = (match, team) => match.playerMode ? match.squads[team].length - 1 : 10;
export function validateSquads(squads, a, b) {
  const ids = new Set();
  for (const team of [a, b]) {
    const players = squads[team];
    if (!Array.isArray(players) || players.length < 2 || players.length > 11) throw new Error('Add 2–11 players to each team for player scoring.');
    for (const p of players) {
      if (!p || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id) ||
          typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) throw new Error('Each squad needs valid, unique players.');
      ids.add(p.id);
    }
  }
}
function assertLineup(match, inn, lineup) {
  if (!lineup) throw new Error('Missing player selection.');
  const batters = new Set(match.squads[inn.batting].map(p => p.id));
  const bowlers = new Set(match.squads[inn.bowling].map(p => p.id));
  const dismissed = new Set(inn.deliveries.filter(d => deliveryInfo(d).wicket).map(d => d.dismissed));
  for (const player of [lineup.striker, lineup.nonStriker]) if (player !== null && (!batters.has(player) || dismissed.has(player))) throw new Error('Choose an available batter from the batting team.');
  if (lineup.striker && lineup.striker === lineup.nonStriker) throw new Error('Select two different batters.');
  if (lineup.bowler !== null && (!bowlers.has(lineup.bowler) || lineup.bowler === lineup.lastBowler)) throw new Error('Select a different bowler for the new over.');
  if (lineup.lastBowler !== null && !bowlers.has(lineup.lastBowler)) throw new Error('Invalid previous bowler.');
  if (typeof lineup.freeHit !== 'boolean') throw new Error('Invalid free-hit state.');
}
export function selectPlayers(match, selection) {
  if (!match.playerMode || match.status !== 'live') throw new Error('Player selection requires a live player-tracked match.');
  const next = clone(match), inn = next.innings.at(-1), old = inn.lineup;
  if (selection.swap) { [old.striker, old.nonStriker] = [old.nonStriker, old.striker]; return stamp(next); }
  const proposed = { ...old, striker: selection.striker || old.striker, nonStriker: selection.nonStriker || old.nonStriker, bowler: selection.bowler || old.bowler };
  for (const key of ['striker', 'nonStriker', 'bowler']) if (old[key] && proposed[key] !== old[key]) throw new Error('Undo a ball to correct assigned players; only vacant positions can be filled.');
  assertLineup(next, inn, proposed); inn.lineup = proposed; return stamp(next);
}

export function inningsScorecard(match, inn) {
  if (!match.playerMode || !inn) return null;
  const batting = match.squads[inn.batting].map(p => ({ ...p, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, entered: false }));
  const bowling = match.squads[inn.bowling].map(p => ({ ...p, balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, maidens: 0, used: false }));
  const bat = new Map(batting.map(p => [p.id, p])), bowl = new Map(bowling.map(p => [p.id, p]));
  const overStats = new Map(); let balls = 0;
  for (const d of inn.deliveries) {
    const info = deliveryInfo(d), batter = bat.get(d.striker), bowler = bowl.get(d.bowler);
    batter.entered = true; bat.get(d.nonStriker).entered = true; bowler.used = true;
    batter.runs += info.batRuns; batter.balls += info.kind !== 'wide' ? 1 : 0;
    if (d.boundary && info.batRuns === 4) batter.fours++;
    if (d.boundary && info.batRuns === 6) batter.sixes++;
    bowler.balls += info.legal ? 1 : 0; bowler.runs += info.bowlerRuns;
    bowler.wides += info.kind === 'wide' ? info.total : 0;
    bowler.noBalls += info.kind === 'noBall' ? 1 : 0;
    if (info.wicket) {
      bat.get(d.dismissed).dismissal = { type: info.dismissal, bowler: info.dismissal === 'runOut' ? null : d.bowler };
      if (info.dismissal !== 'runOut') bowler.wickets++;
    }
    const over = Math.floor(balls / 6), key = over + ':' + d.bowler;
    const o = overStats.get(key) || { bowler: d.bowler, runs: 0, balls: 0 };
    o.runs += info.bowlerRuns; o.balls += info.legal ? 1 : 0; overStats.set(key, o);
    if (info.legal) balls++;
  }
  for (const p of [inn.lineup?.striker, inn.lineup?.nonStriker]) if (bat.has(p)) bat.get(p).entered = true;
  for (const o of overStats.values()) if (o.balls === 6 && !o.runs) bowl.get(o.bowler).maidens++;
  for (const p of batting) p.strikeRate = p.balls ? (p.runs * 100 / p.balls).toFixed(2) : '—';
  for (const p of bowling) { p.overs = oversText(p.balls); p.economy = p.balls ? (p.runs * 6 / p.balls).toFixed(2) : '—'; }
  return { batting, bowling: bowling.filter(p => p.used || p.id === inn.lineup?.bowler), striker: inn.lineup?.striker, nonStriker: inn.lineup?.nonStriker, bowler: inn.lineup?.bowler };
}

export function tournamentPlayerStats(matches, tournamentId) {
  const rows = new Map();
  for (const m of matches.filter(m => m.tournamentId === tournamentId && m.playerMode)) {
    for (const inn of m.innings) {
      const card = inningsScorecard(m, inn);
      const row = (p, team) => {
        if (!rows.has(p.id)) rows.set(p.id, { id: p.id, name: p.name, team, runs: 0, balls: 0, fours: 0, sixes: 0, innings: 0, outs: 0, highest: 0, wickets: 0, bowlingBalls: 0, conceded: 0, maidens: 0 });
        return rows.get(p.id);
      };
      for (const p of card.batting.filter(p => p.entered)) {
        const r = row(p, inn.batting); r.runs += p.runs; r.balls += p.balls; r.fours += p.fours; r.sixes += p.sixes;
        r.innings++; r.outs += p.dismissal ? 1 : 0; r.highest = Math.max(r.highest, p.runs);
      }
      for (const p of card.bowling) { const r = row(p, inn.bowling); r.wickets += p.wickets; r.bowlingBalls += p.balls; r.conceded += p.runs; r.maidens += p.maidens; }
    }
  }
  return [...rows.values()].map(p => ({ ...p, average: p.outs ? (p.runs / p.outs).toFixed(2) : '—', strikeRate: p.balls ? (p.runs * 100 / p.balls).toFixed(2) : '—', economy: p.bowlingBalls ? (p.conceded * 6 / p.bowlingBalls).toFixed(2) : '—' }));
}

// Rebuild player state from deliveries before accepting a downloaded scorecard.
export function validatePlayerMatch(match) {
  if (!match.playerMode) return;
  validateSquads(match.squads, match.teamA, match.teamB);
  const acceptSelection = (sim, before) => {
    const old = sim.innings.at(-1).lineup;
    if (old.lastBowler !== before.lastBowler || old.freeHit !== before.freeHit) throw new Error('Invalid player history.');
    let next = sim;
    if ((old.striker && old.striker === before.nonStriker) || (old.nonStriker && old.nonStriker === before.striker)) next = selectPlayers(next, { swap: true });
    return selectPlayers(next, before);
  };
  for (const inn of match.innings) {
    let sim = { ...clone(match), status: 'live', innings: [{ ...inningsFor(inn.batting, inn.bowling), lineup: emptyLineup() }] };
    for (const d of inn.deliveries) {
      if (!d.before || d.striker !== d.before.striker || d.nonStriker !== d.before.nonStriker || d.bowler !== d.before.bowler) throw new Error('Invalid player delivery.');
      sim = acceptSelection(sim, d.before);
      // Simulate this innings independently, without applying a chase target.
      const simulated = applyDelivery(sim, d);
      if (simulated.innings[0].deliveries.at(-1).dismissed !== d.dismissed) throw new Error('Invalid dismissal.');
      sim = simulated;
    }
    const computed = sim.innings[0];
    if (computed.runs !== inn.runs || computed.balls !== inn.balls || computed.wickets !== inn.wickets) throw new Error('Player totals disagree.');
    if (sim.status !== 'live') sim.status = 'live'; // Selection may have been filled after an innings ended.
    sim = acceptSelection(sim, inn.lineup);
    const expected = sim.innings[0].lineup;
    for (const key of ['striker', 'nonStriker', 'bowler', 'lastBowler', 'freeHit']) if (expected[key] !== inn.lineup[key]) throw new Error('Invalid current players.');
  }
}
export function createMatch({ tournamentId, teamA, teamB, battingFirst, overs, label = "", squads = null }) {
  if (!teamA || !teamB || teamA === teamB) throw new Error("Choose two different teams.");
  if (![teamA, teamB].includes(battingFirst)) throw new Error("Select who bats first.");
  const limit = Number(overs);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Overs must be from 1 to 50.");
  if (squads) validateSquads(squads, teamA, teamB);
  return { id: makeId(), tournamentId, teamA, teamB, battingFirst, overs: limit, label: String(label).slice(0, 80),
    ...(squads ? { playerMode: true, squads: clone(squads) } : {}),
    status: "scheduled", innings: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: "" };
}
export function startMatch(match) {
  if (match.status !== "scheduled") return clone(match);
  const next = clone(match);
  next.innings = [inningsFor(next.battingFirst, next.battingFirst === next.teamA ? next.teamB : next.teamA)];
  if (next.playerMode) next.innings[0].lineup = emptyLineup();
  next.status = "live";
  return stamp(next);
}
export function stamp(match) { match.updatedAt = new Date().toISOString(); return match; }
export function deliveryInfo(delivery) {
  const kind = delivery.kind;
  const runs = Number(delivery.runs ?? 0);
  if (!["bat", "wide", "noBall", "bye", "legBye", "wicket"].includes(kind)) throw new Error("Unknown delivery type.");
  if (!Number.isInteger(runs) || runs < 0 || runs > 6) throw new Error("Runs must be between 0 and 6.");
  if (kind === "wicket" && runs !== 0) throw new Error("Use a separate delivery for wickets.");
  const dismissal = delivery.dismissal || (kind === 'wicket' ? 'bowled' : null);
  if (dismissal && !['bowled', 'caught', 'lbw', 'stumped', 'hitWicket', 'runOut'].includes(dismissal)) throw new Error('Choose a supported dismissal.');
  if (kind === 'noBall' && dismissal && dismissal !== 'runOut') throw new Error('Only run out is supported on a no-ball.');
  if (kind === 'wide' && dismissal && !['runOut', 'stumped', 'hitWicket'].includes(dismissal)) throw new Error('That dismissal cannot occur on a wide.');
  if (dismissal && dismissal !== 'runOut' && runs) throw new Error('Only run outs can include completed runs.');
  if (['bye', 'legBye'].includes(kind) && dismissal && dismissal !== 'runOut') throw new Error('Use a run out for a wicket with byes.');
  const runType = delivery.runType || 'bat';
  if (!['bat', 'bye', 'legBye'].includes(runType) || (kind !== 'noBall' && runType !== 'bat')) throw new Error('Invalid no-ball run type.');
  const legal = kind !== "wide" && kind !== "noBall";
  const total = runs + (legal ? 0 : 1);
  const symbol = kind === "wicket" ? "W" : kind === "wide" ? "Wd" + total :
    kind === "noBall" ? "Nb" + total : kind === "bye" ? "B" + runs :
    kind === "legBye" ? "Lb" + runs : String(runs);
  const batRuns = kind === 'bat' || (kind === 'noBall' && runType === 'bat') ? runs : 0;
  const bye = kind === 'bye' || (kind === 'noBall' && runType === 'bye') ? runs : 0;
  const legBye = kind === 'legBye' || (kind === 'noBall' && runType === 'legBye') ? runs : 0;
  return { kind, runs, total, legal, wicket: Boolean(dismissal), dismissal,
    batRuns, bye, legBye, bowlerRuns: total - bye - legBye,
    symbol: dismissal && kind !== 'wicket' ? symbol + '+W' : symbol };
}
export function recalc(inn) {
  inn.runs = 0; inn.wickets = 0; inn.balls = 0;
  inn.extras = { wide: 0, noBall: 0, bye: 0, legBye: 0 };
  for (const d of inn.deliveries) {
    const item = deliveryInfo(d);
    inn.runs += item.total;
    inn.wickets += item.wicket ? 1 : 0;
    inn.balls += item.legal ? 1 : 0;
    if (item.kind === "wide") inn.extras.wide += item.total;
    if (item.kind === "noBall") inn.extras.noBall += 1;
    inn.extras.bye += item.bye;
    inn.extras.legBye += item.legBye;
  }
  return inn;
}
export function finishResult(match) {
  if (match.innings.length < 2) return "";
  const [a, b] = match.innings;
  if (b.runs > a.runs) { const remaining = wicketLimit(match, b.batting) - b.wickets;
    return { winner: b.batting, margin: remaining + " wicket" + (remaining === 1 ? "" : "s") }; }
  if (b.runs < a.runs) return { winner: a.batting, margin: (a.runs - b.runs) + " run" + (a.runs - b.runs === 1 ? "" : "s") };
  return { winner: null, margin: "Match tied" };
}
export function applyDelivery(match, delivery) {
  if (match.status !== "live") throw new Error("Start or resume the innings first.");
  const next = clone(match);
  const inn = next.innings[next.innings.length - 1];
  const info = deliveryInfo(delivery);
  if (inn.balls >= next.overs * 6 || inn.wickets >= wicketLimit(next, inn.batting)) throw new Error("This innings is finished.");
  // A wide or no-ball remains legal when the over has exactly six counted balls only if a new over is available.
  let recorded = { kind: info.kind, runs: info.runs,
    ...(delivery.runType ? { runType: delivery.runType } : {}),
    ...(delivery.dismissal ? { dismissal: delivery.dismissal } : {}) };
  if (next.playerMode) {
    const lineup = inn.lineup;
    assertLineup(next, inn, lineup);
    if (!lineup.striker || !lineup.nonStriker || !lineup.bowler) throw new Error('Select both batters and the bowler before scoring.');
    if (lineup.freeHit && info.dismissal && info.dismissal !== 'runOut') throw new Error('Free hit: only run out is supported.');
    const dismissed = info.wicket ? (delivery.dismissed || lineup.striker) : null;
    if (info.wicket && ![lineup.striker, lineup.nonStriker].includes(dismissed)) throw new Error('Choose a batter currently at the crease.');
    if (info.dismissal !== 'runOut' && info.wicket && dismissed !== lineup.striker) throw new Error('Only the striker can have this dismissal.');
    recorded = { ...recorded, before: clone(lineup), striker: lineup.striker, nonStriker: lineup.nonStriker, bowler: lineup.bowler,
      dismissed, survivorFaces: Boolean(delivery.survivorFaces), boundary: delivery.boundary ?? ([4, 6].includes(info.batRuns) && !info.wicket) };
    let striker = lineup.striker, nonStriker = lineup.nonStriker;
    if (info.runs % 2) [striker, nonStriker] = [nonStriker, striker];
    if (info.wicket) {
      if (info.dismissal === 'runOut') {
        const survivor = dismissed === lineup.striker ? lineup.nonStriker : lineup.striker;
        [striker, nonStriker] = recorded.survivorFaces ? [survivor, null] : [null, survivor];
      } else { striker = null; }
    }
    const overEnded = info.legal && (inn.balls + 1) % 6 === 0;
    if (overEnded) [striker, nonStriker] = [nonStriker, striker];
    inn.lineup = { striker, nonStriker, bowler: overEnded ? null : lineup.bowler,
      lastBowler: overEnded ? lineup.bowler : lineup.lastBowler,
      freeHit: info.kind === 'noBall' || (!info.legal && Boolean(lineup.freeHit)) };
  } else if (delivery.dismissal) {
    throw new Error('Detailed wickets require a new player-tracked match.');
  }
  inn.deliveries.push(recorded);
  recalc(inn);
  if (next.innings.length === 2 && inn.runs > next.innings[0].runs) {
    next.status = "completed"; next.result = finishResult(next);
  } else if (inn.balls >= next.overs * 6 || inn.wickets >= wicketLimit(next, inn.batting)) {
    if (next.innings.length === 1) next.status = "break";
    else { next.status = "completed"; next.result = finishResult(next); }
  }
  return stamp(next);
}
export function undoDelivery(match) {
  const next = clone(match);
  if (!next.innings.length) return next;
  let inn = next.innings[next.innings.length - 1];
  if (!inn.deliveries.length) {
    if (next.innings.length === 2) {
      next.innings.pop(); next.status = "break"; next.result = "";
    }
    return stamp(next);
  }
  const removed = inn.deliveries.pop(); recalc(inn);
  if (next.playerMode) inn.lineup = clone(removed.before);
  next.status = "live"; next.result = "";
  return stamp(next);
}
export function advanceInnings(match) {
  const next = clone(match);
  if (next.status !== "break") throw new Error("Finish the first innings before continuing.");
  if (next.innings.length !== 1) throw new Error("The second innings already exists.");
  const prev = next.innings[0];
  next.innings.push(inningsFor(prev.bowling, prev.batting));
  if (next.playerMode) next.innings[1].lineup = emptyLineup();
  next.status = "live";
  return stamp(next);
}
export function endInnings(match) {
  const next = clone(match);
  if (next.status !== "live") throw new Error("There is no active innings.");
  if (next.innings.length === 1) next.status = "break";
  else { next.status = "completed"; next.result = finishResult(next); }
  return stamp(next);
}
export function summary(match) {
  const current = match.innings[match.innings.length - 1] || null;
  const first = match.innings[0] || null;
  const target = match.innings.length === 2 ? first.runs + 1 : null;
  const ballsLeft = current ? Math.max(0, match.overs * 6 - current.balls) : match.overs * 6;
  const runsNeeded = target === null || !current ? null : Math.max(0, target - current.runs);
  return { current, first, target, ballsLeft, runsNeeded,
    rate: current && current.balls ? (current.runs * 6 / current.balls).toFixed(2) : "0.00",
    requiredRate: target === null || !current ? null : ballsLeft ? (runsNeeded * 6 / ballsLeft).toFixed(2) : "—" };
}
export function lastOverDeliveries(innings) {
  if (!innings) return [];
  const result = [];
  let balls = 0;
  for (const d of innings.deliveries) {
    const info = deliveryInfo(d);
    const overIndex = Math.floor(balls / 6);
    if (info.legal) balls++;
    result.push({ ...info, overIndex });
  }
  const current = Math.floor(Math.max(0, balls - (balls % 6 === 0 && balls > 0 ? 1 : 0)) / 6);
  return result.filter(item => item.overIndex === current).slice(-12);
}
export function standings(matches, teamIds) {
  const rows = new Map(teamIds.map(id => [id, { id, played: 0, won: 0, lost: 0, tied: 0, points: 0 }]));
  for (const m of matches.filter(item => item.status === "completed" && item.result)) {
    const a = rows.get(m.teamA), b = rows.get(m.teamB);
    if (!a || !b) continue;
    a.played++; b.played++;
    if (!m.result.winner) { a.tied++; b.tied++; a.points++; b.points++; }
    else { const w = rows.get(m.result.winner), l = rows.get(m.result.winner === m.teamA ? m.teamB : m.teamA);
      w.won++; w.points += 2; l.lost++; }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.won - a.won || a.id.localeCompare(b.id));
}

