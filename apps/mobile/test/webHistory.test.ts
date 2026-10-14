import { depthsToPush, entryAfterLoad, historyStep, pathFor, SECTION_PATHS, sectionOfPath, shouldFollowPop, titleFor } from '../src/webPaths';

// The web app's address and title (decisions.md 58): a section, never a screen's private params.

describe('web addresses', () => {
  it('names the section at the bottom of the stack, not the screen on top', () => {
    expect(pathFor([{ screen: 'reports_home' }, { screen: 'reports_language', params: { languageId: 'din' } }])).toBe('/reports');
    expect(pathFor([{ screen: 'my_work' }, { screen: 'passage_record', params: { unitId: 'u' } }])).toBe('/work');
    expect(pathFor([{ screen: 'sign_in' }])).toBe('/');
  });

  it('reads a section back from its path, and nothing else', () => {
    for (const [screen, path] of Object.entries(SECTION_PATHS)) expect(sectionOfPath(path)).toBe(screen);
    expect(sectionOfPath('/reports/')).toBe('reports_home');
    expect(sectionOfPath('/passage_record')).toBeNull();
    expect(sectionOfPath('/')).toBeNull();
  });

  it('every section path is distinct', () => {
    const paths = Object.values(SECTION_PATHS);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('titles the browser tab with the screen', () => {
    expect(titleFor('reports_home')).toBe('Reports · LangQuest');
  });
});

describe('the browser history the app keeps (WEB-016)', () => {
  it('adds one entry for each screen opened, numbered by depth', () => {
    expect(historyStep(1, 2)).toEqual({ push: [2], back: 0 });
    // Two screens opened before the history caught up: both get an entry, so Back goes through each.
    expect(historyStep(1, 3)).toEqual({ push: [2, 3], back: 0 });
  });

  it('goes back to the entry for the app depth when the app goes back by itself or a tab resets it', () => {
    expect(historyStep(3, 1)).toEqual({ push: [], back: 2 });
    expect(historyStep(2, 2)).toEqual({ push: [], back: 0 });
    expect(historyStep(1, 0)).toEqual({ push: [], back: 0 });
  });

  it('records every depth a jump skipped, so each screen has its own Back (WEB-016)', () => {
    expect(depthsToPush(1, 3)).toEqual([2, 3]);
    expect(depthsToPush(2, 3)).toEqual([3]);
    expect(depthsToPush(3, 3)).toEqual([]);
  });

  it('follows Back onto an entry that still carries this screen\'s depth (WEB-016)', () => {
    // Two entries were written for Version 1, both lq 3. Landing on the other one
    // must still leave the version; a strictly-shallower check stayed there.
    expect(shouldFollowPop(3, 3)).toBe(true);
    expect(shouldFollowPop(3, 2)).toBe(true);
    expect(shouldFollowPop(1, 1)).toBe(false);
  });

  it('clamps a reloaded entry instead of walking back to an older address (WEB-018)', () => {
    // Sync left lq 3; the reload is a new document whose stack is the section.
    expect(entryAfterLoad(3, 1)).toBe(1);
    expect(entryAfterLoad(1, 1)).toBeNull();
    expect(entryAfterLoad(2, 3)).toBeNull();
  });
});
