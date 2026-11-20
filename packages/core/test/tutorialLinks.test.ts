import { describe, expect, it } from 'vitest';
import { pickTutorialLinks, tutorialLinkUrls, type LinkVideo } from '../src';

const sha = 'a'.repeat(64);
const video = (extra: Partial<LinkVideo> = {}): LinkVideo => ({ tutorial: 'hear-move-delete-parts', sha256: sha, youtube: true, title: 'Hear, move and delete parts', ...extra });
const ids = (links: { tutorial: string }[]) => links.map((l) => l.tutorial);

describe('pickTutorialLinks', () => {
  const order = ['hear-move-delete-parts', 'give-each-part-its-verse', 'key-words'];
  it('links every video of the screen that the language has, best first', () => {
    expect(ids(pickTutorialLinks(order, [video({ tutorial: 'key-words' }), video()]))).toEqual(['hear-move-delete-parts', 'key-words']);
    expect(pickTutorialLinks(order, [video()])[0]).toEqual({ tutorial: 'hear-move-delete-parts', sha256: sha, youtube: true, title: 'Hear, move and delete parts' });
  });
  it('shows nothing for a screen with no video, or when the language has none', () => {
    expect(pickTutorialLinks([], [video()])).toEqual([]);
    expect(pickTutorialLinks(order, [])).toEqual([]);
    expect(pickTutorialLinks(order, [video({ tutorial: 'reports-on-the-web' })])).toEqual([]);
  });
  it('leaves out a video made for another store build', () => {
    expect(pickTutorialLinks(order, [video({ runtimes: ['r2'] })], { runtime: 'r1' })).toEqual([]);
    expect(ids(pickTutorialLinks(order, [video({ runtimes: ['r1', 'r2'] })], { runtime: 'r1' }))).toEqual(['hear-move-delete-parts']);
  });
  it('leaves out a video filmed from a newer update than the phone runs', () => {
    expect(pickTutorialLinks(order, [video({ filmedFrom: 200 })], { updatedAt: 100 })).toEqual([]);
    expect(pickTutorialLinks(order, [video({ filmedFrom: 200 })], { updatedAt: 200 })).toHaveLength(1);
  });
  it('a browser, which names no build, gets any video', () => {
    expect(pickTutorialLinks(order, [video({ filmedFrom: 200, runtimes: ['r2'] })])).toHaveLength(1);
  });
  it('builds the lasting links, with no watch link until it is on YouTube', () => {
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: false, title: 'T' })).toEqual({ download: 'https://x/v/es/t.mp4', watch: null });
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: true, title: 'T' }).watch).toBe('https://x/v/es/t');
  });
});
