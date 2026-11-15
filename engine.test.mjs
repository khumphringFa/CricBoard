import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, startMatch, applyDelivery, advanceInnings, undoDelivery, endInnings, summary, oversText, standings, deliveryInfo, selectPlayers, inningsScorecard, tournamentPlayerStats, validatePlayerMatch } from "./engine.mjs";
import { validateStore, DriveSnapshots } from './cloud.mjs';
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

function tracked(size = 4, overs = 2) {
  const squads = Object.fromEntries(['A','B'].map(team => [team, Array.from({length:size}, (_,i) => ({id:team+(i+1),name:team+' player '+(i+1)}))]));
  let m = startMatch(createMatch({tournamentId:'t',teamA:'A',teamB:'B',battingFirst:'A',overs,squads}));
  return selectPlayers(m, {striker:'A1',nonStriker:'A2',bowler:'B1'});
}
test('tracks batter runs, balls, boundaries and strike including no-balls', () => {
  let m = tracked(); m = applyDelivery(m,{kind:'bat',runs:4}); m = applyDelivery(m,{kind:'bat',runs:1});
  assert.equal(m.innings[0].lineup.striker,'A2');
  m = applyDelivery(m,{kind:'noBall',runs:6});
  const card = inningsScorecard(m,m.innings[0]);
  assert.deepEqual(card.batting.slice(0,2).map(p=>[p.runs,p.balls,p.fours,p.sixes]),[[5,2,1,0],[6,1,0,1]]);
  assert.equal(card.bowling[0].runs,12); assert.equal(card.bowling[0].balls,2);
  assert.equal(m.innings[0].lineup.freeHit,true);
  assert.throws(()=>applyDelivery(m,{kind:'wicket',runs:0}), /Free hit/);
  m = applyDelivery(m,{kind:'bat',runs:0}); assert.equal(m.innings[0].lineup.freeHit,false);
  validatePlayerMatch(m);
});
test('byes and leg-byes do not charge the bowler; wides and no-balls do', () => {
  let m = tracked();
  for(const d of [{kind:'bye',runs:2},{kind:'legBye',runs:2},{kind:'noBall',runs:2,runType:'bye'},{kind:'wide',runs:0}]) m=applyDelivery(m,d);
  const inn=m.innings[0], card=inningsScorecard(m,inn);
  assert.equal(inn.runs,8); assert.equal(inn.balls,2);
  assert.deepEqual(inn.extras,{wide:1,noBall:1,bye:4,legBye:2});
  assert.equal(card.bowling[0].runs,2); assert.equal(card.batting[0].runs,0); assert.equal(card.batting[0].balls,3);
  assert.equal(inn.lineup.freeHit,true,'wide does not consume a free hit');
  validatePlayerMatch(m);
});
test('over completion swaps strike, records maidens and requires a different bowler', () => {
  let m=tracked(); for(let i=0;i<6;i++)m=applyDelivery(m,{kind:'bat',runs:0});
  assert.equal(m.innings[0].lineup.striker,'A2'); assert.equal(m.innings[0].lineup.bowler,null);
  assert.equal(inningsScorecard(m,m.innings[0]).bowling[0].maidens,1);
  assert.throws(()=>applyDelivery(m,{kind:'bat',runs:1}),/Select both/);
  assert.throws(()=>selectPlayers(m,{bowler:'B1'}),/different bowler/);
  m=selectPlayers(m,{bowler:'B2'}); m=applyDelivery(m,{kind:'bat',runs:1});
  validatePlayerMatch(m);
  m=undoDelivery(m); assert.equal(m.innings[0].lineup.striker,'A2'); assert.equal(m.innings[0].lineup.bowler,'B2');
  m=undoDelivery(m); assert.equal(m.innings[0].lineup.bowler,'B1'); assert.equal(m.innings[0].lineup.lastBowler,null);
  validatePlayerMatch(m);
});
test('run outs allow either batter, record completed runs, and never credit the bowler', () => {
  let m=tracked(); const before=structuredClone(m.innings[0].lineup);
  m=applyDelivery(m,{kind:'bat',runs:1,dismissal:'runOut',dismissed:'A2',survivorFaces:true});
  const card=inningsScorecard(m,m.innings[0]);
  assert.equal(m.innings[0].wickets,1); assert.equal(card.bowling[0].wickets,0);
  assert.equal(card.batting[0].runs,1); assert.equal(card.batting[1].dismissal.type,'runOut');
  assert.equal(m.innings[0].lineup.striker,'A1'); assert.equal(m.innings[0].lineup.nonStriker,null);
  assert.throws(()=>selectPlayers(m,{nonStriker:'A2'}),/available batter/);
  m=selectPlayers(m,{nonStriker:'A3'}); validatePlayerMatch(m);
  m=undoDelivery(m); assert.deepEqual(m.innings[0].lineup,before);
  assert.equal(inningsScorecard(m,m.innings[0]).batting[1].dismissal,null);
});
test('dismissal restrictions and run out on illegal delivery preserve legal-ball count', () => {
  assert.throws(()=>deliveryInfo({kind:'noBall',runs:0,dismissal:'caught'}),/no-ball/);
  assert.throws(()=>deliveryInfo({kind:'wide',runs:0,dismissal:'bowled'}),/wide/);
  assert.throws(()=>deliveryInfo({kind:'bat',runs:1,dismissal:'caught'}),/completed runs/);
  let m=tracked(); m=applyDelivery(m,{kind:'noBall',runs:0,dismissal:'runOut',dismissed:'A1'});
  assert.equal(m.innings[0].balls,0); assert.equal(m.innings[0].runs,1);
  assert.equal(m.innings[0].wickets,1); assert.equal(inningsScorecard(m,m.innings[0]).bowling[0].wickets,0);
  validatePlayerMatch(m);
});
test('small squads end when all but one are out and calculate chase margins correctly', () => {
  let m=tracked(2); m=applyDelivery(m,{kind:'wicket',runs:0}); assert.equal(m.status,'break');
  m=advanceInnings(m); m=selectPlayers(m,{striker:'B1',nonStriker:'B2',bowler:'A1'});
  m=applyDelivery(m,{kind:'bat',runs:1}); assert.equal(m.status,'completed');
  assert.equal(m.result.margin,'1 wicket'); validatePlayerMatch(m);
  m=undoDelivery(m); assert.equal(m.status,'live'); assert.equal(m.innings[1].lineup.striker,'B1');
});
test('tracked backup validates player history and rejects tampering', async () => {
  let m=tracked(); m=applyDelivery(m,{kind:'bat',runs:1}); m=applyDelivery(m,{kind:'wicket',runs:0});
  m=selectPlayers(m,{striker:'A3'}); m=applyDelivery(m,{kind:'bat',runs:4});
  const data={tournaments:[{id:'t',name:'Cup'}],teams:[{id:'A',name:'A',tournamentId:'t'},{id:'B',name:'B',tournamentId:'t'}],players:[],matches:[m],activeTournamentId:'t',activeMatchId:m.id};
  assert.deepEqual(validateStore(data),data);
  for(const mutate of [x=>{x.matches[0].innings[0].deliveries[0].striker='B1';},x=>{x.matches[0].innings[0].lineup.striker='A2';},x=>{x.matches[0].squads.B[0].id='A1';}]) {
    const corrupted=structuredClone(data); mutate(corrupted); assert.throws(()=>validateStore(corrupted));
  }
  let saved;
  const api=new DriveSnapshots('token',async (url, options)=>{
    if(options.method==='POST'){saved=JSON.parse(options.body.split('\r\n\r\n')[2].split('\r\n--')[0]); return new Response('{"id":"snapshot"}');}
    return new Response(JSON.stringify(saved));
  });
  const file=await api.upload(data,[]); assert.deepEqual(await api.download(file),data);
});
test('tournament leaderboards isolate events and squash duplicate names by stable player ID', () => {
  let a=tracked(); a=applyDelivery(a,{kind:'bat',runs:4});
  const other=structuredClone(a); other.tournamentId='another'; other.innings[0].deliveries[0].runs=6;
  const stats=tournamentPlayerStats([a,other],'t');
  assert.equal(stats.find(p=>p.id==='A1').runs,4);
  assert.equal(stats.find(p=>p.id==='B1').conceded,4);
  assert.equal(tournamentPlayerStats([a],'unknown').length,0);
  const all=tournamentPlayerStats([a,other],null);
  assert.equal(all.filter(p=>p.id==='A1').length,2);
  assert.equal(all.find(p=>p.id==='A1' && p.tournamentId==='another').runs,6);
});
test('extended bowling metrics count only used bowlers and credit wickets and extras', () => {
  let m=tracked();
  assert.equal(tournamentPlayerStats([m],'t').some(p=>p.id==='B1'),false);
  m=applyDelivery(m,{kind:'wide',runs:0});
  m=applyDelivery(m,{kind:'wicket',runs:0});
  const p=tournamentPlayerStats([m],'t').find(p=>p.id==='B1');
  assert.equal(p.bowlingInnings,1);
  assert.equal(p.wides,1);
  assert.equal(p.bestBowling,'1/1');
  assert.equal(p.bowlingAverage,'1.00');
  assert.equal(p.bowlingStrikeRate,'1.00');
});
test('selection prevents duplicate batters, foreign players and mid-over bowler changes', () => {
  const m=tracked();
  assert.throws(()=>selectPlayers(m,{striker:'A2'}));
  assert.throws(()=>selectPlayers(m,{bowler:'B2'}),/Undo/);
  assert.throws(()=>selectPlayers(m,{nonStriker:'B1'}));
  const swapped=selectPlayers(m,{swap:true}); assert.equal(swapped.innings[0].lineup.striker,'A2'); validatePlayerMatch(swapped);
});
test('a manual strike correction while awaiting a replacement batter survives backup validation', () => {
  let m=tracked(); m=applyDelivery(m,{kind:'wicket',runs:0});
  m=selectPlayers(m,{swap:true}); m=selectPlayers(m,{nonStriker:'A3'});
  validatePlayerMatch(m); m=applyDelivery(m,{kind:'bat',runs:2}); validatePlayerMatch(m);
});

