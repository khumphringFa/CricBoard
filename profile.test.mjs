import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStore,fingerprint} from './cloud.mjs';
const sample=()=>({tournaments:[{id:'cup',name:'Cup'}],teams:[{id:'team',name:'Team',tournamentId:'cup'}],players:[{id:'player',name:'Player',teamId:'team',tournamentId:'cup',profile:{role:'All-rounder',jersey:'7',batting:'Left-handed',bowling:'Off spin',bio:'Local cricketer'}}],matches:[],activeTournamentId:'cup',activeMatchId:null});
test('player profile survives backup validation and changes its sync fingerprint',async()=>{const original=sample(),restored=validateStore(original);assert.deepEqual(restored.players[0].profile,original.players[0].profile);restored.players[0].profile.jersey='8';assert.notEqual(await fingerprint(restored),await fingerprint(original));});
test('legacy players remain valid and malformed profiles are rejected',()=>{const legacy=sample();delete legacy.players[0].profile;assert.doesNotThrow(()=>validateStore(legacy));for(const profile of [null,[],{role:'Invalid'},{jersey:'-1'},{bio:'a'.repeat(241)}]){const data=sample();data.players[0].profile=profile;assert.throws(()=>validateStore(data));}});
