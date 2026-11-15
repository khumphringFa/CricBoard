// CricBoard scoring engine — no external dependencies.
export const makeId = () => "cb-" + (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const oversText = (legalBalls = 0) => Math.floor(legalBalls / 6) + "." + (legalBalls % 6);
export const inningsFor = (batting, bowling) => ({
  batting, bowling, runs: 0, wickets: 0, balls: 0,
  extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
  deliveries: []
});
export function createMatch({ tournamentId, teamA, teamB, battingFirst, overs, label = "" }) {
  if (!teamA || !teamB || teamA === teamB) throw new Error("Choose two different teams.");
  if (![teamA, teamB].includes(battingFirst)) throw new Error("Select who bats first.");
  const limit = Number(overs);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Overs must be from 1 to 50.");
  return { id: makeId(), tournamentId, teamA, teamB, battingFirst, overs: limit, label: String(label).slice(0, 80),
    status: "scheduled", innings: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: "" };
}
export function startMatch(match) {
  if (match.status !== "scheduled") return clone(match);
  const next = clone(match);
  next.innings = [inningsFor(next.battingFirst, next.battingFirst === next.teamA ? next.teamB : next.teamA)];
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
  const legal = kind !== "wide" && kind !== "noBall";
  const total = runs + (legal ? 0 : 1);
  const symbol = kind === "wicket" ? "W" : kind === "wide" ? "Wd" + total :
    kind === "noBall" ? "Nb" + total : kind === "bye" ? "B" + runs :
    kind === "legBye" ? "Lb" + runs : String(runs);
  return { kind, runs, total, legal, wicket: kind === "wicket", symbol };
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
    if (item.kind === "bye") inn.extras.bye += item.runs;
    if (item.kind === "legBye") inn.extras.legBye += item.runs;
  }
  return inn;
}
export function finishResult(match) {
  if (match.innings.length < 2) return "";
  const [a, b] = match.innings;
  if (b.runs > a.runs) return { winner: b.batting, margin: (10 - b.wickets) + " wicket" + (10 - b.wickets === 1 ? "" : "s") };
  if (b.runs < a.runs) return { winner: a.batting, margin: (a.runs - b.runs) + " run" + (a.runs - b.runs === 1 ? "" : "s") };
  return { winner: null, margin: "Match tied" };
}
export function applyDelivery(match, delivery) {
  if (match.status !== "live") throw new Error("Start or resume the innings first.");
  const next = clone(match);
  const inn = next.innings[next.innings.length - 1];
  const info = deliveryInfo(delivery);
  if (inn.balls >= next.overs * 6 || inn.wickets >= 10) throw new Error("This innings is finished.");
  // A wide or no-ball remains legal when the over has exactly six counted balls only if a new over is available.
  inn.deliveries.push({ kind: info.kind, runs: info.runs });
  recalc(inn);
  if (next.innings.length === 2 && inn.runs > next.innings[0].runs) {
    next.status = "completed"; next.result = finishResult(next);
  } else if (inn.balls >= next.overs * 6 || inn.wickets >= 10) {
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
  inn.deliveries.pop(); recalc(inn);
  next.status = "live"; next.result = "";
  return stamp(next);
}
export function advanceInnings(match) {
  const next = clone(match);
  if (next.status !== "break") throw new Error("Finish the first innings before continuing.");
  if (next.innings.length !== 1) throw new Error("The second innings already exists.");
  const prev = next.innings[0];
  next.innings.push(inningsFor(prev.bowling, prev.batting));
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

