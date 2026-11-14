import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, startMatch, applyDelivery, advanceInnings, undoDelivery, endInnings, summary, oversText, standings, deliveryInfo } from "./engine.mjs";
const setup = (overs = 2) => startMatch(createMatch({ tournamentId: "t", teamA: "A", teamB: "B", battingFirst: "A", overs }));
test("validates match setup", () => {
  assert.throws(() => createMatch({teamA:"A",teamB:"A",battingFirst:"A",overs:2}));
  assert.throws(() => createMatch({teamA:"A",teamB:"B",battingFirst:"A",overs:0}));
});
test("scores legal deliveries, extras, and wickets accurately", () => {
  let m = setup();
  for (const d of [{kind:"bat",runs:4},{kind:"wide",runs:0},{kind:"noBall",runs:2},{kind:"bye",runs:1},{kind:"legBye",runs:2},{kind:"wicket",runs:0}]) m = applyDelivery(m,d);
  assert.equal(m.innings[0].runs, 11);
  assert.equal(m.innings[0].balls, 4);
  assert.equal(m.innings[0].wickets, 1);
  assert.deepEqual(m.innings[0].extras,{wide:1,noBall:1,bye:1,legBye:2});
  assert.equal(oversText(m.innings[0].balls),"0.4");
  assert.throws(() => deliveryInfo({kind:"bat",runs:100}));
});
test("ends overs at legal-ball limit and lets second innings chase", () => {
  let m = setup(1);
  for (let i = 0; i < 6; i++) m = applyDelivery(m,{kind:"bat",runs:1});
  assert.equal(m.status,"break");
  assert.throws(() => applyDelivery(m,{kind:"bat",runs:1}));
  m = advanceInnings(m);
  assert.equal(summary(m).target,7);
  m = applyDelivery(m,{kind:"bat",runs:6});
  m = applyDelivery(m,{kind:"bat",runs:1});
  assert.equal(m.status,"completed");
  assert.equal(m.result.winner,"B");
  assert.match(m.result.margin,/wicket/);
});
test("undo restores a completed chase to live", () => {
  let m = setup(1);
  m = endInnings(m);
  m = advanceInnings(m);
  m = applyDelivery(m,{kind:"bat",runs:1});
  assert.equal(m.status,"completed");
  m = undoDelivery(m);
  assert.equal(m.status,"live");
  assert.equal(m.innings[1].runs,0);
});
test("tie and standings", () => {
  let m = setup(1); m = applyDelivery(m,{kind:"bat",runs:2}); m = endInnings(m); m=advanceInnings(m);
  m = applyDelivery(m,{kind:"bat",runs:2}); m = endInnings(m);
  assert.equal(m.result.winner,null);
  const table=standings([m],["A","B"]);
  assert.equal(table[0].points,1);
  assert.equal(table[1].points,1);
});
