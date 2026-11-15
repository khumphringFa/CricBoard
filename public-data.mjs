import {validateStore} from './cloud.mjs';
import {standings, inningsScorecard, tournamentPlayerStats, oversText} from './engine.mjs';

// Only explicit, derived cricket statistics are published; never send the private store,
// actor ids, credentials, backup metadata, session data or player contact information.
export function publicTournament(input, includePlayers=false) {
  const data=validateStore(input);
  if(data.tournaments.length!==1) throw Error('Publish one tournament at a time.');
  const t=data.tournaments[0], names=new Map(data.teams.map(team=>[team.id,team.name]));
  const team=id=>names.get(id)||'Unknown team';
  const matches=data.matches.map(m=>({
    label:m.label||`${m.overs}-over match`,status:m.status,overs:m.overs,teamA:team(m.teamA),teamB:team(m.teamB),
    updatedAt:m.updatedAt,result:m.status==='completed'&&m.result?(m.result.winner?`${team(m.result.winner)} won by ${m.result.margin}`:m.result.margin):null,
    innings:m.innings.map(inn=>{
      const display={team:team(inn.batting),runs:inn.runs,wickets:inn.wickets,overs:oversText(inn.balls),extras:inn.extras.wide+inn.extras.noBall+inn.extras.bye+inn.extras.legBye};
      if(includePlayers&&m.playerMode){const card=inningsScorecard(m,inn);display.batting=card.batting.filter(p=>p.entered).map(p=>({name:p.name,runs:p.runs,balls:p.balls,fours:p.fours,sixes:p.sixes,strikeRate:p.strikeRate,status:p.dismissal?'Out':'Not out'}));display.bowling=card.bowling.filter(p=>p.used).map(p=>({name:p.name,overs:p.overs,maidens:p.maidens,runs:p.runs,wickets:p.wickets,economy:p.economy}));}
      return display;
    })
  }));
  const leaders=includePlayers?tournamentPlayerStats(data.matches,t.id):[];
  return {name:t.name,teams:data.teams.map(t=>t.name),matches,
    points:standings(data.matches,data.teams.map(t=>t.id)).map(p=>({team:team(p.id),played:p.played,won:p.won,lost:p.lost,tied:p.tied,points:p.points})),
    batting:leaders.filter(p=>p.innings).sort((a,b)=>b.runs-a.runs).map(p=>({name:p.name,team:team(p.team),runs:p.runs,balls:p.balls,highest:p.highest,strikeRate:p.strikeRate})),
    bowling:leaders.filter(p=>p.bowlingInnings).sort((a,b)=>b.wickets-a.wickets||a.conceded-b.conceded).map(p=>({name:p.name,team:team(p.team),overs:oversText(p.bowlingBalls),runs:p.conceded,wickets:p.wickets,economy:p.economy}))};
}
