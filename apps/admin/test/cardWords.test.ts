import { describe, expect, it } from 'vitest';
import { cardWordProblems, WHY_STOPPED } from '../../../scripts/card-words.mjs';
import { aboutOf, APP_NEXT, videoBoard, type AdminItem, type FilmRow, type StatusFile, type VideosInput } from '../src/sources/videos';

// Every card on the ops dashboard keeps one word standard (docs/card-words.md,
// docs/decisions/2026-11-24-every-dashboard-card-follows-one-word-standard.md): a person who opens a card fresh
// reads first what it is about, from high up, in plain words, and a card that says Claude stopped says why and
// what to do. This test reads every fixed text the Tutorial videos page builds, so a new or changed text that
// breaks the standard fails here, not on Caleb's screen.

const NOW = Date.parse('2026-11-24T23:00:00Z');
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const sha = (c: string) => c.repeat(64);
const film = (o: Partial<FilmRow> = {}): FilmRow => ({ tutorial: 'record-a-passage', language: 'en', sha256: sha('a'), madeAt: at(48), chosenAt: at(47), publishedAt: at(40), youtubeId: 'dQw4w9WgXcQ', failed: null, failedAt: null, ...o });
type V = StatusFile['videos'][number];
const video = (tutorial: string, o: Partial<V> = {}): V => ({ tutorial, title: tutorial, tonight: 'same', film: { sha256: sha('a'), filmedAt: at(48), commit: null, why: [{ kind: 'new' }] }, why: [], slots: [], checked: [], ...o });
const suggestion = (o: Record<string, unknown>) => ({ id: 's1', kind: 'script' as const, tutorial: 'record-a-passage', title: 'Say Done, not Save, in step 9', detail: 'Step 9 says Save.', madeAt: at(20), editedAt: null,
  decision: null, decidedAt: null, reason: null, issue: null, issueUrl: null, inputs: [], ...o });
const NOTES = ['Its checks failed (gate: failure), so the pull request is closed.', 'It did not merge within 24 hours, so the pull request is closed.', 'The second check stopped it: it reads files.',
  'GitHub did not let the App open the pull request (403); the branch tutorial-fix/x is pushed.', 'Claude wrote no fix.json.', 'A person must decide whether to change all videos.', null];

/** A board with a card of every kind the page has. */
function board() {
  const input: VideosInput = {
    films: [film(), film({ tutorial: 'add-a-language' }), film({ tutorial: 'do-a-check', sha256: sha('b'), chosenAt: null, publishedAt: null, youtubeId: null }), film({ language: 'fr' })],
    feedback: { suggestions: [suggestion({}), ...NOTES.map((note, n) => suggestion({ id: `f${n}`, tutorial: 'add-a-language', decision: 'accepted', decidedAt: at(10), fix: { state: 'failed', pr: null, at: at(5), run: null, note } }))],
      inputs: [{ id: 'c1', kind: 'comment', tutorial: 'record-a-passage', language: 'en', text: 'Nice', english: null, at: at(3), lookedAt: null, ref: 'x', youtubeId: 'y', reply: null, replyEnglish: null, replyDone: null, outcome: null }],
      waiting: 1, open: 1, unfiled: 0, last: null, videos: [] } as unknown as VideosInput['feedback'],
    tutorials: { channels: [{ language: 'en', channelId: 'x', connectedAt: null }], waiting: [] } as unknown as VideosInput['tutorials'],
    status: { en: { language: 'en', commit: 'c'.repeat(40), at: at(10), videos: [video('record-a-passage', { tonight: 'held', held: ['a toast covers Save'] }), video('add-a-language'), video('do-a-check', { tonight: 'failed' }),
      video('invite-your-team', { slots: [{ sha: 'd'.repeat(40), pr: 12, subject: 'x', screens: ['home'] }] })] } },
    filming: null, nightly: ['en']
  };
  return videoBoard(input, NOW);
}

const problems = (where: string, text: string | undefined, max?: number) => (text ? cardWordProblems(text, max ? { max } : {}).map((p) => `${where}: ${p}`) : []);

describe('the words on the Tutorial videos page\'s cards (docs/card-words.md)', () => {
  const b = board();
  const kinds = new Set(b.admin.map((a) => a.kind));

  it('builds a card of each kind this test reads', () => {
    for (const k of ['approve', 'fixFailed', 'held', 'fails', 'comment', 'screen', 'connect', 'paused'] as AdminItem['kind'][]) expect(kinds).toContain(k);
  });

  it('starts every card with what it is about, in plain words', () => {
    for (const a of b.admin) expect(a.about, a.kind).toBeTruthy();
    const kindsAll: AdminItem['kind'][] = ['approve', 'appFix', 'fixFailed', 'fixed', 'held', 'fails', 'reply', 'comment', 'screen', 'publish', 'connect', 'empty', 'paused'];
    expect(kindsAll.flatMap((k) => problems(`about ${k}`, aboutOf(k, 'Record a passage', 'Spanish')))).toEqual([]);
  });

  it('keeps the standard in every title, first line and next step', () => {
    expect(b.admin.flatMap((a) => [...problems(`${a.kind} title`, a.title, 20), ...problems(`${a.kind} about`, a.about), ...problems(`${a.kind} next`, a.next)])).toEqual([]);
    expect(b.worker.flatMap((w) => [...problems(`${w.kind} title`, w.title, 20), ...problems(`${w.kind} detail`, w.detail)])).toEqual([]);
    expect(Object.entries(APP_NEXT).flatMap(([k, t]) => problems(`app ${k}`, t))).toEqual([]);
  });

  it('says why Claude stopped and what to do, never only that Claude could not', () => {
    const failed = b.admin.filter((a) => a.kind === 'fixFailed');
    expect(failed).toHaveLength(NOTES.length);
    expect(failed.map((a) => a.stopped!.why)).toEqual(['checksFailed', 'tooSlow', 'safety', 'noAccess', 'broke', 'needsChoice', 'unknown']);
    for (const a of failed) {
      expect(a.title).not.toMatch(/could not make the change/);
      expect(a.next).toBe(WHY_STOPPED[a.stopped!.why].youCan);
    }
    expect(Object.entries(WHY_STOPPED).flatMap(([k, w]) => [...problems(`${k} label`, w.label, 8), ...problems(`${k} says`, w.says), ...problems(`${k} youCan`, w.youCan)])).toEqual([]);
  });
});
