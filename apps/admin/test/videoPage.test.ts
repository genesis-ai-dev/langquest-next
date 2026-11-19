import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { VIDEO_LOGIC, VIDEO_SCRIPT } from '../src/pageVideos';
import type { AdminItem, Mark, VideoRow, Videos } from '../src/sources/videos';

// The Tutorial videos page's first part (pageVideos.ts): tabs that open on what waits on the admin, marks that
// say what they are, and a reply that a person copies and posts
// (docs/decisions/2026-11-19-the-tutorial-videos-page-opens-on-what-waits-on-you.md).

/** The page's own logic, as it runs there (pageVideos.ts VIDEO_LOGIC). */
const logic = new Function(`${VIDEO_LOGIC}; return { VIDEO_TABS, videoTabs, markKind, markClass, markName, marksShown, rowMark };`)() as {
  VIDEO_TABS: [string, string][];
  videoTabs: (d: Videos, chosen: string | null) => { you: AdminItem[]; claude: AdminItem[]; paused: AdminItem[]; count: Record<string, number>; tab: string };
  markKind: (m: Partial<Mark>) => string;
  markClass: (m: Partial<Mark>) => string;
  markName: (m: Partial<Mark>) => string;
  marksShown: (rows: { marks: Partial<Mark>[] }[]) => { cls: string; kind: string; name: string }[];
  rowMark: (v: Pick<VideoRow, 'states'>, cards: Pick<AdminItem, 'who'>[]) => string;
};

const card = (kind: AdminItem['kind'], who: AdminItem['who'], over: Partial<AdminItem> = {}): AdminItem => ({ kind, who, title: kind, detail: '', at: null, next: '', ...over });
const board = (over: Partial<Videos> = {}): Videos => ({ languages: [], videos: [], admin: [], worker: [], changes: [], missing: [], ...over });
const video = (states: VideoRow['states'], marks: Mark[] = []): VideoRow => ({ tutorial: 'a', language: 'en', title: 'A', states, film: null, marks });

describe('the tabs of the Tutorial videos page', () => {
  it('counts what waits on the admin, what goes on by itself, the videos and the changes', () => {
    const d = board({
      admin: [card('reply', 'you'), card('fixFailed', 'you'), card('held', 'claude'), card('paused', 'you')],
      worker: [{ when: 'now', kind: 'filming', title: 'Filming en now', detail: '' }, { when: 'next', kind: 'comments', title: 'Claude reads 2', detail: '' }],
      videos: [video([{ key: 'current', text: 'Up to date', level: 'good' }])],
      changes: [{ at: '2026-11-19T00:00:00Z', tutorial: 'a', language: 'en', video: 'A', change: 'x', by: 'claude', state: 'merged', pr: 1, link: null, note: null, pictures: [], after: [] }]
    });
    const t = logic.videoTabs(d, null);
    expect(t.count).toEqual({ you: 2, auto: 3, videos: 1, changes: 1 });
    expect(t.you.map((a) => a.kind)).toEqual(['reply', 'fixFailed']);
    expect(t.claude.map((a) => a.kind)).toEqual(['held']);
    // Paused languages are a standing state, not a thing to answer: they are said under All videos.
    expect(t.paused.map((a) => a.kind)).toEqual(['paused']);
  });

  it('opens on what waits on the admin, on the videos when nothing does, and stays on a tab once chosen', () => {
    expect(logic.videoTabs(board({ admin: [card('reply', 'you')] }), null).tab).toBe('you');
    expect(logic.videoTabs(board({ admin: [card('held', 'claude'), card('paused', 'you')] }), null).tab).toBe('videos');
    expect(logic.videoTabs(board(), 'changes').tab).toBe('changes');
    // The last thing answered: the tab stays, and says that nothing waits.
    expect(logic.videoTabs(board(), 'you').tab).toBe('you');
    expect(logic.videoTabs(board({ admin: [card('reply', 'you')] }), 'nonsense').tab).toBe('you');
    expect(logic.VIDEO_TABS.map((t) => t[1])).toEqual(['Waits on you', 'Automatic', 'All videos', 'Changes made']);
  });
});

describe('the marks of a timeline', () => {
  const mark = (kind: Mark['kind'], cause?: string): Partial<Mark> => ({ kind, ...(cause ? { cause } : {}) });

  it('gives each kind of thing a name, and a picture and colour by its kind', () => {
    expect(logic.markName(mark('film', 'app'))).toBe('New film: an app screen changed');
    expect(logic.markName(mark('film', 'new'))).toBe('First film');
    expect(logic.markName(mark('film'))).toBe('New film');
    expect(logic.markName(mark('up'))).toBe('Put on YouTube');
    expect(logic.markName(mark('comment'))).toBe('Comment on YouTube');
    expect(logic.markName(mark('decided', 'rejected'))).toBe('Suggestion rejected');
    expect(logic.markName(mark('decided', 'accepted'))).toBe('Suggestion accepted');
    expect(logic.markName(mark('decided'))).toBe('Suggestion accepted');
    expect(logic.markName(mark('fix', 'failed'))).toBe('Claude\'s change to the video, failed');
    expect(logic.markName(mark('held'))).toBe('New film held back');
    expect(logic.markClass(mark('film', 'script'))).toBe('film script');
    expect(logic.markClass(mark('fix', 'merged'))).toBe('fix merged');
    expect(logic.markClass(mark('decided', 'rejected'))).toBe('rejected');
    expect(logic.markClass(mark('comment'))).toBe('comment');
  });

  it('puts in the key only the kinds the shown rows have, each once', () => {
    const rows = [{ marks: [mark('up'), mark('film', 'new'), mark('film', 'new')] }, { marks: [mark('comment'), mark('film', 'app'), mark('fix', 'failed'), mark('fix', 'merged')] }];
    expect(logic.marksShown(rows).map((k) => k.name)).toEqual(['New film: an app screen changed', 'First film', 'Put on YouTube', 'Comment on YouTube', 'Claude\'s change to the video']);
    expect(logic.marksShown(rows).map((k) => k.cls)).toEqual(['film app', 'film new', 'up', 'comment', 'fix']);
    expect(logic.marksShown([{ marks: [] }])).toEqual([]);
  });

  it('draws a picture for every kind of mark and of row, with its name in words for a screen reader', () => {
    const shapes = /const VSHAPE = \{([\s\S]*?)\n\};/.exec(VIDEO_SCRIPT)![1]!;
    for (const k of ['film', 'up', 'comment', 'suggested', 'accepted', 'rejected', 'fix', 'held', 'failed', 'good', 'you', 'bad', 'info', 'paused']) expect(shapes, k).toMatch(new RegExp(`\\b${k}: '<`));
    expect(VIDEO_SCRIPT).toContain('aria-label="\' + esc(says) + \'"');
  });
});

describe('a video\'s row', () => {
  it('marks first what waits on the admin, then a held or failing film, then a worker, a pause, or nothing to do', () => {
    const good = { states: [{ key: 'current' as const, text: 'Up to date', level: 'good' as const }] };
    expect(logic.rowMark(good, [])).toBe('good');
    expect(logic.rowMark(good, [{ who: 'you' }])).toBe('you');
    expect(logic.rowMark({ states: [{ key: 'held', text: 'Film held', level: 'bad' }] }, [{ who: 'claude' }])).toBe('bad');
    expect(logic.rowMark({ states: [{ key: 'slotted', text: 'Screen changed', level: 'info' }] }, [{ who: 'claude' }])).toBe('info');
    expect(logic.rowMark({ states: [{ key: 'paused', text: 'Language paused', level: 'warn' }] }, [])).toBe('paused');
  });
});

describe('the page', () => {
  it('has the tabs, a reply\'s two steps and Try again, and posts nothing to YouTube itself', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    for (const f of ['function videosHtml(', 'function videoRows(', 'function replyBox(', 'function commentSaid(', 'function retryButton(', 'data-reply-copy', 'data-reply-done', 'data-retry', 'data-vtab']) expect(html).toContain(f);
    // The reply goes out by a person's own hand on YouTube (decisions.md 186): the page copies it, opens the comment, and records Done.
    expect(html).toContain("kind: 'tutorial-reply'");
    expect(html).toContain("window.open(copy.dataset.href, '_blank', 'noopener')");
    expect(html).not.toMatch(/googleapis\.com\/youtube|comments\.insert/);
    // No screen id from the app's flow is written into the page.
    expect(html).not.toMatch(/my_work|settings_home/);
    expect(html).not.toMatch(/ style="/);
  });
});
