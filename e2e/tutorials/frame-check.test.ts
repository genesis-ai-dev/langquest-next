import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkFilm, problemLines, problemsOf, promptOf, stillsOf } from './frame-check';

/** A new film looked at as someone who pauses it would (frame-check.ts, decisions.md 192). */

const film = {
  title: 'Record a passage',
  end: 20,
  said: [
    { t: 1.2, seconds: 3, words: "Here's how to record a passage." },
    { t: 1.3, seconds: 0.2, words: 'Too close to the last to look at again.' },
    { t: 9, seconds: 4, words: 'Tap Record.' }
  ]
};

describe('the frame check', () => {
  it('pauses on the title, in the middle of each line, and at the end', () => {
    expect(stillsOf(film)).toEqual([
      { t: 0.5, says: '' },
      { t: 2.7, says: "Here's how to record a passage." },
      { t: 11, says: 'Tap Record.' },
      { t: 20.8, says: '' }
    ]);
    expect(promptOf('Grabar un pasaje', 'es')).toContain('with the app in Spanish');
  });

  it('reads only the stills Gemini found something wrong in', () => {
    const found = problemsOf(JSON.stringify([{ still: 2, problems: ['A purple line shows above the lit card.'] }, { still: 9, problems: ['No such still.'] }, { still: 3, problems: [' '] }]), 4);
    expect([...found]).toEqual([[2, ['A purple line shows above the lit card.']]]);
    expect(problemsOf('[]', 4).size).toBe(0);
    expect(() => problemsOf('{"ok": true}', 4)).toThrow(/answered/);
  });

  it('sends a film\'s stills in one request, and keeps only those with something wrong', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'frame-check-'));
    writeFileSync(path.join(folder, 'film.json'), JSON.stringify(film));
    const sent: { url: string; body: any }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      const answer = JSON.stringify([{ still: 2, problems: ['A purple line shows above the lit card.'] }]);
      return Response.json({ candidates: [{ content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 30 } });
    };
    const usage = path.join(folder, 'usage.jsonl');
    const checked = await checkFilm(folder, 'video.mp4', 'en', { fetcher, grab: (_mp4, t, file) => writeFileSync(file, `still at ${t}`), usage });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toMatch(/:generateContent$/);
    const parts = sent[0]!.body.contents[0].parts as { text?: string; inline_data?: { data: string } }[];
    expect(parts.filter((p) => p.inline_data)).toHaveLength(4);
    expect(parts.map((p) => p.text).filter(Boolean)).toContain('Still 3, at 0:11. The voice says: "Tap Record."');
    expect(checked.map((s) => s.problems.length)).toEqual([0, 1, 0, 0]);
    expect(readdirSync(path.join(folder, 'check'))).toEqual(['02.jpg']);
    expect(JSON.parse(readFileSync(path.join(folder, 'check.json'), 'utf8')).stills).toHaveLength(4);
    expect(JSON.parse(readFileSync(usage, 'utf8'))).toMatchObject({ requests: 1, in: 5000, out: 30 });
    expect(problemLines(checked)).toEqual(['0:02 ("Here\'s how to record a passage."): A purple line shows above the lit card.']);
  });

  it('says why when Gemini will not answer', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'frame-check-'));
    writeFileSync(path.join(folder, 'film.json'), JSON.stringify(film));
    const refused = async () => new Response('Invalid JSON payload received.', { status: 400 });
    await expect(checkFilm(folder, 'video.mp4', 'en', { fetcher: refused, grab: (_mp4, _t, file) => writeFileSync(file, 'x') }))
      .rejects.toThrow(/frame check: 400 Invalid JSON/);
  });
});
