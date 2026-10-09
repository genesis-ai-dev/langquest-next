import { chapterStage, chapterTone, type PassageFacts } from '../src/canon';
import { EDGES } from '../src/flow';
import { edgeAllowed, tabsFor } from '../src/session';
import { nextSub, readiness, readySteps, workIcon, workSub, workTarget, workWhat } from '../src/simple/homeModel';
import { offlineCount } from '../src/simple/meModel';
import { roleSession } from './sessions';

describe('the simple My Work (decision 71)', () => {
  it('asks the four questions in order, and Get ready names the first one not answered', () => {
    // Why: the coordinator's Home leads with the next question until the
    // language is ready (demo ADR-039); the Get ready screen opens at it by number.
    const none = readiness(readySteps({ template: false, helps: 0, flow: false, members: 1 }));
    expect(none).toMatchObject({ done: 0, total: 4, step: 1 });
    expect(none.next?.question).toBe('What will they record?');

    const helps = readiness(readySteps({ template: true, helps: 0, flow: true, members: 3 }));
    expect(helps).toMatchObject({ done: 3, step: 2 });
    expect(helps.next?.question).toBe('What will help them?');

    const team = readiness(readySteps({ template: true, helps: 2, flow: true, members: 1 }));
    expect(team.next?.id).toBe('invite');
    expect(team.step).toBe(4);

    const ready = readiness(readySteps({ template: true, helps: 1, flow: true, members: 2 }));
    expect(ready).toMatchObject({ done: 4, next: null, step: 0 });
  });

  it('opens the right screen for each kind: recording and feedback open the passage', () => {
    expect(workTarget('record')).toBe('passage');
    expect(workTarget('draft')).toBe('passage');
    expect(workTarget('respond')).toBe('passage');
    expect(workTarget('review')).toBe('review');
    expect(workTarget('produce')).toBe('back_translation');
  });

  it('reads each row by its tile: mic, amber chat, check, globe', () => {
    expect(workIcon('record')).toEqual({ icon: 'mic', tone: 'brand' });
    expect(workIcon('respond')).toEqual({ icon: 'chat', tone: 'amber' });
    expect(workIcon('review').icon).toBe('check');
    expect(workIcon('produce').icon).toBe('globe');
  });

  it('says what to do in few words, the due date before who asked', () => {
    expect(workWhat('respond')).toBe('Feedback to hear');
    expect(workWhat('review', 'Community Check')).toBe('Community Check');
    expect(workSub('Record')).toBe('Record');
    expect(workSub('Record', { by: 'Mary', due: 'due Oct 11' })).toBe('Record · due Oct 11');
    expect(workSub('Community Check', { by: 'Abebe' })).toBe('Community Check · asked by Abebe');
    // The Next card has room for both.
    expect(nextSub('record', 'Record', { by: 'Mary', due: 'due Oct 11' })).toBe('Record it · asked by Mary · due Oct 11');
  });
});

describe('the simple tabs (decision 71)', () => {
  it('are Work, Map, Manage for admins, and Me; the bell replaces the Inbox', () => {
    expect(tabsFor(roleSession('translator')).map((t) => t.label)).toEqual(['Work', 'Map', 'Me']);
    expect(tabsFor(roleSession('coordinator')).map((t) => t.label)).toEqual(['Work', 'Map', 'Manage', 'Me']);
    // Work carries no count: the bell has the unread count, My Work leads with the next thing.
    expect(tabsFor(roleSession('translator'), { forYou: 3, unread: 2 }).find((t) => t.id === 'work')?.badge).toBeUndefined();
    expect(tabsFor(roleSession('translator')).find((t) => t.id === 'me')?.screen).toBe('settings_home');
  });

  it('keeps everything Settings had one tap under Me', () => {
    // Why: Me shows five rows; More settings holds the rest (profile, switching
    // organization, sync, diagnostics, deleting the account), so nothing is lost.
    const s = roleSession('translator');
    for (const to of ['settings_more', 'profile_edit', 'sync_status', 'mic_setup', 'vision', 'sign_out_confirm'] as const) {
      expect(EDGES.some((e) => e.from === 'settings_home' && e.to === to && edgeAllowed(e, s)), to).toBe(true);
    }
    for (const to of ['org_switcher', 'sync_status', 'delete_account', 'profile_edit'] as const) {
      expect(EDGES.some((e) => e.from === 'settings_more' && e.to === to && edgeAllowed(e, s)), to).toBe(true);
    }
  });

  it('lets someone who admits people open a join request from My Work, and nobody else', () => {
    const edge = EDGES.find((e) => e.from === 'my_work' && e.to === 'edit_member')!;
    expect(edgeAllowed(edge, roleSession('coordinator'))).toBe(true);
    expect(edgeAllowed(edge, roleSession('translator'))).toBe(false);
  });
});

describe('the simple Map (decision 71)', () => {
  const s = (o: Partial<PassageFacts>): PassageFacts => ({ recorded: false, done: false, drafting: false, awaitingResponse: [], openRequests: [], ...o });

  it('shows a chapter in three states: done, started, not started', () => {
    expect(chapterStage(chapterTone([s({ recorded: true, done: true })]))).toBe('done');
    expect(chapterStage(chapterTone([s({ drafting: true })]))).toBe('started');
    expect(chapterStage(chapterTone([s({ recorded: true })]))).toBe('started');
    expect(chapterStage(chapterTone([s({ recorded: true, awaitingResponse: [1] })]))).toBe('started');
    // Part done, part not: started, not done.
    expect(chapterStage(chapterTone([s({ recorded: true, done: true }), s({})]))).toBe('started');
    expect(chapterStage(chapterTone([s({})]))).toBe('new');
    expect(chapterStage(chapterTone([]))).toBe('none');
  });
});

describe('Me (decision 71)', () => {
  it('says how many passages are on this device, in the fewest words', () => {
    expect(offlineCount(null)).toBe('Checking this device…');
    expect(offlineCount({ kept: 0, ready: 0 })).toBe('No passages kept on this device yet');
    expect(offlineCount({ kept: 12, ready: 12 })).toBe('12 passages on this device');
    expect(offlineCount({ kept: 1, ready: 1 })).toBe('1 passage on this device');
    expect(offlineCount({ kept: 12, ready: 5 })).toBe('5 of 12 passages ready on this device');
  });
});
