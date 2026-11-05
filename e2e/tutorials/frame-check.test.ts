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

  it('reads only the stills Claude found something wrong in', () => {
    const found = problemsOf({ stills: [{ still: 2, problems: ['A purple line shows above the lit card.'] }, { still: 9, problems: ['No such still.'] }, { still: 3, problems: [' '] }] }, 4);
    expect([...found]).toEqual([[2, ['A purple line shows above the lit card.']]]);
    expect(problemsOf({ stills: [] }, 4).size).toBe(0);
    // An answer in words, as when the schema was not kept: the JSON in it, fenced or not.
    expect(problemsOf('```json\n{"stills": [{"still": 1, "problems": ["Blank."]}]}\n```', 4).get(1)).toEqual(['Blank.']);
    expect(problemsOf('[]', 4).size).toBe(0);
    expect(() => problemsOf('{"ok": true}', 4)).toThrow(/answered/);
    expect(() => problemsOf('Every still looks right.', 4)).toThrow(/answered/);
  });

  /** What Claude Code prints for a look (stream-json): the start, then the result. */
  const printed = (result: object) => [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...result })
  ].join('\n');

  it("shows Claude a film's stills in one look, and keeps only those with something wrong", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'frame-check-'));
    writeFileSync(path.join(folder, 'film.json'), JSON.stringify(film));
    const sent: any[] = [];
    const look = async (message: string) => {
      sent.push(JSON.parse(message));
      return printed({
        structured_output: { stills: [{ still: 2, problems: ['A purple line shows above the lit card.'] }] },
        total_cost_usd: 0.03,
        modelUsage: {
          'claude-sonnet-5-5': { inputTokens: 10, cacheCreationInputTokens: 5000, cacheReadInputTokens: 0, outputTokens: 30, thinkingTokens: 900, costUSD: 0.0299 },
          'claude-haiku-5-5': { inputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 10, costUSD: 0.0001 }
        }
      });
    };
    const usage = path.join(folder, 'usage.jsonl');
    const checked = await checkFilm(folder, 'video.mp4', 'en', { look, grab: (_mp4, t, file) => writeFileSync(file, `still at ${t}`), usage });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'user', message: { role: 'user' } });
    const content = sent[0].message.content as { type: string; text?: string; source?: { media_type: string; data: string } }[];
    expect(content[0]!.text).toContain('"Record a passage", with the app in English');
    expect(content.filter((c) => c.type === 'image')).toHaveLength(4);
    expect(content.find((c) => c.type === 'image')!.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: Buffer.from('still at 0.5').toString('base64') });
    expect(content.map((c) => c.text).filter(Boolean)).toContain('Still 3, at 0:11. The voice says: "Tap Record."');
    expect(checked.map((s) => s.problems.length)).toEqual([0, 1, 0, 0]);
    expect(readdirSync(path.join(folder, 'check'))).toEqual(['02.jpg']);
    const json = JSON.parse(readFileSync(path.join(folder, 'check.json'), 'utf8'));
    expect(json.model).toBe('claude-sonnet-5-5');
    expect(json.stills).toHaveLength(4);
    // On the plan, not billed: the tokens of both models, and what they would cost at the API's list price.
    expect(JSON.parse(readFileSync(usage, 'utf8'))).toEqual({ model: 'claude-sonnet-5-5', plan: true, requests: 1, in: 5210, out: 40, thinking: 900, usd: 0.03 });
    expect(problemLines(checked)).toEqual(['0:02 ("Here\'s how to record a passage."): A purple line shows above the lit card.']);
  });

  it('looks again while Claude is busy', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'frame-check-'));
    writeFileSync(path.join(folder, 'film.json'), JSON.stringify(film));
    let tries = 0;
    const look = async () => (++tries === 1
      ? printed({ subtype: 'error_during_execution', is_error: true, api_error_status: 529, result: 'Overloaded' })
      : printed({ result: '{"stills": []}' }));
    const checked = await checkFilm(folder, 'video.mp4', 'en', { look, grab: (_mp4, _t, file) => writeFileSync(file, 'x'), usage: path.join(folder, 'usage.jsonl'), wait: 0 });
    expect(tries).toBe(2);
    expect(checked.every((s) => !s.problems.length)).toBe(true);
  });

  it('says why when Claude will not look', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'frame-check-'));
    writeFileSync(path.join(folder, 'film.json'), JSON.stringify(film));
    let tries = 0;
    const refused = async () => {
      tries++;
      return printed({ subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1793577600' });
    };
    await expect(checkFilm(folder, 'video.mp4', 'en', { look: refused, grab: (_mp4, _t, file) => writeFileSync(file, 'x'), wait: 0 }))
      .rejects.toThrow(/frame check: .*usage limit reached/);
    // The plan's limit does not pass in a few seconds: one look, not four.
    expect(tries).toBe(1);
  });
});
