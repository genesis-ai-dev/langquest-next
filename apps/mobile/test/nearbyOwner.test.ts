import { nearbyOwnerOf } from '../src/nearby/nearbyOwner';

/**
 * One owner for the phone's one radio (src/nearby/nearbyOwner.ts; docs/nearby-sync-plan.md 15.6).
 * Why: Share nearby and sharing while LangQuest is open each run a room on the same radio, and a
 * stop still finishing could turn off radios the other had just turned on, or two rooms could run.
 */

const tick = () => new Promise<void>((done) => { setTimeout(done, 0); });

describe('the radios\' owner', () => {
  it('a claim stops the quiet room before anything the screen asks next, and the claim holds until let go', async () => {
    const owner = nearbyOwnerOf();
    const log: string[] = [];
    let release!: () => void;
    const slowStop = new Promise<void>((done) => { release = done; });
    owner.quiet(async () => { log.push('quiet stopping'); await slowStop; log.push('quiet stopped'); });
    const heard: boolean[] = [];
    owner.subscribe(() => heard.push(owner.claimed()));
    const letGo = owner.claim();
    expect(owner.claimed()).toBe(true);
    const screen = owner.turn(async () => { log.push('screen starts'); });
    await tick();
    expect(log).toEqual(['quiet stopping']);
    release();
    await screen;
    expect(log).toEqual(['quiet stopping', 'quiet stopped', 'screen starts']);
    letGo();
    letGo();
    expect(owner.claimed()).toBe(false);
    expect(heard).toEqual([true, false]);
  });

  it('a quiet room that stopped by other means is forgotten, and forgetting an older one leaves a newer one', async () => {
    const owner = nearbyOwnerOf();
    const stopped: string[] = [];
    const forgetOld = owner.quiet(async () => { stopped.push('old'); });
    const forgetNew = owner.quiet(async () => { stopped.push('new'); });
    forgetOld();
    owner.claim()();
    await owner.turn(async () => undefined);
    expect(stopped).toEqual(['new']);
    const forget = owner.quiet(async () => { stopped.push('gone'); });
    forget();
    forgetNew();
    owner.claim()();
    await owner.turn(async () => undefined);
    expect(stopped).toEqual(['new']);
  });

  it('a claim with no quiet room running stops nothing, and a second claim does not stop it twice', async () => {
    const owner = nearbyOwnerOf();
    let stops = 0;
    const a = owner.claim();
    owner.quiet(async () => { stops += 1; });
    const b = owner.claim();
    const c = owner.claim();
    await owner.turn(async () => undefined);
    expect(stops).toBe(1);
    a(); b();
    expect(owner.claimed()).toBe(true);
    c();
    expect(owner.claimed()).toBe(false);
  });

  it('a screen that drives the radio itself waits until the quiet room its claim stopped has stopped', async () => {
    const owner = nearbyOwnerOf();
    const log: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((done) => { release = done; });
    owner.quiet(async () => { await slow; log.push('quiet stopped'); });
    owner.claim();
    const waiting = owner.settled().then(() => log.push('screen starts'));
    await tick();
    expect(log).toEqual([]);
    release();
    await waiting;
    expect(log).toEqual(['quiet stopped', 'screen starts']);
  });

  it('runs every start and stop one at a time, in the order asked, and one that fails holds up nothing', async () => {
    const owner = nearbyOwnerOf();
    const log: string[] = [];
    let running = 0;
    let most = 0;
    const step = (name: string, fail = false) => owner.turn(async () => {
      running += 1;
      most = Math.max(most, running);
      await tick();
      log.push(name);
      running -= 1;
      if (fail) throw new Error(name);
    });
    const done = Promise.allSettled([step('quiet stop'), step('screen start', true), step('screen stop'), step('quiet start')]);
    const results = await done;
    expect(log).toEqual(['quiet stop', 'screen start', 'screen stop', 'quiet start']);
    expect(most).toBe(1);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });
});
