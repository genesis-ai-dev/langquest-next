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

describe('each video\'s state (decisions.md 186, amended 2026-11-13)', () => {
  it('is up to date when nothing waits', () => {
    const b = videoBoard(input(), NOW);
    expect(keys(b)).toEqual(['current']);
    expect(en(b).film).toEqual({ madeAt: at(48), why: 'first film', up: true });
    expect(b.admin.filter((a) => a.kind !== 'paused')).toEqual([]);
  });

  it('puts a failing or held film first, and asks an admin to look', () => {
    const b = videoBoard(input({ status: { en: status([{ tonight: 'held', held: ['a toast covers the button'] }]) } }), NOW);
    expect(keys(b)[0]).toBe('held');
    expect(b.admin[0]).toMatchObject({ kind: 'held', detail: 'a toast covers the button' });
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
    const open = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'open', pr: 460, at: at(3), run: null, note: null } })] }) }), NOW);
    expect(en(open).states[0]).toMatchObject({ key: 'merge', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/460' });
    expect(open.admin[0]).toMatchObject({ kind: 'merge', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/460' });
    // Merged after last night's status: tonight films it.
    const merged = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'merged', pr: 460, at: at(2), run: null, note: null } })] }) }), NOW);
    expect(keys(merged)).toEqual(['tonight']);
    const failedFix = videoBoard(input({ feedback: feedback({ suggestions: [suggestion({ ...accepted, fix: { state: 'failed', pr: null, at: at(2), run: 'https://github.com/r/2', note: 'the script would not run' } })] }) }), NOW);
    expect(failedFix.admin[0]).toMatchObject({ kind: 'fixFailed', detail: 'the script would not run', link: 'https://github.com/r/2' });
  });

  it('says a screen change slots a video for tonight\'s check', () => {
    const slot = { sha: 'd'.repeat(40), pr: 455, subject: 'Merge pull request #455', screens: ['Language'] };
    const b = videoBoard(input({ status: { en: status([{ slots: [slot] }]) } }), NOW);
    expect(en(b).states[0]).toMatchObject({ key: 'slotted', link: 'https://github.com/genesis-ai-dev/langquest-next/pull/455' });
    expect(b.worker).toContainEqual(expect.objectContaining({ kind: 'check', title: 'Check 1 video in en tonight' }));
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
    expect(b.worker).toContainEqual(expect.objectContaining({ kind: 'upload', title: 'Upload 1 film in en' }));
  });

  it('pauses the languages not filmed each night, and says so once in the admin list', () => {
    const b = videoBoard(input({ films: [film(), film({ language: 'fr' })] }), NOW);
    expect(b.videos.find((v) => v.language === 'fr')!.states.map((s) => s.key)).toEqual(['paused']);
    expect(b.admin.filter((a) => a.kind === 'paused')).toHaveLength(1);
    expect(b.admin.find((a) => a.kind === 'paused')!.title).toBe('15 languages are paused');
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
