import { describe, expect, it } from 'vitest';
import { pickTutorialLink, tutorialLinkUrls, type LinkVideo } from '../src';

const sha = 'a'.repeat(64);
const video = (extra: Partial<LinkVideo> = {}): LinkVideo => ({ tutorial: 'record-a-passage', sha256: sha, youtube: true, ...extra });

describe('pickTutorialLink', () => {
  it('links the video of the screen', () => {
    expect(pickTutorialLink('workspace', [video()])).toEqual({ tutorial: 'record-a-passage', sha256: sha, youtube: true });
  });
  it('shows nothing for a screen with no video, or when the language has none', () => {
    expect(pickTutorialLink('sync_status', [video()])).toBeNull();
    expect(pickTutorialLink('workspace', [])).toBeNull();
    expect(pickTutorialLink('workspace', [video({ tutorial: 'your-account' })])).toBeNull();
  });
  it('leaves out a video made for another store build', () => {
    expect(pickTutorialLink('workspace', [video({ runtimes: ['r2'] })], { runtime: 'r1' })).toBeNull();
    expect(pickTutorialLink('workspace', [video({ runtimes: ['r1', 'r2'] })], { runtime: 'r1' })).not.toBeNull();
  });
  it('leaves out a video filmed from a newer update than the phone runs', () => {
    expect(pickTutorialLink('workspace', [video({ filmedFrom: 200 })], { updatedAt: 100 })).toBeNull();
    expect(pickTutorialLink('workspace', [video({ filmedFrom: 200 })], { updatedAt: 200 })).not.toBeNull();
  });
  it('a browser, which names no build, gets any video', () => {
    expect(pickTutorialLink('workspace', [video({ filmedFrom: 200, runtimes: ['r2'] })])).not.toBeNull();
  });
  it('builds the lasting links, with no watch link until it is on YouTube', () => {
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: false })).toEqual({ download: 'https://x/v/es/t.mp4', watch: null });
    expect(tutorialLinkUrls('https://x', 'es', { tutorial: 't', sha256: sha, youtube: true }).watch).toBe('https://x/v/es/t');
  });
});
