import type { AnyEvent, EventPayloads, EventType } from '../src/events';
export function obtEvent<T extends EventType>(id: string,type: T,payload: EventPayloads[T],actorId='t',clock=1): AnyEvent {
  return { id,type,payload,actorId,orgId:'O',projectId:'P',deviceId:'test',hlc:`${String(clock).padStart(15,'0')}:000000:test` } as AnyEvent;
}
export const obtScope = { unitId:'U',laneId:'L' };
export function buildObtFixture(): AnyEvent[] {
  const e=obtEvent, s=obtScope;
  return [
    e('mt','v1.MemberAdded',{profileId:'t',role:'translator'}),
    e('mc','v1.MemberAdded',{profileId:'c',role:'coordinator'}),
    e('mo','v1.MemberAdded',{profileId:'o',role:'owner'}),
    e('mr','v1.MemberAdded',{profileId:'r',role:'reviewer'}),
    e('lane','v1.LaneAdded',{laneId:'L',languoidId:'target'}),
    e('unit','v1.UnitAdded',{unitId:'U',parentUnitId:null,kind:'passage',label:'Mark 1',order:'0'}),
    e('flow','v1.LaneFlowSelected',{laneId:'L',flowId:'spoken_worldwide',catalogVersion:1}),
    e('policy','v1.ObtPolicySet',{laneId:'L',consultantRole:'coordinator',finalRole:'owner',minimumInteractions:1},'o'),
    ...['draft','bt','final'].flatMap((id,i)=>[
      e(id+'-audio','v1.RecordingAdded',{...s,recordingId:id,kind:'target',cards:[{hash:String(i+1).repeat(64),durationMs:1000,format:'wav'}]}),
      e(id,'v1.TakeComposed',{...s,takeId:id,cardHashes:[String(i+1).repeat(64)],parentTakeId:null})
    ]),
    e('round','v1.ObtRoundStarted',{...s,roundId:'round',firstDraftId:'draft',previousRoundId:null}),
    e('clip','v1.ObtAudioAdded',{...s,clipId:'clip',cards:[{hash:'a'.repeat(64),durationMs:2000,format:'m4a'}]}),
    e('interaction','v1.ObtInteractionSet',{...s,interactionId:'interaction',roundId:'round',draftId:'draft',participantName:'Listener',comments:'Meaning understood',clipIds:['clip'],photoHash:'b'.repeat(64)},'r'),
    e('community','v1.ObtStepRecorded',{...s,roundId:'round',step:'community',inputId:'round',decision:'complete'},'r'),
    e('revision','v1.ObtStepRecorded',{...s,roundId:'round',step:'revision',inputId:'community',decision:'complete',takeId:'draft'}),
    e('back','v1.ObtStepRecorded',{...s,roundId:'round',step:'back_translation',inputId:'revision',decision:'complete',takeId:'bt',language:'English'},'c'),
    e('consultant','v1.ObtStepRecorded',{...s,roundId:'round',step:'consultant',inputId:'back',decision:'approve',clipIds:['clip']},'c'),
    e('final-record','v1.ObtStepRecorded',{...s,roundId:'round',step:'final_recording',inputId:'consultant',decision:'complete',takeId:'final'}),
    e('final-approve','v1.ObtStepRecorded',{...s,roundId:'round',step:'final_approval',inputId:'final-record',decision:'approve'},'o')
  ];
}
