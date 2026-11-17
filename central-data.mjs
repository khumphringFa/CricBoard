import {validateStore} from './cloud.mjs';
import {tournamentPlayerStats,oversText} from './engine.mjs';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const lineup=value=>pick(value,['striker','nonStriker','bowler','lastBowler','freeHit']);
// Keep only fields used by the cricket engine and recovery format, not unknown imported metadata.
export function centralStore(input){
  const d=validateStore(input);
  const clean={tournaments:d.tournaments.map(t=>pick(t,['id','name'])),teams:d.teams.map(t=>pick(t,['id','name','tournamentId'])),players:(d.players||[]).map(p=>({...pick(p,['id','name','teamId','tournamentId']),...(p.profile?{profile:pick(p.profile,['role','jersey','batting','bowling','bio'])}:{})})),activeTournamentId:d.activeTournamentId,activeMatchId:d.activeMatchId,matches:d.matches.map(m=>({...pick(m,['id','tournamentId','teamA','teamB','battingFirst','overs','label','status','updatedAt']),createdAt:typeof m.createdAt==='string'&&Number.isFinite(Date.parse(m.createdAt))?m.createdAt:m.updatedAt,result:m.status==='completed'?pick(m.result,['winner','margin']):'',...(m.playerMode?{playerMode:true,squads:Object.fromEntries([m.teamA,m.teamB].map(t=>[t,m.squads[t].map(p=>pick(p,['id','name']))]))}:{}),innings:m.innings.map(i=>({...pick(i,['batting','bowling','runs','wickets','balls']),extras:pick(i.extras,['wide','noBall','bye','legBye']),...(m.playerMode?{lineup:lineup(i.lineup)}:{}),deliveries:i.deliveries.map(b=>({...pick(b,['kind','runs','runType','dismissal']),...(m.playerMode?{...pick(b,['striker','nonStriker','bowler','dismissed']),survivorFaces:Boolean(b.survivorFaces),boundary:Boolean(b.boundary),before:lineup(b.before)}:{})}))}))}))};
  return validateStore(clean);
}
export function centralSummary(d){
  const names=new Map(d.teams.map(t=>[t.id,t.name])), tournaments=new Map(d.tournaments.map(t=>[t.id,t.name]));
  const leaders=tournamentPlayerStats(d.matches,null), label=p=>({name:p.name,team:names.get(p.team),tournament:tournaments.get(p.tournamentId)});
  return {tournaments:d.tournaments.length,teams:d.teams.length,players:(d.players||[]).length,matches:d.matches.length,live:d.matches.filter(m=>['live','break'].includes(m.status)).length,completed:d.matches.filter(m=>m.status==='completed').length,
    batting:leaders.filter(p=>p.innings).sort((a,b)=>b.runs-a.runs).slice(0,10).map(p=>({...label(p),runs:p.runs,highest:p.highest,strikeRate:p.strikeRate})),
    bowling:leaders.filter(p=>p.bowlingInnings).sort((a,b)=>b.wickets-a.wickets||a.conceded-b.conceded).slice(0,10).map(p=>({...label(p),wickets:p.wickets,runs:p.conceded,overs:oversText(p.bowlingBalls),economy:p.economy}))};
}

