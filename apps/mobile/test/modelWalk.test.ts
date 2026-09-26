import { commands, currentTake, deriveBlockers, deriveTakeStatus,
  HlcClock, type EventSpec, type AnyEvent } from '@langquest-next/core';
import { MemoryStore } from '../../../packages/client/src/memoryStore';
import { SyncClient } from '../../../packages/client/src/syncClient';
import { FakeServer } from '../../../packages/client/test/fakeServer';
import { EDGES, TAB_SCREENS, type ScreenId } from '../src/flow';
import { deriveSession, edgeAllowed, homeScreenFor } from '../src/session';
import { screenMayEmit } from '../src/screenContracts';

it('walks two devices through recording and review with randomized connection loss', async () => {
  for (let seed=1;seed<=12;seed++) {
    let randomState=seed;
    const random=() => ((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/2**32);
    const server=new FakeServer();
    let now=1_700_000_000_000;
    const device=(actorId:string) => {
      let id=0;
      return new SyncClient({ orgId:'walk',projectId:'p',actorId,deviceId:actorId,
        store:new MemoryStore(),transport:server.transportFor(),
        clock:new HlcClock(actorId,()=>++now),newId:()=>`${seed}:${actorId}:${++id}` });
    };
    const translator=device('translator'),reviewer=device('reviewer');
    await translator.load(); await reviewer.load();
    await translator.append('v1.ProjectCreated',{name:'Walk',sourceLanguoidId:'eng'});
    await translator.append('v1.ProjectConfigChanged',{config:{
      unitKinds:[{id:'passage',label:'Passage',childKinds:[]}],
      workflow:[{id:'review',role:'reviewer',required:true,rule:'any'}] }});
    await translator.append('v1.MemberAdded',{profileId:'translator',role:'translator'});
    await translator.append('v1.MemberAdded',{profileId:'reviewer',role:'reviewer'});
    await translator.append('v1.LaneAdded',{laneId:'L',languoidId:'xyz'});
    await translator.append('v1.UnitAdded',{unitId:'u',parentUnitId:null,kind:'passage',label:'Passage',order:'a'});
    await translator.append('v1.AssignmentMade',{unitId:'u',laneId:'L',profileId:'translator',role:'translator'});
    await translator.sync(); await reviewer.sync();
    const devices=[{client:translator,actor:'translator',screen:'my_work' as ScreenId},
      {client:reviewer,actor:'reviewer',screen:'my_work' as ScreenId}];
    let commandId=0;
    async function act(d: typeof devices[number], specs: EventSpec[]) {
      const session=deriveSession(d.actor,null,d.client.getState(),true);
      for (const spec of specs) {
        expect(screenMayEmit(d.screen,session,spec as AnyEvent),`${d.screen}:${spec.type}`).toBe(true);
        await d.client.append(spec.type,spec.payload);
      }
    }
    async function record() {
      const d=devices[0]!;
      d.screen='workspace';
      const id=`command-${seed}-${++commandId}`;
      await act(d,commands(d.client.getState()).addRecording({ commandId:id,
        recordingId:id,unitId:'u',laneId:'L',kind:'target',card:{hash:id,durationMs:100} }));
      await act(d,commands(d.client.getState()).keepTake({commandId:id,unitId:'u',laneId:'L',cardHashes:[id]}));
    }
    await record();
    for (let step=0;step<140;step++) {
      const d=devices[random()<0.5?0:1]!;
      server.offline=random()<0.55;
      const state=d.client.getState();
      const session=deriveSession(d.actor,null,state,true);
      const edges=EDGES.filter((edge)=>edge.from===d.screen && edgeAllowed(edge,session));
      if (random()<0.15 || !edges.length) d.screen=TAB_SCREENS[Math.floor(random()*TAB_SCREENS.length)]!;
      else {
        const edge=edges[Math.floor(random()*edges.length)]!;
        d.screen=edge.to==='home_hub'?homeScreenFor(session):edge.to;
      }
      const take=currentTake(state,'u','L');
      if (d.screen==='workspace' && d.actor==='translator' && random()<0.35) await record();
      else if (d.screen==='workspace' && d.actor==='translator' && take && deriveTakeStatus(state,take).outcome==='draft') {
        await act(d,commands(state).submitTake({commandId:`submit-${seed}-${++commandId}`,unitId:'u',laneId:'L',questionSetIds:[]}));
      }
      if (d.screen==='review_capture' && d.actor==='reviewer' && take && deriveTakeStatus(state,take).submitted) {
        await act(d,commands(state).reviewTake({commandId:`review-${seed}-${++commandId}`,takeId:take,
          stepId:'review',decision:random()<0.4?'suggest_changes':'approve'}));
      }
      if (random()<0.4) await d.client.sync();
      expect(deriveBlockers(d.client.getState())).toEqual([]);
    }
    // Finish the current take after reconnection. Both replicas must show
    // approval and empty outboxes, regardless of the preceding walk.
    server.offline=false;
    await translator.sync();await reviewer.sync();await translator.sync();
    let take=currentTake(translator.getState(),'u','L')!;
    if (deriveTakeStatus(translator.getState(),take).outcome==='draft') {
      devices[0]!.screen='workspace';
      await act(devices[0]!,commands(translator.getState()).submitTake({commandId:`finish-${seed}`,unitId:'u',laneId:'L',questionSetIds:[]}));
    }
    await translator.sync();await reviewer.sync();
    take=currentTake(reviewer.getState(),'u','L')!;
    devices[1]!.screen='review_capture';
    await act(devices[1]!,commands(reviewer.getState()).reviewTake({commandId:`approve-${seed}`,takeId:take,stepId:'review',decision:'approve'}));
    await reviewer.sync();await translator.sync();await reviewer.sync();
    expect(deriveTakeStatus(translator.getState(),take).outcome).toBe('approved');
    expect(translator.getState()).toEqual(reviewer.getState());
    expect(await translator.pendingCount()).toBe(0);
    expect(await reviewer.pendingCount()).toBe(0);
  }
});
