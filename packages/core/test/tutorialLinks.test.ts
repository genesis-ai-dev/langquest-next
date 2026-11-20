import { describe, expect, it } from 'vitest';
import { SCREEN_TUTORIALS, pickTutorialLinks, tutorialLinkUrls, type LinkVideo } from '../src';

const sha = 'a'.repeat(64);
const video = (extra: Partial<LinkVideo> = {}): LinkVideo => ({ tutorial: 'hear-move-delete-parts', sha256: sha, youtube: true, title: 'Hear, move and delete parts', ...extra });
const ids = (links: { tutorial: string }[]) => links.map((l) => l.tutorial);

describe('pickTutorialLinks', () => {
  it('links every video of the screen that the language has, best first', () => {
    const [first, second] = SCREEN_TUTORIALS.workspace!;
    expect(pickTutorialLinks('workspace', [video({ tutorial: second! }), video({ tutorial: first! })]).map((l) => l.tutorial)).toEqual([first, second]);
    expect(pickTutorialLinks('workspace', [video()])[0]).toEqual({ tutorial: 'hear-move-delete-parts', sha256: sha, youtube: true, title: 'Hear, move and delete parts' });
  });
  it('shows nothing for a screen with no video, or when the language has none', () => {
    expect(pickTutorialLinks('sync_status', [video()])).toEqual([]);
    expect(pickTutorialLinks('workspace', [])).toEqual([]);
    expect(pickTutorialLinks('workspace', [video({ tutorial: 'reports-on-the-web' })])).toEqual([]);
  });
  it('leaves out a video made for another store build', () => {
    expect(pickTutorialLinks('workspace', [video({ runtimes: ['r2'] })], { runtime: 'r1' })).toEqual([]);
    expect(ids(pickTutorialLinks('workspace', [video({ runtimes: ['r1', 'r2'] })], { runtime: 'r1' }))).toEqual(['hear-move-delete-parts']);
  });
  it('leaves out a video filmed from a newer update than the phone runs', () => {
    expect(pickTutorialLinks('workspace', [video({ filmedFrom: 200 })], { updatedAt: 100 })).toEqual([]);
    expect(pickTutorialLinks('workspace', [video({ filmedFrom: 200 })], { updatedAt: 200 })).toHaveLength(1);
  });
  it('a browser, which names no build, gets any video', () => {
    expect(pickTutorialLinks('workspace', [video({ filmedFrom: 200, runtimes: ['r2'] })])).toHaveLength(1);
  });
  it('builds the lasting links, with no watch link until it is on YouTube', () => {
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: false, title: 'T' })).toEqual({ download: 'https://x/v/es/t.mp4', watch: null });
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: true, title: 'T' }).watch).toBe('https://x/v/es/t');
  });
});
