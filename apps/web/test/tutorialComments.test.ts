import { describe, expect, it } from 'vitest';
import { LinearError, linearIssues } from '../../../server/linear';
import { FILE_MAX, freshReport, tendComments, type CommentsDeps } from '../../../server/tutorialCommentsModel';
import { inputLink, issueOf, type FeedbackInput, type Suggestion } from '../../../server/tutorialFeedback';
import { CHANNELS, newComments, type VideoComment } from '../../../server/youtube';

/** The comments job (server/tutorialCommentsModel.ts, decisions.md 185) against a YouTube and Linear that answer by address, and its Linear issues. */

const thread = (id: string, at: string, over: { channel?: string; videoId?: string | null; text?: string } = {}) => ({
  id, snippet: { videoId: over.videoId === null ? undefined : over.videoId ?? 'dQw4w9WgXcQ', totalReplyCount: 1,
    topLevelComment: { snippet: { textDisplay: over.text ?? `comment ${id}`, publishedAt: at, authorChannelId: { value: over.channel ?? 'UCsomeoneelse000000000a' } } } }
});

function youtube(pages: Record<string, { items: unknown[]; nextPageToken?: string }>, options: { tokenRefused?: string } = {}) {
  const asked: URLSearchParams[] = [];
  const fetcher = async (input: string) => {
    if (input === 'https://oauth2.googleapis.com/token') {
      return options.tokenRefused ? Response.json({ error: options.tokenRefused }, { status: 400 }) : Response.json({ access_token: 'ya29' });
    }
    const url = new URL(input);
    if (url.pathname === '/youtube/v3/commentThreads') {
      asked.push(url.searchParams);
      return Response.json(pages[url.searchParams.get('pageToken') ?? ''] ?? { items: [] });
    }
    return new Response('{}', { status: 404 });
  };
  return { asked, fetcher };
}

describe('newComments', () => {
  it('reads newest first, page by page, until a comment it has, and leaves out the channel\'s own', async () => {
    const yt = youtube({
      '': { items: [thread('Ugnew-000003', '2026-10-29T10:00:00Z'), thread('Ugown-000002', '2026-10-29T09:00:00Z', { channel: CHANNELS.es })], nextPageToken: 'p2' },
      p2: { items: [thread('Ugnew-000001', '2026-10-29T08:00:00Z'), thread('Ugold-000000', '2026-10-28T08:00:00Z'), thread('Ugolder-0000', '2026-10-27T08:00:00Z')] }
    });
    const got = await newComments(yt.fetcher, 'ya29', CHANNELS.es, async (ids) => new Set(ids.filter((id) => id.startsWith('Ugold'))), '2025-10-29T00:00:00Z');
    expect(got.map((c) => c.id)).toEqual(['Ugnew-000003', 'Ugnew-000001']);
    expect(got[0]).toEqual({ id: 'Ugnew-000003', videoId: 'dQw4w9WgXcQ', text: 'comment Ugnew-000003', publishedAt: '2026-10-29T10:00:00Z', replies: 1 });
    expect(yt.asked[0]!.get('moderationStatus')).toBeNull();
    expect(yt.asked[0]!.get('order')).toBe('time');
    expect(yt.asked[0]!.get('textFormat')).toBe('plainText');
  });

  it('stops at a comment older than the job keeps', async () => {
    const yt = youtube({ '': { items: [thread('Ugnew-000001', '2026-10-29T10:00:00Z'), thread('Ugancient-01', '2024-01-01T00:00:00Z'), thread('Ugancient-02', '2023-01-01T00:00:00Z')] } });
    const got = await newComments(yt.fetcher, 'ya29', CHANNELS.es, async () => new Set(), '2025-10-29T00:00:00Z');
    expect(got.map((c) => c.id)).toEqual(['Ugnew-000001']);
  });
});

describe('linear', () => {
  it('finds the team once, then files each issue in it', async () => {
    const bodies: { query: string; variables: Record<string, unknown> }[] = [];
    let n = 170;
    const fetcher = async (_input: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      bodies.push(body);
      return Response.json(body.query.includes('teams') ? { data: { teams: { nodes: [{ id: 'team-1' }] } } }
        : { data: { issueCreate: { issue: { identifier: `LAN-${n}`, url: `https://linear.app/x/issue/LAN-${n++}` } } } });
    };
    const linear = linearIssues(fetcher, 'lin_key');
    expect(await linear.create('Tutorial feedback: a', 'd')).toEqual({ identifier: 'LAN-170', url: 'https://linear.app/x/issue/LAN-170' });
    expect(await linear.create('Tutorial feedback: b', 'd')).toEqual({ identifier: 'LAN-171', url: 'https://linear.app/x/issue/LAN-171' });
    expect(bodies.filter((b) => b.query.includes('teams'))).toHaveLength(1);
    expect(bodies[1]!.variables).toEqual({ input: { teamId: 'team-1', title: 'Tutorial feedback: a', description: 'd' } });
  });

  it('turns a refusal into a code', async () => {
    const linear = linearIssues(async () => Response.json({ errors: [{ extensions: { code: 'AUTHENTICATION_ERROR' } }] }, { status: 400 }), 'bad');
    await expect(linear.create('t', 'd')).rejects.toEqual(new LinearError('authentication_error'));
  });
});

const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
  id: '0d000000-0000-0000-0000-000000000001', kind: 'comment', tutorial: 'record-a-passage', language: 'es', at: '2026-10-29T10:00:00Z',
  ref: 'Ugc-0000001', youtubeId: 'dQw4w9WgXcQ', pr: null, text: 'El botón Guardar no hace nada.', english: 'The Save button does nothing.',
  reply: null, replyEnglish: null, lookedAt: '2026-10-30T10:00:00Z', outcome: null, ...over
});
const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: '0d000000-0000-0000-0000-0000000000s1', kind: 'code', tutorial: 'record-a-passage', title: 'Save does nothing when recording',
  detail: 'Viewers say Save does nothing on the record screen.', madeAt: '2026-10-30T10:00:00Z', editedAt: null, decision: 'accepted',
  decidedAt: '2026-10-30T16:00:00Z', reason: null, issue: null, issueUrl: null, inputs: [input()], ...over
});

describe('issueOf', () => {
  const name = (code: string) => ({ es: 'Spanish', en: 'English' })[code] ?? code;

  it('says what to change, the video, and each input it answers in English with where it is', () => {
    const issue = issueOf(suggestion({
      reason: 'Seen it too',
      inputs: [input(), input({ kind: 'code', ref: 'a'.repeat(40), pr: 272, youtubeId: null, language: null, text: 'Done replaces Save', english: 'The button is called Done now.' }),
        input({ kind: 'note', ref: null, youtubeId: null, language: null, english: null, text: 'Happens on iPhone too.' })]
    }), name);
    expect(issue.title).toBe('Tutorial feedback: Save does nothing when recording');
    expect(issue.description).toContain('Viewers say Save does nothing on the record screen.\n\nVideo: record-a-passage');
    expect(issue.description).toContain('A comment on the Spanish channel, 2026-10-29 (https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=Ugc-0000001):\n\n> The Save button does nothing.');
    expect(issue.description).toContain('A change merged into main, 2026-10-29 (https://github.com/genesis-ai-dev/langquest-next/pull/272):\n\n> The button is called Done now.');
    expect(issue.description).toContain('A note on the ops dashboard, 2026-10-29:\n\n> Happens on iPhone too.');
    expect(issue.description).toContain('Accepted with: Seen it too');
    expect(issue.description).not.toContain('El botón');
  });

  it('links a comment on no video to YouTube Studio, and a change with no pull request to its commit', () => {
    expect(inputLink({ kind: 'comment', ref: 'Ugc-0000001', youtubeId: null, pr: null })).toBe('https://studio.youtube.com');
    expect(inputLink({ kind: 'code', ref: 'b'.repeat(40), youtubeId: null, pr: null })).toBe(`https://github.com/genesis-ai-dev/langquest-next/commit/${'b'.repeat(40)}`);
    expect(inputLink({ kind: 'note', ref: null, youtubeId: null, pr: null })).toBeNull();
  });
});

describe('tendComments', () => {
  const es = { channelId: CHANNELS.es, language: 'es' as const, branded: null };
  const fr = { channelId: CHANNELS.fr, language: 'fr' as const, branded: null };

  function deps(over: Partial<CommentsDeps> = {}) {
    const marks: string[] = [];
    const yt = youtube({ '': { items: [thread('Ugnew-000001', '2026-10-29T10:00:00Z')] } });
    const d: CommentsDeps = {
      fetcher: yt.fetcher, client: { clientId: 'id', clientSecret: 'secret' },
      channels: async () => [es, fr],
      refreshToken: async (channelId) => (channelId === CHANNELS.es ? '1//es' : null),
      known: async () => new Set(),
      read: async (channel, comments: VideoComment[]) => { marks.push(`read ${channel.language} ${comments.map((c) => c.id).join(',')}`); return comments.length; },
      toFile: async () => [suggestion()],
      file: async (title) => { marks.push(`file ${title}`); return { identifier: 'LAN-170', url: 'https://linear.app/x/issue/LAN-170' }; },
      filed: async (id, identifier) => { marks.push(`filed ${id} ${identifier}`); },
      stopping: () => false,
      ...over
    };
    return { d, marks };
  }

  it('reads each channel and files each accepted code change once', async () => {
    const { d, marks } = deps();
    const report = await tendComments(d, freshReport(), () => 'Spanish');
    expect(marks).toEqual(['read es Ugnew-000001', 'file Tutorial feedback: Save does nothing when recording', 'filed 0d000000-0000-0000-0000-0000000000s1 LAN-170']);
    // French was never connected: the run says so, and the rest goes on.
    expect(report).toEqual({ ...freshReport(), channels: 1, read: 1, filed: 1, firstError: 'youtube_not_connected' });
  });

  it('without Linear, counts what waits and files nothing', async () => {
    const { d, marks } = deps({ file: null });
    const report = await tendComments(d, freshReport(), () => 'Spanish');
    expect(marks.filter((m) => m.startsWith('file'))).toEqual([]);
    expect(report.unfiled).toBe(1);
  });

  it('stops filing when Linear refuses the key, and asks for no more than a run files', async () => {
    let asked = 0;
    const { d } = deps({
      toFile: async (limit) => { asked = limit; return [suggestion(), suggestion({ id: '0d000000-0000-0000-0000-0000000000s2' })]; },
      file: async () => { throw new LinearError('authentication_error'); }
    });
    const report = await tendComments(d, freshReport(), () => 'Spanish');
    expect(asked).toBe(FILE_MAX);
    expect(report.fileFailed).toBe(1);
  });

  it('does nothing once it is told to stop', async () => {
    const { d, marks } = deps({ stopping: () => true });
    await tendComments(d, freshReport(), () => 'Spanish');
    expect(marks).toEqual([]);
  });
});
