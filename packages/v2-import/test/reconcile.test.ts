import { describe, expect, it } from 'vitest';
import { decodeHlc, foldLanguage, foldOrg, ORG_STREAM, validateEvent, type AnyEvent } from '@langquest-next/core';
import { reconcile, type Fact, type LedgerEntry, type ReconcileContext } from '../src/reconcile';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ctx: ReconcileContext = { orgId: 'org1', scope: 'p1', now: NOW };

/** A language's name, a register: changes are said again, and gone means renamed back to nothing we know. */
function renamed(name: string, at = '2026-01-01T00:00:00Z'): Fact {
  return {
    key: 'name', streamId: ORG_STREAM, actorId: 'owner', at,
    say: () => [{ type: 'v1.LanguageRenamed', payload: { languageId: 'p1', name } }],
    unsay: () => []
  };
}

/** A note: grow-only, with an id of its own per statement; taken back by redaction. */
function note(text: string, at = '2026-02-01T00:00:00Z'): Fact {
  return {
    key: 'note:a1', streamId: 'p1', actorId: 'trans', at,
    say: (s) => [{ type: 'v1.NoteAdded', payload: { noteId: `note:a1#${s.n}`, unitId: 'u1', anchor: { kind: 'passage' }, text } }],
    unsay: 'redact'
  };
}

/** Run passes like the runner does: apply the entries returned to the ledger. */
function passes(steps: Fact[][], c = ctx): { all: AnyEvent[]; each: AnyEvent[][]; ledger: Map<string, LedgerEntry> } {
  const ledger = new Map<string, LedgerEntry>();
  const all: AnyEvent[] = [];
  const each: AnyEvent[][] = [];
  for (const facts of steps) {
    const r = reconcile(facts, ledger, c);
    for (const [k, e] of r.entries) ledger.set(k, e);
    all.push(...r.events);
    each.push(r.events);
  }
  return { all, each, ledger };
}

describe('reconcile', () => {
  it('says a new fact once, and nothing on the next pass', () => {
    const { each } = passes([[renamed('Kwa')], [renamed('Kwa')]]);
    expect(each[0]!.map((e) => e.id)).toEqual(['v2:p1:name#1:LanguageRenamed']);
    expect(each[1]).toEqual([]);
    for (const e of each[0]!) expect(validateEvent(e)).toBeNull();
  });

  it('says a changed fact again with a later clock, and a change back wins too', () => {
    // v2 timestamps come from phones: the change back carries an older clock than the change.
    const { all } = passes([[renamed('Kwa', '2026-03-01T00:00:00Z')], [renamed('Kwaa', '2026-03-02T00:00:00Z')], [renamed('Kwa', '2026-01-01T00:00:00Z')]]);
    expect(all.map((e) => e.id)).toEqual(['v2:p1:name#1:LanguageRenamed', 'v2:p1:name#2:LanguageRenamed', 'v2:p1:name#3:LanguageRenamed']);
    const walls = all.map((e) => decodeHlc(e.hlc).wallMs);
    expect(walls[1]! > walls[0]! && walls[2]! > walls[1]!).toBe(true);
    const created = { id: 'seed', type: 'v1.LanguageAdded', orgId: 'org1', streamId: ORG_STREAM, actorId: 'owner', deviceId: 'd', hlc: '000000000000001:000000:d', payload: { languageId: 'p1', name: 'x', code: 'und', sourceCode: 'eng' } } as AnyEvent;
    expect(foldOrg([created, ...all]).languages['p1']?.renamed?.value).toBe('Kwa');
  });

  it('never stamps a clock later than now', () => {
    const { all } = passes([[renamed('Kwa', '2099-01-01T00:00:00Z')]]);
    expect(decodeHlc(all[0]!.hlc).wallMs).toBe(NOW);
  });

  it('keeps what a fact said when v2 no longer has it: nothing said here disappears', () => {
    const { each, ledger } = passes([[note('one')], [note('two')], []]);
    expect(each[2]).toEqual([]);
    expect(ledger.get('note:a1')).toMatchObject({ withdrawn: false });
  });

  it("redacts everything a fact said when it is the dashboard's to drop and is dropped", () => {
    const { each, ledger } = passes([[note('one')], [note('two')], []], { ...ctx, takeBackAbsent: true });
    const said = [...each[0]!, ...each[1]!].map((e) => e.id);
    expect(each[2]!.map((e) => e.type)).toEqual(['v1.Redacted', 'v1.Redacted']);
    expect(each[2]!.map((e) => (e.payload as { eventId: string }).eventId)).toEqual(said);
    expect(ledger.get('note:a1')).toMatchObject({ withdrawn: true, live: [] });
    const state = foldLanguage([...each[0]!, ...each[1]!, ...each[2]!]);
    expect(Object.keys(state.notes)).toEqual([]);
  });

  it('leaves a fact v2 turns off as it is, takes it back only when withdrawn here, and says it again when it returns', () => {
    const member = (gone: boolean, withdraw = false): Fact => ({
      key: 'member:trans', streamId: ORG_STREAM, actorId: 'owner', at: '2026-04-01T00:00:00Z', gone, withdraw,
      say: () => [{ type: 'v1.MemberAdded', payload: { profileId: 'trans', roleId: 'translator', scope: { level: 'language', languageId: 'p1' } } }],
      unsay: () => [{ type: 'v1.MemberRemoved', payload: { profileId: 'trans', scope: { level: 'language', languageId: 'p1' } } }]
    });
    const { each } = passes([[member(false)], [member(true)], [member(false, true)], [member(false, true)], [member(false)]]);
    expect(each.map((p) => p.map((e) => e.type))).toEqual([['v1.MemberAdded'], [], ['v1.MemberRemoved'], [], ['v1.MemberAdded']]);
    expect(each[4]![0]!.id).toBe('v2:p1:member:trans#3:MemberAdded');
  });

  it('ignores a change to a fact that is not worth saying again', () => {
    const unit = (label: string): Fact => ({
      key: 'unit:q1', streamId: 'p1', actorId: 'owner', at: '2026-01-01T00:00:00Z', restate: false,
      say: () => [{ type: 'v1.UnitAdded', payload: { unitId: 'q1', parentUnitId: null, kind: 'book', label, order: '000000' } }],
      unsay: () => [{ type: 'v1.UnitHidden', payload: { unitId: 'q1', hidden: true } }],
      resay: () => [{ type: 'v1.UnitHidden', payload: { unitId: 'q1', hidden: false } }]
    });
    const { each } = passes([[unit('Creation')], [unit('Genesis')], [], [unit('Genesis')]], { ...ctx, takeBackAbsent: true });
    expect(each.map((p) => p.map((e) => e.type))).toEqual([['v1.UnitAdded'], [], ['v1.UnitHidden'], ['v1.UnitHidden']]);
    expect((each[3]![0]!.payload as { hidden: boolean }).hidden).toBe(false);
  });

  it('gives a pass that died before saving its ledger the same ids, so the retry is all duplicates', () => {
    const first = reconcile([renamed('Kwa'), note('one')], new Map(), ctx);
    const retry = reconcile([renamed('Kwa'), note('one')], new Map(), ctx);
    expect(retry.events).toEqual(first.events);
  });

  it('numbers several events of one type within a statement', () => {
    const take: Fact = {
      key: 'take:q1', streamId: 'p1', actorId: 'trans', at: '2026-05-01T00:00:00Z',
      say: (s) => [
        { type: 'v1.TakeComposed', payload: { takeId: `take:q1#${s.n}`, unitId: 'q1', cardHashes: ['h1'], parentTakeId: s.lastSaid ? `take:q1#${s.lastSaid}` : null } },
        { type: 'v1.TakeSubmitted', payload: { takeId: `take:q1#${s.n}` } }
      ],
      unsay: 'redact'
    };
    const r = reconcile([take], new Map(), ctx);
    expect(r.events.map((e) => e.id)).toEqual(['v2:p1:take:q1#1:TakeComposed', 'v2:p1:take:q1#1:TakeSubmitted']);
    // Composed before submitted, on the same clock tick.
    expect(r.events[0]!.hlc < r.events[1]!.hlc).toBe(true);
  });

  it('refuses a fact said twice in one pass', () => {
    expect(() => reconcile([renamed('a'), renamed('b')], new Map(), ctx)).toThrow(/said twice/);
  });
});
