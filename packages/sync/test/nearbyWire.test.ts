import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { NEARBY_BATCH_MAX_EVENTS, utf8Encode, type AnyEvent, type ChainLink } from '@langquest-next/core';
import { NEARBY_MESSAGE_MAX } from '../src/nearbyLink';
import { NEARBY_COPY_PART_MAX_CHARS, NEARBY_HOLDINGS_MESSAGE_FILES, encodeMessage, parseMessage, utf8Decode, type Message } from '../src/nearby';

const KEY = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';
const SIG = `${'A'.repeat(85)}A`;
const HASH = 'a'.repeat(64);
const CHAIN = [{ kind: 'worker@1', kid: 'k1', body: {}, sig: SIG }] as unknown as ChainLink[];
const EVENT = { id: 'e1', type: 'v1.Whatever', payload: {} } as unknown as AnyEvent;

const parseJson = (json: string) => parseMessage(utf8Encode(json));
const parse = (o: unknown) => parseJson(JSON.stringify(o));
const malformed = (o: unknown) => expect(parse(o).kind).toBe('malformed');

/** One of every message, so that a new one with no case here fails below. */
const EVERY: Message[] = [
  { t: 'hello', protocol: { min: 1, max: 1 }, can: ['files', 'let-in'], reducerVersion: 3, linesVersion: 1, deviceId: 'd1', wallMs: 1700000000000, chain: CHAIN, proof: SIG },
  { t: 'you-first' },
  { t: 'discovery-key', gen: 3, key: KEY },
  { t: 'arrange', summary: '1f1d85db', radios: { directByName: true, band5: false, hotspot: true, joinHotspot: false } },
  { t: 'host', kind: 'wifi-direct', ssid: 'DIRECT-ab-Android_12', passphrase: 'secret', port: 9000, band: '5', security: 'wpa2' },
  { t: 'host', kind: 'bluetooth' },
  { t: 'ready' },
  { t: 'have', orgId: 'org1', languageId: 'lang1', cursor: 1, claimedSeq: 2, revokedSeq: 3, vector: new Map([[KEY, { mark: 2, ahead: [[4, 5], [7, 7]] }]]), holdings: new Map([[KEY, 9]]) },
  { t: 'revoked', text: '{}', kid: 'k1', sig: SIG },
  { t: 'holdings', key: KEY, counter: 2, files: [HASH], more: true },
  { t: 'holdings', key: KEY, counter: 2, files: [], more: false, sig: SIG, chain: CHAIN },
  { t: 'holdings-end' },
  { t: 'batch', manifest: '{}', sig: SIG, chain: CHAIN, events: [EVENT] },
  { t: 'claims', text: '{}', kid: 'k1', sig: SIG, events: [EVENT] },
  { t: 'events-done', older: true },
  { t: 'file-ask', transferId: 'tr_1-a', hash: HASH, format: 'm4a' },
  { t: 'file-no', transferId: 'tr_1-a', reason: 'not-here' },
  { t: 'files-done' },
  { t: 'done' },
  { t: 'final', summary: '00000000' },
  { t: 'bye', reason: 'not-member' },
  { t: 'join-ask', installKey: KEY, idSalt: 'AAECAwQFBgcICQoLDA0ODw', profileId: 'p1', deviceId: 'd1', name: 'Sam', proof: SIG },
  { t: 'join-grant', chain: CHAIN, proof: SIG, discoveryKey: KEY, gen: 2, floor: 1 },
  { t: 'copy-ask', part: 'doc', stream: 'lang1', after: '10', hash: HASH },
  { t: 'copy-ask', part: 'state' },
  { t: 'copy-part', part: 'state', stream: 'lang1', next: null, body: 'text' },
  { t: 'copy-part', part: 'doc', next: '900', body: '' },
  { t: 'copy-no', reason: 'not-here' }
];

describe('the nearby entry', () => {
  it('is absent from the package\'s main entry, so the web bundle does not carry it', () => {
    expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/['"]\.\/nearby/);
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).exports['./nearby']).toBe('./src/nearby.ts');
  });
});

describe('nearby messages', () => {
  it('every message comes back as it went', () => {
    for (const m of EVERY) expect(parseMessage(encodeMessage(m))).toEqual({ kind: 'message', message: m });
  });

  it('holds a message of every type the plan names', () => {
    expect(new Set(EVERY.map((m) => m.t)).size).toBe(24);
  });

  it('a have travels with its maps as JSON objects', () => {
    const have = EVERY.find((m) => m.t === 'have')!;
    const wire = JSON.parse(Buffer.from(encodeMessage(have)).toString('utf8'));
    expect(wire.vector).toEqual({ [KEY]: { mark: 2, ahead: [[4, 5], [7, 7]] } });
    expect(wire.holdings).toEqual({ [KEY]: 9 });
  });

  it('a message a phone does not know is ignored, and one it knows may carry more than it reads', () => {
    expect(parse({ t: 'from-the-future', anything: true })).toEqual({ kind: 'unknown' });
    expect(parse({ t: '__proto__' })).toEqual({ kind: 'unknown' });
    expect(parse({ t: 'done', later: { a: 1 } })).toEqual({ kind: 'message', message: { t: 'done' } });
  });

  it('what is not a message at all is malformed', () => {
    for (const bad of ['', 'nope', '[]', 'null', '5', '{}', '{"t":5}', '{"t":null}']) expect(parseJson(bad).kind).toBe('malformed');
    expect(parseMessage(new Uint8Array([0xff, 0xfe])).kind).toBe('malformed');
    expect(parseMessage(new Uint8Array(NEARBY_MESSAGE_MAX + 1)).kind).toBe('malformed');
  });

  it('a field of the wrong kind is malformed, in every message', () => {
    for (const m of EVERY) {
      const wire = JSON.parse(Buffer.from(encodeMessage(m)).toString('utf8')) as Record<string, unknown>;
      for (const k of Object.keys(wire).filter((x) => x !== 't')) {
        const stayedOptional = (m.t === 'host' && k !== 'kind') || (m.t === 'holdings' && (k === 'sig' || k === 'chain')) || (m.t === 'copy-ask' && k !== 'part') || (m.t === 'copy-part' && k === 'stream');
        // A discovery key's number is for `handedKeyHolds` to judge (below).
        for (const bad of [{ bad: 1 }, [{ bad: 1 }, 2], ...(m.t === 'discovery-key' ? [] : [-1])]) {
          const out = parse({ ...wire, [k]: bad });
          expect(out.kind, `${m.t}.${k} = ${JSON.stringify(bad)}`).toBe('malformed');
        }
        if (!stayedOptional) expect(parse({ ...wire, [k]: undefined }).kind, `${m.t} without ${k}`).toBe('malformed');
      }
    }
  });

  it('a hello on a QR link has an empty chain, proof and device', () => {
    const hello = EVERY[0]!;
    expect(parse({ ...hello, chain: [], proof: '', deviceId: '' }).kind).toBe('message');
    malformed({ ...hello, proof: 'short' });
  });

  it('a discovery key is for handedKeyHolds to judge, and a bad one ends nothing', () => {
    expect(parse({ t: 'discovery-key', gen: 1.5, key: 'short' }).kind).toBe('message');
    malformed({ t: 'discovery-key', gen: '1', key: KEY });
    malformed({ t: 'discovery-key', gen: 1, key: 'x'.repeat(257) });
  });

  it('a transfer id and a format hold no path, since they go in a file\'s name', () => {
    malformed({ t: 'file-ask', transferId: '../x', hash: HASH, format: 'm4a' });
    malformed({ t: 'file-ask', transferId: 'a', hash: HASH, format: '../m4a' });
    malformed({ t: 'file-ask', transferId: 'a', hash: 'A'.repeat(64), format: 'm4a' });
    malformed({ t: 'file-no', transferId: 'a/b', reason: 'not-here' });
  });

  it('a host says a real port', () => {
    malformed({ t: 'host', kind: 'hotspot', port: 65536 });
    malformed({ t: 'host', kind: 'radio' });
  });
});

describe('every list is capped', () => {
  it('events on a page', () => {
    const page = (n: number) => ({ t: 'batch', manifest: '{}', sig: SIG, chain: [], events: Array.from({ length: n }, () => EVENT) });
    expect(parse(page(NEARBY_BATCH_MAX_EVENTS)).kind).toBe('message');
    malformed(page(NEARBY_BATCH_MAX_EVENTS + 1));
    malformed({ ...page(1), events: [5] });
  });

  it('links in a chain', () => {
    const page = (n: number) => ({ t: 'batch', manifest: '{}', sig: SIG, chain: Array.from({ length: n }, () => ({})), events: [] });
    expect(parse(page(4)).kind).toBe('message');
    malformed(page(5));
    malformed({ ...page(0), chain: [5] });
  });

  it('hashes in a holdings message', () => {
    const part = (n: number) => ({ t: 'holdings', key: KEY, counter: 1, more: true, files: Array.from({ length: n }, () => HASH) });
    expect(parse(part(NEARBY_HOLDINGS_MESSAGE_FILES)).kind).toBe('message');
    malformed(part(NEARBY_HOLDINGS_MESSAGE_FILES + 1));
    malformed({ ...part(0), files: ['not a hash'] });
  });

  it('abilities in a hello and a copy part', () => {
    const hello = EVERY[0]!;
    expect(parse({ ...hello, can: Array.from({ length: 64 }, (_, i) => `a${i}`) }).kind).toBe('message');
    malformed({ ...hello, can: Array.from({ length: 65 }, (_, i) => `a${i}`) });
    malformed({ ...hello, can: [''] });
    malformed({ t: 'copy-part', part: 'state', next: null, body: 'x'.repeat(NEARBY_COPY_PART_MAX_CHARS + 1) });
  });

  it('ranges in a have: more than a phone stores, since a have is only a claim, and not without end', () => {
    const have = (n: number) => ({
      t: 'have', orgId: 'o', languageId: 'l', cursor: 0, claimedSeq: 0, revokedSeq: 0, holdings: {},
      vector: { [KEY]: { mark: 0, ahead: Array.from({ length: n }, (_, i) => [2 * i + 1, 2 * i + 1]) } }
    });
    expect(parse(have(256)).kind).toBe('message');
    malformed(have(257));
  });

  it('a page encodes only if a link can carry it', () => {
    const big = 'x'.repeat(NEARBY_MESSAGE_MAX);
    expect(() => encodeMessage({ t: 'revoked', text: big, kid: 'k', sig: SIG })).toThrow(/over the/);
  });
});

describe('hostile input', () => {
  const prototypeNow = () => Object.getOwnPropertyNames(Object.prototype).sort().join(',');
  const before = prototypeNow();
  afterEach(() => {
    expect(prototypeNow()).toBe(before);
    for (const k in {}) throw new Error(`Object.prototype gained ${k}`);
  });

  it('a member name in a have is malformed, and the parse changes no prototype', () => {
    const have = (vector: string, holdings = '{}') => `{"t":"have","orgId":"o","languageId":"l","cursor":0,"claimedSeq":0,"revokedSeq":0,"vector":${vector},"holdings":${holdings}}`;
    expect(parseJson(have('{}')).kind).toBe('message');
    const entry = '{"mark":1,"ahead":[]}';
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(parseJson(have(`{"${name}":${entry}}`)).kind).toBe('malformed');
      expect(parseJson(have('{}', `{"${name}":1}`)).kind).toBe('malformed');
    }
    expect(({} as Record<string, unknown>)['mark']).toBeUndefined();
  });

  it('a member name in a chain is malformed, and one in an event is for the door to refuse', () => {
    const batch = (chain: string, events: string) => `{"t":"batch","manifest":"{}","sig":"${SIG}","chain":${chain},"events":${events}}`;
    expect(parseJson(batch('[{"__proto__":{"a":1}}]', '[]')).kind).toBe('malformed');
    const hostile = parseJson(batch('[]', '[{"id":"constructor","__proto__":{"a":1}}]'));
    expect(hostile.kind).toBe('message');
    expect(parseJson(`{"t":"claims","text":"{}","kid":"constructor","sig":"${SIG}","events":[]}`).kind).toBe('malformed');
  });

  it('a known message built from what it read holds no extra field, even a __proto__ one', () => {
    const out = parseJson('{"t":"bye","reason":"done","__extra":1}');
    expect(out).toEqual({ kind: 'message', message: { t: 'bye', reason: 'done' } });
    expect(parseJson('{"t":"bye","reason":"done","__proto__":{"polluted":1}}').kind).toBe('malformed');
  });

  it('any bytes give an answer and no throw', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
      expect(['message', 'unknown', 'malformed']).toContain(parseMessage(bytes).kind);
    }));
  });

  it('any JSON gives an answer and no throw, also under a real type', () => {
    const types = [...new Set(EVERY.map((m) => m.t))];
    fc.assert(fc.property(fc.constantFrom(...types), fc.dictionary(fc.constantFrom('protocol', 'can', 'vector', 'holdings', 'radios', 'chain', 'events', 'files', 'reason', 'key', 'sig', '__proto__', 'constructor'), fc.jsonValue()), (t, fields) => {
      expect(['message', 'malformed']).toContain(parseJson(JSON.stringify({ ...fields, t })).kind);
    }));
  });

  it('a value nested beyond any stack stays an answer', () => {
    expect(parseJson(`{"t":"bye","reason":${'['.repeat(200_000)}${']'.repeat(200_000)}}`).kind).toBe('malformed');
  });
});

describe('utf8Decode', () => {
  const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const standard = (bytes: Uint8Array): string | null => {
    try {
      return strict.decode(bytes);
    } catch {
      return null;
    }
  };

  it('reads what utf8Encode wrote', () => {
    fc.assert(fc.property(fc.string({ unit: 'grapheme' }), (s) => {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }));
  });

  it('agrees with a strict decoder on any bytes, and refuses what it refuses', () => {
    const leading = fc.constantFrom(0x41, 0x7f, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0x80, 0x9f, 0xa0, 0xbf);
    fc.assert(fc.property(fc.array(leading, { maxLength: 12 }), (list) => {
      const bytes = new Uint8Array(list);
      expect(utf8Decode(bytes)).toBe(standard(bytes));
    }), { numRuns: 2000 });
    fc.assert(fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
      expect(utf8Decode(bytes)).toBe(standard(bytes));
    }));
  });

  it('reads a long message whole', () => {
    const text = 'é👋x'.repeat(10_000);
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });
});
