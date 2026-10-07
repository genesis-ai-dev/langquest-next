import { pathFor, SECTION_PATHS, sectionOfPath, titleFor } from '../src/webPaths';

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
