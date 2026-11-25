import fc from 'fast-check';
import { encodeMessage } from '../src/nearbyWire';
import { COPY_PART_BODY_BYTES, LibraryDocsSender, sliceEnd, type NearbyDocs, type NearbyLibrary } from '../src/nearbyCopy';
import { canonicalJson, docHeadOf, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { bytesToHex, utf8Encode } from '@langquest-next/core/nearby';
import { fakeSha256 } from '../src/testing/memoryNearbyLink';

/**
 * Splitting a copy's texts into parts and joining them again (the 2026-11-24 review, T6). Why: every
 * text a starting copy or a top-up moves goes in parts no larger than a message may be, and a part
 * that splits a character, or a join that loses one, corrupts a document the teammate then refuses.
 * `sliceEnd` also skips its walk when the rest surely fits (review P6), which must change no split.
 */

/** The walk as it was before the review's shortcut, to hold the shortcut to it. */
function walked(text: string, start: number, budget: number): number {
  let cost = 2;
  let i = start;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff;
    const step = pair ? 4 : c === 0x22 || c === 0x5c ? 2 : c < 0x20 ? 6 : c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdfff ? 6 : 3;
    if (cost + step > budget) break;
    cost += step;
    i += pair ? 2 : 1;
  }
  return i;
}

/** Text with every kind of character a JSON string costs differently: quotes, controls, accents, CJK, emoji, lone surrogates. */
const anyText = fc.array(fc.oneof(
  fc.string(), fc.constantFrom('"', '\\', '\n', '\u0001', 'é', '中', '😀', '\ud800', '\udc00'), fc.string({ unit: 'binary' })
), { maxLength: 60 }).map((parts) => parts.join(''));

describe('a copy\'s texts in parts', () => {
  it('the shortcut ends where the walk would, wherever it starts and whatever the budget', () => {
    fc.assert(fc.property(anyText, fc.nat(), fc.integer({ min: 2, max: 400 }), (text, from, budget) => {
      const start = text.length === 0 ? 0 : from % (text.length + 1);
      expect(sliceEnd(text, start, budget)).toBe(walked(text, start, budget));
    }), { numRuns: 500 });
  });

  it('parts within the budget join to the text exactly, each one a JSON string no longer than it, and none splits a pair', () => {
    fc.assert(fc.property(anyText, fc.integer({ min: 12, max: 200 }), (text, budget) => {
      const parts: string[] = [];
      for (let at = 0; at < text.length;) {
        const end = sliceEnd(text, at, budget);
        // A budget too small for the next character still moves on by one, as a part always holds something.
        const next = end === at ? at + 1 : end;
        parts.push(text.slice(at, next));
        at = next;
      }
      expect(parts.join('')).toBe(text);
      for (const p of parts) {
        if (p.length > 1) expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(budget);
        const last = p.charCodeAt(p.length - 1);
        // A high surrogate ends a part only when no low one follows it in the text.
        if (p.length > 1 && last >= 0xd800 && last <= 0xdbff) expect(text.indexOf(p) + p.length).toBeLessThanOrEqual(text.length);
      }
    }), { numRuns: 300 });
  });

  it('a sender\'s parts of a document fit a message and join to its text, for any text it holds', async () => {
    const reg = <V>(value: V) => ({ value, hlc: '1:0:a', eventId: 'e' });
    await fc.assert(fc.asyncProperty(fc.array(anyText, { minLength: 1, maxLength: 4 }), async (texts) => {
      const doc = { format: 'material@1', kind: 'document', title: texts.join(' '), body: texts.join('\n').repeat(40), deps: [] } as unknown as LibraryDoc;
      const text = canonicalJson(doc);
      const hash = bytesToHex(fakeSha256(utf8Encode(text)));
      const docs: NearbyDocs = { head: async (h) => (h === hash ? docHeadOf(doc) : null), text: async (h) => (h === hash ? text : null), keep: async () => true };
      const org = { library: { x: { kind: reg('material'), name: reg('X'), description: reg(''), copiedFrom: reg(null), versions: { [hash]: { docHash: hash, hlc: 'x', eventId: 'e', actorId: 'a' } }, sharing: reg({ shared: false, subscribable: false }), archived: reg(false), subscription: reg(null), pinned: reg(null) } }, recommendations: { x: reg(true) } } as unknown as OrgState;
      const library: NearbyLibrary = { org: () => org, language: () => ({ languageReferences: {}, passageLinks: {}, checkHelps: {}, templateHistory: {} }) as unknown as LanguageState, docs };
      const sender = LibraryDocsSender.of(library);
      const parts: string[] = [];
      for (let after: string | undefined; ;) {
        const got = await sender.answer({ t: 'copy-ask', part: 'doc', hash, ...(after !== undefined ? { after } : {}) });
        if (typeof got === 'string') throw new Error(got);
        expect(encodeMessage({ t: 'copy-part', ...got }).length).toBeLessThanOrEqual(COPY_PART_BODY_BYTES + 1024);
        parts.push(got.body);
        if (got.next === null) break;
        after = got.next;
      }
      expect(parts.join('')).toBe(text);
    }), { numRuns: 40 });
  });
});
