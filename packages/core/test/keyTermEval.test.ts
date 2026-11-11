import {
  BASELINES, decodeWav, formatReports, manifestProblem, meetsBar, reportFor, scorePairs, tally,
  type EvalClip, type EvalSet, type Matcher, type PairScore
} from '../src/keyTermEval';

/**
 * Why: this is the bar stages 3 and 4 of the key-term check are judged by
 * (decision 206). If precision or recall were miscounted, a weak matcher
 * could ship or a good one be thrown out, so the arithmetic is pinned here.
 */
const clip = (id: string): EvalClip => ({ id, samples: new Float32Array(10), sampleRate: 16000 });
const set: EvalSet = {
  language: 'Test',
  terms: [{ termId: 'a', examples: [clip('a1')] }, { termId: 'b', examples: [clip('b1')] }],
  passages: [
    { id: 'p1', clip: clip('p1'), heard: ['a'] },
    { id: 'p2', clip: clip('p2'), heard: ['a', 'b'] },
    { id: 'p3', clip: clip('p3'), heard: [] }
  ]
};
/** Knows the truth, with one wrong guess: it hears b in p3. */
const oracle: Matcher = {
  id: 'oracle', version: '1',
  score: (term, passage) => (<Record<string, number>>{ 'a:p1': 0.9, 'a:p2': 0.8, 'a:p3': 0.1, 'b:p1': 0.2, 'b:p2': 0.7, 'b:p3': 0.6 })[`${term.termId}:${passage.id}`]!
};

describe('tally', () => {
  const pairs: PairScore[] = [
    { termId: 'a', passageId: 'x', score: 0.9, present: true },
    { termId: 'a', passageId: 'y', score: 0.8, present: false },
    { termId: 'a', passageId: 'z', score: 0.2, present: true },
    { termId: 'a', passageId: 'w', score: 0.1, present: false }
  ];
  it('counts found, wrong, missed and rightly quiet, and the two rates', () => {
    expect(tally(pairs, 0.5)).toMatchObject({ tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5, f1: 0.5 });
  });
  it('treats an empty side as perfect rather than dividing by nothing', () => {
    expect(tally(pairs, 2)).toMatchObject({ tp: 0, fp: 0, precision: 1, recall: 0, f1: 0 });
    expect(tally([], 0.5)).toMatchObject({ precision: 1, recall: 1 });
  });
});

describe('scoring a matcher over a set', () => {
  it('scores every term against every passage with the known answer', async () => {
    const pairs = await scorePairs(oracle, set);
    expect(pairs).toHaveLength(6);
    expect(pairs.filter((p) => p.present).map((p) => `${p.termId}:${p.passageId}`).sort()).toEqual(['a:p1', 'a:p2', 'b:p2']);
  });
  it('keeps a matcher that returns nonsense inside 0 to 1', async () => {
    const wild: Matcher = { id: 'wild', version: '1', score: (t) => (t.termId === 'a' ? 7 : Number.NaN) };
    expect((await scorePairs(wild, set)).map((p) => p.score)).toEqual([1, 1, 1, 0, 0, 0]);
  });
  it('reports a matcher overall, per term, and at its best threshold', async () => {
    const r = reportFor(oracle, await scorePairs(oracle, set), 0.65);
    expect(r.overall).toMatchObject({ tp: 3, fp: 0, fn: 0, precision: 1, recall: 1 });
    expect(r.perTerm['b']).toMatchObject({ tp: 1, fp: 0 });
    const loose = reportFor(oracle, await scorePairs(oracle, set), 0.15);
    expect(loose.overall.precision).toBeLessThan(1);
    expect(loose.best.tally.f1).toBe(1);
    expect(loose.best.threshold).toBeGreaterThan(0.6);
  });
  it('shows the two baselines what a matcher has to beat', async () => {
    const [always, never] = await Promise.all(BASELINES.map(async (m) => reportFor(m, await scorePairs(m, set), 0.5)));
    expect(always!.overall).toMatchObject({ recall: 1, precision: 0.5 });
    expect(never!.overall).toMatchObject({ recall: 0, precision: 1 });
    expect(meetsBar(always!.overall)).toBe(false);
    expect(meetsBar(never!.overall)).toBe(false);
  });
  it('writes a report a person can read', async () => {
    const text = formatReports(set, [reportFor(oracle, await scorePairs(oracle, set), 0.65)]);
    expect(text).toContain('2 terms, 3 passages, 3 known mentions');
    expect(text).toContain('oracle (1) at threshold 0.65');
    expect(text).toContain('MEETS THE BAR');
    expect(text).toContain('a                    precision');
  });
});

describe('a manifest', () => {
  const ok = {
    language: 'Test',
    terms: [{ termId: 'a', examples: ['a.wav'] }, { termId: 'b', examples: ['b.wav'] }],
    passages: [{ id: 'p1', file: 'p1.wav', heard: ['a'] }, { id: 'p2', file: 'p2.wav', heard: ['b'] }]
  };
  it('passes when every term is said somewhere and not everywhere', () => {
    expect(manifestProblem(ok)).toBeNull();
  });
  it.each([
    ['not an object', null],
    ['no language', { ...ok, language: '' }],
    ['no terms', { ...ok, terms: [] }],
    ['no passages', { ...ok, passages: [] }],
    ['a repeated term', { ...ok, terms: [ok.terms[0], ok.terms[0]] }],
    ['a term without examples', { ...ok, terms: [{ termId: 'a', examples: [] }, ok.terms[1]] }],
    ['a repeated passage', { ...ok, passages: [ok.passages[0], ok.passages[0]] }],
    ['a passage without a heard list', { ...ok, passages: [{ id: 'p1', file: 'x' }, ok.passages[1]] }],
    ['a heard term the set lacks', { ...ok, passages: [{ id: 'p1', file: 'x', heard: ['zzz'] }, ok.passages[1]] }],
    ['a term nobody says', { ...ok, passages: [ok.passages[0], { id: 'p2', file: 'p2.wav', heard: [] }] }],
    ['every term everywhere', { ...ok, passages: [{ id: 'p1', file: 'x', heard: ['a', 'b'] }] }]
  ])('refuses %s', (_name, m) => {
    expect(manifestProblem(m)).not.toBeNull();
  });
});

describe('decodeWav', () => {
  function wav(samples: number[], { channels = 1, rate = 16000, bits = 16, format = 1 } = {}): Uint8Array {
    const data = new DataView(new ArrayBuffer(samples.length * 2));
    samples.forEach((s, i) => data.setInt16(i * 2, s, true));
    const head = new DataView(new ArrayBuffer(44));
    const text = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF'); head.setUint32(4, 36 + data.byteLength, true); text(8, 'WAVE'); text(12, 'fmt ');
    head.setUint32(16, 16, true); head.setUint16(20, format, true); head.setUint16(22, channels, true); head.setUint32(24, rate, true);
    head.setUint32(28, rate * channels * 2, true); head.setUint16(32, channels * 2, true); head.setUint16(34, bits, true);
    text(36, 'data'); head.setUint32(40, data.byteLength, true);
    return new Uint8Array([...new Uint8Array(head.buffer), ...new Uint8Array(data.buffer)]);
  }
  it('reads 16-bit PCM into -1..1 and says the rate', () => {
    const { samples, sampleRate } = decodeWav(wav([0, 16384, -32768]));
    expect(sampleRate).toBe(16000);
    expect([...samples]).toEqual([0, 0.5, -1]);
  });
  it('averages channels', () => {
    expect([...decodeWav(wav([16384, 0, -16384, -16384], { channels: 2 })).samples]).toEqual([0.25, -0.5]);
  });
  it('refuses what it cannot read, in plain words', () => {
    expect(() => decodeWav(new Uint8Array(10))).toThrow('Not a WAV file.');
    expect(() => decodeWav(wav([1], { bits: 8 }))).toThrow('Only 16-bit PCM');
    expect(() => decodeWav(wav([1], { format: 3 }))).toThrow('Only 16-bit PCM');
    const noData = wav([1]).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow('Not a WAV file.');
  });
});
