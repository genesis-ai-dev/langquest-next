import { deriveBlockers } from '../src/blockers';
import { fold } from '../src/reducer';
import { deriveObt, assertObtStep, validateObt } from '../src/obt';
import { deriveTasks, deriveTasksFor } from '../src/tasks';
import { passageRow, tasksFromRow } from '../src/readModels';
import { derivePieces } from '../src/status';
import { deriveTakeStatus } from '../src/workflow';
import { referencedBlobs, deriveDownloadWork } from '../src/blobs';
import { commands } from '../src/commands';
import { buildObtFixture, obtEvent as e, obtScope as scope } from './obtFixtures';
import { shuffle } from './fixtures';

const fixture=buildObtFixture();
describe('Spoken Worldwide workflow',()=>{
  it('requires each stage in order, including an explicit unchanged revision',()=>{
    const steps=['round','community','revision','back','consultant','final-record','final-approve'];
    const stages=['first_draft','community','revision','back_translation','consultant','final_recording','final_approval','complete'];
    for(let n=0;n<=steps.length;n++) {
      const state=fold(fixture.filter(x=>!steps.slice(n).includes(x.id)));
      expect(deriveObt(state,'U','L').stage).toBe(stages[n]);
    }
    const state=fold(fixture);
    expect(deriveTakeStatus(state,'draft').outcome).not.toBe('approved');
    expect(deriveTakeStatus(state,'final').outcome).toBe('approved');
    expect(derivePieces(state,'L')[0]?.status).toBe('done');
  });
  it('converges under arbitrary delivery and duplication for every OBT event',()=>{
    const events=[...fixture,e('workspace','v1.ObtWorkspaceCreated',{unitId:'isolated',laneId:'isolated',inputTakeId:'input',language:'English'},'c')];
    const expected=fold(events);
    for(let seed=1;seed<=100;seed++) expect(fold([...shuffle(events,seed),...shuffle(events,seed+1)])).toEqual(expected);
  });
  it('invalidates downstream evidence when a revised draft is resubmitted',()=>{
    const state=fold([...fixture,e('new-revision','v1.ObtStepRecorded',{...scope,roundId:'round',step:'revision',inputId:'community',decision:'complete',takeId:'draft'},'t',2)]);
    expect(deriveObt(state,'U','L').stage).toBe('back_translation');
    expect(deriveTakeStatus(state,'final').outcome).not.toBe('approved');
    expect(Object.keys(state.obt.steps)).toHaveLength(7);
  });
  it('returns consultant changes to revision and final delivery changes to recording',()=>{
    const consultant=e('redo','v1.ObtStepRecorded',{...scope,roundId:'round',step:'consultant',inputId:'back',decision:'changes_requested'},'c',2);
    expect(deriveObt(fold([...fixture,consultant]),'U','L').stage).toBe('revision');
    const final=e('redo-final','v1.ObtStepRecorded',{...scope,roundId:'round',step:'final_approval',inputId:'final-record',decision:'changes_requested'},'o',2);
    expect(deriveObt(fold([...fixture,final]),'U','L').stage).toBe('final_recording');
  });
  it('does not count forged approvals, cross-passage takes or mismatched back translations',()=>{
    const state=fold(fixture.filter(x=>x.id!=='final-approve'));
    expect(()=>assertObtStep(state,'t',{...scope,roundId:'round',step:'final_approval',inputId:'final-record',decision:'approve'})).toThrow(/another role/);
    const wrong=e('wrong','v1.ObtStepRecorded',{...scope,roundId:'round',step:'back_translation',inputId:'revision',decision:'complete',takeId:'draft',language:'English'},'c',2);
    expect(deriveObt(fold([...fixture,wrong]),'U','L').stage).toBe('back_translation');
  });
  it('keeps every draft attempt and includes community audio and photos offline',()=>{
    const state=fold(fixture);
    const specs=commands(state).keepTake({commandId:'keep',...scope,cardHashes:['c'.repeat(64)]});
    expect(specs.some(x=>x.type==='v1.TakeArchived')).toBe(false);
    expect(referencedBlobs(state).get('b'.repeat(64))?.format).toBe('jpg');
    for(const hash of referencedBlobs(state).keys()) state.blobs[hash]={size:1,hlc:'',eventId:hash,stored:true};
    const files=deriveDownloadWork(state,new Set(),new Set(['U']));
    expect(files.some(x=>x.hash==='b'.repeat(64))).toBe(true);
    expect(files.some(x=>x.hash==='a'.repeat(64))).toBe(true);
  });
  it('has identical task results through persisted rows and direct derivation',()=>{
    for(let n=0;n<fixture.length;n++) {
      const state=fold(fixture.slice(0,n));
      if(!state.lanes.L || !state.units.U) continue;
      for(const actor of ['t','c','o','r']) {
        expect(tasksFromRow(passageRow(state,'U','L'),actor,state.members[actor]!.role.value)).toEqual(deriveTasksFor(state,actor,'U','L'));
      }
    }
    const state=fold(fixture.filter(x=>x.id!=='final-approve'));
    expect(deriveTasks(state,'o')[0]?.done).toBe(false);
    expect(deriveTasks(state,'t')[0]?.done).toBe(true);
  });
  it('reports the configured approval role when nobody can complete a stage',()=>{
    const state=fold([...fixture.filter(x=>x.id!=='final-approve'),e('remove-owner','v1.MemberRemoved',{profileId:'o'},'o',2)]);
    expect(deriveBlockers(state)).toContainEqual(expect.objectContaining({kind:'role_unfilled',stepId:'final_approval'}));
  });
  it('rejects malformed payloads without breaking the fold',()=>{
    expect(validateObt('v1.ObtStepRecorded',{...scope,roundId:'round',step:'final_approval',inputId:'x',decision:'complete'})).toMatch(/decision/);
    const bad={...fixture.find(x=>x.id==='clip')!,id:'bad',payload:{...scope,clipId:'bad',cards:[{hash:'no',durationMs:-1}]}} as never;
    expect(fold([bad]).invalidEvents.bad).toBeTruthy();
  });
});
