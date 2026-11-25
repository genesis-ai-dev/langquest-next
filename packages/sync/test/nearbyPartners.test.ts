import fc from 'fast-check';
import { choosePartner, type PartnerInRange } from '../src/nearbyPartners';

/**
 * Which teammate a phone talks to next (docs/nearby-sync-plan.md 5.11, 5.12). Why: five
 * phones should level in close to 2N - 4 pairings, two phones that finished must not keep
 * reconnecting, and of two phones that pick each other only one may connect.
 */

const me = { tag: '000000000005', summary: 'aaaaaaaa' };
const peer = (tag: string, over: Partial<PartnerInRange> = {}): PartnerInRange => ({
  tag, key: null, summary: 'bbbbbbbb', position: null, finished: null, hasWhatIWant: true, wantsWhatIHave: true, echoed: true, older: false, listed: false, dueAnyway: false, ...over
});

describe('choosePartner', () => {
  it('says "Up to date" with nobody in range', () => {
    expect(choosePartner(me, [])).toBeNull();
  });

  it('drops a phone with an equal summary and nothing to swap, unless it is due anyway', () => {
    const same = peer('000000000009', { summary: me.summary, hasWhatIWant: false, wantsWhatIHave: false });
    expect(choosePartner(me, [same])).toBeNull();
    expect(choosePartner(me, [{ ...same, hasWhatIWant: true }])).not.toBeNull();
    expect(choosePartner(me, [{ ...same, dueAnyway: true }])).not.toBeNull();
  });

  // Decision 230 as amended: a Share nearby resets the day the quiet mode reads only if a Hello happens, so a pair
  // already up to date greets anyway; never one on the revocation list.
  it('greets a teammate due on Share nearby, with nothing to swap and even when the two finished unchanged, but never a listed one', () => {
    const same = peer('000000000009', { summary: me.summary, hasWhatIWant: false, wantsWhatIHave: false, finished: { mine: me.summary, theirs: me.summary } });
    expect(choosePartner(me, [same])).toBeNull();
    expect(choosePartner(me, [{ ...same, greet: true }])).toEqual({ partner: '000000000009', connect: true });
    expect(choosePartner(me, [{ ...same, greet: true, listed: true }])).toBeNull();
  });

  it('two phones that finished unchanged do not reconnect, even with summaries that differ', () => {
    const finished = peer('000000000009', { finished: { mine: me.summary, theirs: 'bbbbbbbb' } });
    expect(choosePartner(me, [finished])).toBeNull();
    // Either side changing reopens it.
    expect(choosePartner({ ...me, summary: 'cccccccc' }, [finished])).not.toBeNull();
    expect(choosePartner(me, [{ ...finished, summary: 'dddddddd' }])).not.toBeNull();
    // Being due overrides only the equal-summary rule, which rests on what others claim.
    expect(choosePartner(me, [{ ...finished, dueAnyway: true }])).toBeNull();
  });

  // Review item 15: a session whose events named documents no ask covered leaves summaries that cannot say so.
  it('a teammate with documents still to ask for is worth a session with equal summaries and a finished record, but never a listed one', () => {
    const same = peer('000000000009', { summary: me.summary, hasWhatIWant: false, wantsWhatIHave: false, finished: { mine: me.summary, theirs: me.summary } });
    expect(choosePartner(me, [same])).toBeNull();
    expect(choosePartner(me, [{ ...same, docsAgain: true }])?.partner).toBe('000000000009');
    expect(choosePartner(me, [{ ...same, docsAgain: true, listed: true }])).toBeNull();
  });

  // Review P3: one review mark made a session worth having, and nothing spaced out sessions with the same partner.
  it('a teammate met a moment ago is met again so soon only for files, or for documents still to ask for', () => {
    const changed = peer('000000000009', { hasWhatIWant: false, wantsWhatIHave: false });
    expect(choosePartner(me, [changed])).not.toBeNull();
    expect(choosePartner(me, [{ ...changed, recent: true }])).toBeNull();
    expect(choosePartner(me, [{ ...changed, recent: true, hasWhatIWant: true }])).not.toBeNull();
    expect(choosePartner(me, [{ ...changed, recent: true, wantsWhatIHave: true }])).not.toBeNull();
    expect(choosePartner(me, [{ ...changed, recent: true, docsAgain: true }])).not.toBeNull();
  });

  it('a refused pair recorded as finished is not picked again', () => {
    const refused = peer('000000000009', { finished: { mine: me.summary, theirs: 'bbbbbbbb' } });
    expect(choosePartner(me, [refused, peer('00000000000a', { position: 3 })])?.partner).toBe('00000000000a');
  });

  it('drops a listed key', () => {
    expect(choosePartner(me, [peer('000000000009', { listed: true })])).toBeNull();
  });

  it('prefers one never met, then the longest ago, then the lowest tag', () => {
    expect(choosePartner(me, [peer('000000000009', { position: 0 }), peer('00000000000a')])?.partner).toBe('00000000000a');
    expect(choosePartner(me, [peer('000000000009', { position: 4 }), peer('00000000000a', { position: 1 })])?.partner).toBe('00000000000a');
    expect(choosePartner(me, [peer('00000000000c'), peer('00000000000b')])?.partner).toBe('00000000000b');
  });

  it('only the lower tag connects; the other waits, then may', () => {
    expect(choosePartner(me, [peer('000000000009')])).toEqual({ partner: '000000000009', connect: true });
    expect(choosePartner(me, [peer('000000000001')])).toEqual({ partner: '000000000001', connect: false });
    expect(choosePartner(me, [peer('000000000001')], { waited: true })).toEqual({ partner: '000000000001', connect: true });
  });

  it('a phone heard under an older generation is connected to at once, whatever the tags, because it cannot hear this one', () => {
    expect(choosePartner(me, [peer('000000000001', { older: true })])).toEqual({ partner: '000000000001', connect: true });
  });

  it('never connects to a phone that has not echoed, even when waited or older', () => {
    expect(choosePartner(me, [peer('000000000009', { echoed: false, older: true })], { waited: true })?.connect).toBe(false);
  });

  it('of two phones that pick each other, exactly one connects, whatever else is in range', () => {
    const tagArb = fc.integer({ min: 0, max: 0xffff }).map((n) => n.toString(16).padStart(12, '0'));
    fc.assert(fc.property(tagArb, tagArb, fc.array(tagArb, { maxLength: 4 }), (a, b, others) => {
      fc.pre(a !== b && !others.includes(a) && !others.includes(b));
      const sa = { tag: a, summary: 'aaaaaaaa' };
      const sb = { tag: b, summary: 'bbbbbbbb' };
      const fromA = choosePartner(sa, [peer(b, { summary: sb.summary }), ...others.map((t) => peer(t, { position: 0 }))]);
      const fromB = choosePartner(sb, [peer(a, { summary: sa.summary }), ...others.map((t) => peer(t, { position: 0 }))]);
      if (fromA?.partner === b && fromB?.partner === a) expect(Number(fromA.connect) + Number(fromB.connect)).toBe(1);
    }));
  });

  it('is pure: the same answer whatever order the room lists phones in', () => {
    const list = [peer('00000000000c', { position: 2 }), peer('00000000000b'), peer('00000000000d', { position: 0 }), peer('00000000000e')];
    const first = choosePartner(me, list);
    expect(choosePartner(me, [...list].reverse())).toEqual(first);
    expect(first?.partner).toBe('00000000000b');
  });
});
