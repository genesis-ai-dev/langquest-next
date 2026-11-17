import { describe, expect, it } from 'vitest';
import { causeOf, nightlyLanguages, videoBoard, videosSection, whyText, type FilmRow, type StatusFile, type VideosInput } from '../src/sources/videos';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const sha = (c: string) => c.repeat(64);

const film = (o: Partial<FilmRow> = {}): FilmRow => ({
  tutorial: 'record-a-passage', language: 'en', sha256: sha('a'), madeAt: at(48), chosenAt: at(47), publishedAt: at(40), youtubeId: 'dQw4w9WgXcQ',
  failed: null, failedAt: null, ...o
});
type V = StatusFile['videos'][number];
const status = (videos: Partial<V>[], o: Partial<StatusFile> = {}): StatusFile => ({
  language: 'en', commit: 'c'.repeat(40), at: at(10),
  videos: videos.map((v) => ({ tutorial: 'record-a-passage', title: 'Record a passage', tonight: 'same', film: { sha256: sha('a'), filmedAt: at(48), commit: null, why: [{ kind: 'new' }] }, why: [], slots: [], checked: [], ...v })),
  ...o
});
const feedback = (o: Partial<NonNullable<VideosInput['feedback']>> = {}): NonNullable<VideosInput['feedback']> => ({
  suggestions: [], inputs: [], waiting: 0, open: 0, unfiled: 0, last: null, videos: [{ tutorial: 'record-a-passage', title: 'Record a passage' }], ...o
});
const input = (o: Partial<VideosInput> = {}): VideosInput => ({
  films: [film()], feedback: feedback(), tutorials: { channels: [], waiting: [] }, status: { en: status([{}]) }, filming: null, nightly: ['en'], ...o
});
const suggestion = (o: Record<string, unknown> = {}) => ({
  id: 's1', kind: 'script' as const, tutorial: 'record-a-passage', title: 'Say "Language" in full', detail: 'Step 3 cuts the G.', madeAt: at(20), editedAt: null,
  decision: null, decidedAt: null, reason: null, issue: null, issueUrl: null, inputs: [], ...o
});
const en = (b: ReturnType<typeof videoBoard>) => b.videos.find((v) => v.language === 'en' && v.tutorial === 'record-a-passage')!;
const keys = (b: ReturnType<typeof videoBoard>) => en(b).states.map((s) => s.key);

describe('each video\'s state (decisions.md 186, amended 2026-11-13 and 2026-11-16)', () => {
  it('is up to date when nothing waits', () => {
    const b = videoBoard(input(), NOW);
    expect(keys(b)).toEqual(['current']);
    expect(en(b).film).toEqual({ madeAt: at(48), why: 'first film', up: true });
    expect(b.admin.filter((a) => a.kind !== 'paused')).toEqual([]);
  });

  it('puts a failing or held film first; Claude\'s next look fixes it, or an admin is asked', () => {
    const held = { en: status([{ tonight: 'held', held: ['a toast covers the button'] }]) };
    const b = videoBoard(input({ status: held }), NOW);
    expect(keys(b)[0]).toBe('held');
    expect(b.admin.find((a) => a.kind === 'held')).toMatchObject({ who: 'claude', detail: expect.stringContaining('a toast covers the button'), next: expect.stringContaining('Claude looks at it at 10:00 UTC') });
    // A look after the film that made nothing for it: an admin must say what to do.
    const last = { at: at(2), sha: 'f'.repeat(40), runUrl: 'https://github.com/r/9', looked: 1, suggested: 0, code: 0 };
    expect(videoBoard(input({ status: held, feedback: feedback({ last }) }), NOW).admin.find((a) => a.kind === 'held')).toMatchObject({ who: 'you' });
    // What that look made for it says the rest; a rejected one leaves it to an admin.
    const madeFor = suggestion({ kind: 'screen', madeAt: at(2), clear: true, decision: 'accepted', decidedAt: at(2) });
    expect(videoBoard(input({ status: held, feedback: feedback({ last, suggestions: [madeFor] }) }), NOW).admin.find((a) => a.kind === 'held')).toMatchObject({ who: 'claude' });
    expect(videoBoard(input({ status: held, feedback: feedback({ last, suggestions: [suggestion({ madeAt: at(2), decision: 'rejected', decidedAt: at(1) })] }) }), NOW)
      .admin.find((a) => a.kind === 'held')).toMatchObject({ who: 'you' });
    expect(en(b).marks.at(-1)).toMatchObject({ kind: 'held' });
    expect(keys(videoBoard(input({ status: { en: status([{ tonight: 'failed' }]) } }), NOW))[0]).toBe('fails');
  });

  it('follows a suggestion from approval to a fix merged', () => {
    const ask = videoBoard(input({ feedback: feedback({ suggestions: [suggestion()] }) }), NOW);
    expect(keys(ask)).toEqual(['approve']);
    expect(ask.admin[0]).toMatchObject({ kind: 'approve', suggestion: { id: 's1' } });

    const accepted = { decision: 'accepted', decidedAt: at(5) };
    expect(keys(videoBoard(input({ feedback: feedback({ suggestions: [suggestion(accepted)] }) }), NOW))).toEqual(['toFix']);
    const working = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'working', pr: null, at: at(4), run: 'https://github.com/r/1', note: null } })] }) }), NOW);
    expect(keys(working)).toEqual(['fixing']);
    expect(working.worker).toContainEqual(expect.objectContaining({ when: 'now', kind: 'fixing' }));
    // The pull request merges itself when its checks pass: no admin card, a worker item.
    const open = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'open', pr: 460, at: at(3), run: null, note: null } })] }) }), NOW);
    expect(en(open).states[0]).toMatchObject({ key: 'merge', level: 'info', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/460' });
    expect(open.admin.filter((a) => a.kind !== 'paused')).toEqual([]);
    expect(open.worker).toContainEqual(expect.objectContaining({ when: 'now', kind: 'merging', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/460' }));
    // Merged after last night's status: tonight films it.
    const merged = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'merged', pr: 460, at: at(2), run: null, note: null } })] }) }), NOW);
    expect(keys(merged)).toEqual(['tonight']);
    const failedFix = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'failed', pr: null, at: at(2), run: 'https://github.com/r/2', note: 'the script would not run' } })] }) }), NOW);
    expect(failedFix.admin[0]).toMatchObject({ kind: 'fixFailed', who: 'you', detail: 'the script would not run', link: 'https://github.com/r/2' });
    // Closed by the fix run (its checks failed, or it waited a day): the card opens the pull request.
    const closed = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'failed', pr: 461, at: at(1), run: 'https://github.com/r/3', note: 'Its checks failed (gate: failure), so the pull request is closed.' } })] }) }), NOW);
    expect(closed.admin[0]).toMatchObject({ kind: 'fixFailed', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/461' });
  });

  it('asks no one about a clear fix, and keeps a record of each change Claude made', () => {
    const clear = suggestion({ kind: 'screen', clear: true, madeAt: at(5), decision: 'accepted', decidedAt: at(5) });
    const b = videoBoard(input({ feedback: feedback({ suggestions: [clear] }) }), NOW);
    expect(en(b).states).toEqual([{ key: 'toFix', text: 'Clear fix, Claude starts it next', level: 'info' }]);
    expect(b.admin.filter((a) => a.kind !== 'paused')).toEqual([]);
    expect(b.languages.find((l) => l.language === 'en')).toMatchObject({ issues: 0 });
    expect(b.worker).toContainEqual(expect.objectContaining({ kind: 'toFix', detail: expect.stringContaining('Claude found it clear and accepted it itself') }));
    // One mark says it was suggested and accepted by Claude.
    expect(en(b).marks.map((m) => [m.kind, m.text])).toContainEqual(['decided', 'Clear fix, accepted by Claude: Say "Language" in full']);
    expect(en(b).marks.some((m) => m.kind === 'suggested')).toBe(false);

    const fix = (state: string, pr: number | null, hoursAgo: number, note: string | null = null) => ({ state, pr, at: at(hoursAgo), run: 'https://github.com/r/5', note });
    const record = videoBoard(input({ feedback: feedback({ suggestions: [
      suggestion({ id: 'a', ...clear, fix: fix('merged', 480, 4) }),
      suggestion({ id: 'b', decision: 'accepted', decidedAt: at(6), fix: fix('open', 481, 1) }),
      suggestion({ id: 'c', kind: 'instruction', detail: 'tap On this device', language: 'fr', decision: 'accepted', decidedAt: at(3), fix: fix('failed', 482, 2, 'It did not merge within 24 hours, so the pull request is closed.') }),
      suggestion({ id: 'd', ...clear, fix: fix('unneeded', null, 3, 'Step 3 already says Language.') })
    ] }) }), NOW).changes;
    expect(record.map((c) => [c.pr, c.by, c.state, c.language])).toEqual([[481, 'admin', 'open', 'en'], [482, 'instruction', 'failed', 'fr'], [null, 'claude', 'unneeded', 'en'], [480, 'claude', 'merged', 'en']]);
    expect(record[0]).toMatchObject({ video: 'Record a passage', change: 'Say "Language" in full', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/481' });
    expect(record[1]).toMatchObject({ change: 'tap On this device', note: expect.stringContaining('24 hours') });
    expect(record[2]).toMatchObject({ link: 'https://github.com/r/5', note: 'Step 3 already says Language.' });
  });

  it('shows the pictures Claude picked on the card, the marks and the record, and the same places after the fix (decisions.md 186, amended 2026-11-17)', () => {
    const picture = (n: number, c = 'e') => ({ picture: `${sha(c)}.png`, language: 'en', tutorial: 'record-a-passage', kind: 'step' as const, n, caption: `Step ${n}. The G is cut off.`, ring: [0.1, 0.2, 0.5, 0.1] as [number, number, number, number] });
    const ask = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ pictures: [picture(3)] })] }) }), NOW);
    expect(ask.admin[0]).toMatchObject({ kind: 'approve', pictures: [picture(3)] });
    expect(en(ask).marks.find((m) => m.kind === 'suggested')!.detail.pictures).toEqual([picture(3)]);
    // A fix that failed shows what it was about; one merged and filmed again shows before and after.
    const failed = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ pictures: [picture(3)], decision: 'accepted', decidedAt: at(6), fix: { state: 'failed', pr: null, at: at(2), run: 'https://github.com/r/5', note: 'No such step.' } })] }) }), NOW);
    expect(failed.admin.find((a) => a.kind === 'fixFailed')).toMatchObject({ pictures: [picture(3)] });
    const merged = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ pictures: [picture(3)], after: [picture(3, 'f')], decision: 'accepted', decidedAt: at(6), fix: { state: 'merged', pr: 480, at: at(4), run: null, note: null } })] }) }), NOW);
    expect(merged.changes[0]).toMatchObject({ pictures: [picture(3)], after: [picture(3, 'f')] });
    expect(en(merged).marks.find((m) => m.kind === 'fix')!.detail).toMatchObject({ pictures: [picture(3)], after: [picture(3, 'f')] });
    // Without pictures, none are said.
    const none = videoBoard(input({ feedback: feedback({ suggestions: [suggestion()] }) }), NOW);
    expect(none.admin[0]).not.toHaveProperty('pictures');
    expect(en(none).marks.find((m) => m.kind === 'suggested')!.detail).not.toHaveProperty('pictures');
  });

  it('shows a suggestion about one language\'s film on that language\'s row only', () => {
    const french = suggestion({ kind: 'voice', language: 'fr', decision: 'accepted', decidedAt: at(3), fix: { state: 'failed', pr: 482, at: at(2), run: null, note: 'no' } });
    const b = videoBoard(input({ films: [film(), film({ language: 'fr' })], nightly: ['en', 'fr'], status: { en: status([{}]), fr: status([{}], { language: 'fr' }) }, feedback: feedback({ suggestions: [french] }) }), NOW);
    expect(keys(b)).toEqual(['current']);
    expect(b.videos.find((v) => v.language === 'fr')!.states.map((s) => s.key)).toEqual(['fixFailed']);
    expect(b.admin.find((a) => a.kind === 'fixFailed')).toMatchObject({ language: 'fr' });
  });

  it('says nothing is left to do when the video already does what a fix asked', () => {
    const b = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ clear: true, decision: 'accepted', decidedAt: at(5), fix: { state: 'unneeded', pr: null, at: at(4), run: null, note: 'Step 3 already says Language.' } })] }) }), NOW);
    expect(keys(b)).toEqual(['current']);
    expect(b.admin.filter((a) => a.kind !== 'paused')).toEqual([]);
    expect(en(b).marks.find((m) => m.kind === 'fix')).toMatchObject({ text: 'Fix no change needed', detail: { lines: ['Say "Language" in full', 'Why: Step 3 already says Language.'] } });
  });

  it('says a screen change slots a video for tonight\'s check', () => {
    const slot = { sha: 'd'.repeat(40), pr: 455, subject: 'Merge pull request #455', screens: ['Language'] };
    const b = videoBoard(input({ status: { en: status([{ slots: [slot] }]) } }), NOW);
    expect(en(b).states[0]).toMatchObject({ key: 'slotted', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/455' });
    expect(b.worker).toContainEqual(expect.objectContaining({ kind: 'check', title: 'Tonight: check 1 video in en for screen changes' }));
    expect(b.admin).toContainEqual(expect.objectContaining({ kind: 'screen', who: 'claude', instruct: expect.stringContaining('PR 455') }));
  });

  it('shows comments not looked at, and replies to post for two weeks', () => {
    const comment = { id: 'c1', kind: 'comment' as const, tutorial: 'record-a-passage', language: 'en', at: at(30), ref: 'Ugx', youtubeId: 'dQw4w9WgXcQ', pr: null, text: 'The G is cut off', english: null, reply: null, replyEnglish: null, lookedAt: null, outcome: null };
    expect(keys(videoBoard(input({ feedback: feedback({ inputs: [comment], waiting: 1 }) }), NOW))).toEqual(['comment']);
    const replied = { ...comment, lookedAt: at(20), reply: 'Thanks, we fix it.', replyEnglish: 'Thanks, we fix it.' };
    const b = videoBoard(input({ feedback: feedback({ inputs: [replied] }) }), NOW);
    expect(keys(b)).toEqual(['reply']);
    expect(b.admin[0]).toMatchObject({ kind: 'reply', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=Ugx' });
    expect(keys(videoBoard(input({ feedback: feedback({ inputs: [{ ...replied, at: at(15 * 24) }] }) }), NOW))).toEqual(['current']);
  });

  it('says what waits for YouTube: a film to publish, or one chosen and waiting for the day\'s limit', () => {
    const newer = film({ sha256: sha('b'), madeAt: at(5), chosenAt: null, publishedAt: null, youtubeId: null });
    expect(keys(videoBoard(input({ films: [film(), newer] }), NOW))).toEqual(['publish']);
    const chosen = { ...newer, chosenAt: at(4) };
    const waiting = [{ tutorial: 'record-a-passage', language: 'en', sha256: sha('b'), title: 'Record a passage', playlist: 'Translators', seconds: 80, madeAt: at(5), chosenAt: at(4), failed: null, failedAt: null, replaces: 'dQw4w9WgXcQ' }];
    const b = videoBoard(input({ films: [film(), chosen], tutorials: { channels: [], waiting } }), NOW);
    expect(keys(b)).toEqual(['upload']);
    expect(b.worker).toContainEqual(expect.objectContaining({ kind: 'upload', title: 'Put 1 new film in en on YouTube' }));
  });

  it('pauses the languages not filmed each night, and says so once in the admin list', () => {
    const b = videoBoard(input({ films: [film(), film({ language: 'fr' })] }), NOW);
    expect(b.videos.find((v) => v.language === 'fr')!.states.map((s) => s.key)).toEqual(['paused']);
    expect(b.admin.filter((a) => a.kind === 'paused')).toHaveLength(1);
    expect(b.admin.find((a) => a.kind === 'paused')!.title).toBe('15 languages are paused');
  });

  it('counts in each language the videos that need a person, not the pause', () => {
    const b = videoBoard(input({ films: [film(), film({ language: 'fr' })], feedback: feedback({ suggestions: [suggestion()] }) }), NOW);
    expect(b.languages.find((l) => l.language === 'en')).toMatchObject({ nightly: true, issues: 1 });
    // A suggestion's card is on its film's language (English when it names none).
    expect(b.languages.find((l) => l.language === 'fr')).toMatchObject({ nightly: false, issues: 0 });
    expect(b.admin.find((a) => a.kind === 'approve')).toMatchObject({ tutorial: 'record-a-passage', language: 'en' });
    expect(b.languages.find((l) => l.language === 'es')).toMatchObject({ issues: 0 });
  });

  it('opens each mark\'s details: the change, the films to compare, the comment as written', () => {
    const app = { kind: 'screen' as const, steps: [3], screens: ['Language'], changes: [{ sha: 'e'.repeat(40), pr: 403, subject: 'Nearby sync' }] };
    const comment = { id: 'c1', kind: 'comment' as const, tutorial: 'record-a-passage', language: 'en', at: at(30), ref: 'Ugx', youtubeId: 'dQw4w9WgXcQ', pr: null, text: 'La G está cortada', english: 'The G is cut off', reply: null, replyEnglish: null, lookedAt: null, outcome: null };
    const b = videoBoard(input({
      films: [film(), film({ sha256: sha('b'), madeAt: at(3), chosenAt: null, publishedAt: null, youtubeId: null })], feedback: feedback({ inputs: [comment] }),
      status: { en: status([{ film: { sha256: sha('b'), filmedAt: at(3), commit: null, why: [app] } }]) }
    }), NOW);
    const newFilm = en(b).marks.find((m) => m.kind === 'film' && m.cause === 'app')!;
    expect(newFilm.detail.links[0]).toEqual({ text: 'App change: PR 403 (Nearby sync)', href: 'https://github.com/genesis-ai-dev/langquest-next/pull/403/files' });
    expect(newFilm.detail.films.map((f) => f.label)).toEqual(['This film', 'The film before']);
    expect(newFilm.detail.films[1]!.href).toBe(`/api/tutorials/en/record-a-passage/${sha('a')}.mp4`);
    expect(en(b).marks.find((m) => m.kind === 'comment')!.detail).toMatchObject({ quote: 'La G está cortada', lines: ['In English: The G is cut off', 'Claude has not looked at it yet.'] });
  });

  it('says who acts next on a failing film, and that Claude has the admin\'s instruction once sent', () => {
    const failing = input({ status: { en: status([{ tonight: 'failed' }]) } });
    const before = videoBoard(failing, NOW).admin.find((a) => a.kind === 'fails')!;
    expect(before).toMatchObject({ who: 'claude', instruct: expect.stringContaining('fails each night') });
    expect(before.next).toContain('Claude looks at it at 10:00 UTC');
    const looked = videoBoard({ ...failing, feedback: feedback({ last: { at: at(2), sha: 'f'.repeat(40), runUrl: 'https://github.com/r/9', looked: 1, suggested: 0, code: 0 } }) }, NOW).admin[0]!;
    expect(looked).toMatchObject({ kind: 'fails', who: 'you' });
    expect(looked.next).toContain('Each night fails again');
    const note = { id: 'n1', kind: 'note' as const, tutorial: 'record-a-passage', language: null, at: at(1), ref: null, youtubeId: null, pr: null,
      text: 'Instruction from an admin. ...\nClaude, do this: tap On this device', english: null, reply: null, replyEnglish: null, lookedAt: null, outcome: null };
    const after = videoBoard({ ...failing, feedback: feedback({ inputs: [note] }) }, NOW).admin.find((a) => a.kind === 'fails')!;
    expect(after).toMatchObject({ who: 'claude', instructed: { at: at(1), looked: false } });
    // Once the Worker knows instructions, one is an accepted suggestion of kind 'instruction', with its fix.
    const instruction = suggestion({ id: 'i1', kind: 'instruction', title: 'the film fails', detail: 'tap On this device', madeAt: at(1), decision: 'accepted', decidedAt: at(1), language: 'en' });
    const queued = videoBoard({ ...failing, feedback: feedback({ suggestions: [instruction] }) }, NOW);
    expect(queued.admin.find((a) => a.kind === 'fails')).toMatchObject({ who: 'claude', instructed: { text: 'tap On this device', fix: null } });
    expect(keys(queued)).toContain('toFix');
    expect(queued.worker).toContainEqual(expect.objectContaining({ kind: 'toFix', detail: expect.stringContaining('Your instruction: tap On this device') }));
    // Its pull request merges itself: the problem's card stays with Claude, and says so.
    const open = videoBoard({ ...failing, feedback: feedback({ suggestions: [{ ...instruction, fix: { state: 'open', pr: 470, at: at(0.5), run: null, note: null } }] }) }, NOW);
    expect(open.admin.map((a) => a.kind)).toEqual(['paused', 'fails']);
    expect(open.admin.find((a) => a.kind === 'fails')).toMatchObject({ who: 'claude', instructed: { fix: { state: 'open', pr: 470 } } });
    // A fix that failed says the rest in its own card: the problem's card goes.
    const failedFix = videoBoard({ ...failing, feedback: feedback({ suggestions: [{ ...instruction, fix: { state: 'failed', pr: 470, at: at(0.5), run: null, note: 'Its checks failed (gate: failure), so the pull request is closed.' } }] }) }, NOW);
    expect(failedFix.admin.map((a) => a.kind)).toEqual(['fixFailed', 'paused']);
    // An older note does not answer a newer problem.
    expect(videoBoard({ ...failing, feedback: feedback({ inputs: [{ ...note, at: at(20) }] }) }, NOW).admin.find((a) => a.kind === 'fails')!.instructed).toBeUndefined();
  });

  it('says which sources it could not read', () => {
    expect(videoBoard(input({ films: null, status: {}, nightly: null }), NOW).missing).toEqual([
      'films (migration 20261113234000_tutorial_films.sql)', 'the filming run on GitHub', 'the nightly language list',
      'the nightly status files (the first comes the night after PR 449 merges)'
    ]);
  });

  it('marks each film on the timeline with what made it', () => {
    const app = { kind: 'screen' as const, steps: [3], screens: ['Language'], changes: [{ sha: 'e'.repeat(40), pr: 403, subject: 'x' }] };
    const b = videoBoard(input({ films: [film({ sha256: sha('b'), madeAt: at(3) })], status: { en: status([{ film: { sha256: sha('b'), filmedAt: at(3), commit: null, why: [app] } }]) } }), NOW);
    expect(en(b).marks.find((m) => m.kind === 'film')).toMatchObject({ cause: 'app', text: 'words on Language changed (#403)' });
  });
});

describe('reading', () => {
  it('reads the nightly languages from tutorials.yml', () => {
    expect(nightlyLanguages('env:\n  # comment\n  NIGHTLY_LANGUAGES: en,fr\n')).toEqual(['en', 'fr']);
    expect(nightlyLanguages('env: {}')).toBeNull();
  });

  it('names causes', () => {
    expect(causeOf(null)).toBe('unknown');
    expect(causeOf([{ kind: 'screen', steps: [1], screens: [], changes: [], shared: true }])).toBe('tool');
    expect(whyText([{ kind: 'script', changes: [{ sha: 'f'.repeat(40), pr: null, subject: '' }] }])).toBe('its script changed (fffffff)');
  });

  it('builds the lists from GitHub alone when the database cannot be reached', async () => {
    const fetcher = (async (url: string) => {
      if (url.includes('/contents/.github/workflows/tutorials.yml')) return Response.json({ content: btoa('env:\n  NIGHTLY_LANGUAGES: en\n') });
      if (url.includes('/actions/workflows/tutorials.yml/runs')) return Response.json({ workflow_runs: [] });
      if (url.endsWith('/status-en.json')) return Response.json(status([{}]));
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;
    const s = await videosSection({ GITHUB_REPO: 'genesis-ai-dev/langquest-next' }, fetcher);
    expect(s.state).toBe('ok');
    const d = s.data as ReturnType<typeof videoBoard>;
    expect(d.languages.find((l) => l.language === 'en')).toMatchObject({ nightly: true, statusAt: at(10) });
    expect(d.videos.filter((v) => v.language === 'en').map((v) => v.tutorial)).toEqual(['record-a-passage']);
    expect(d.missing).toContain('suggestions and comments');
  });
});
