// New language's draft (decision 143): the events a new language starts with, made on its check pages before it exists.
import { checkShows, checkShowsSpecs, commands, deriveFlow, DEFAULT_KINDS, emptyLanguageState } from '@langquest-next/core';
import { DRAFT_LANGUAGE, draftChanged, draftSpecsFor, foldDraft, newDraft, orgWithDraft } from '../src/checks/languageDraftModel';
import { ORG } from './sessions';

const flow = commands(emptyLanguageState()).copyFlow({ commandId: 'c1', name: 'Quick Check', kinds: DEFAULT_KINDS, steps: [{ kindIds: ['peer'] }, { kindIds: ['final'], checkpoint: true }] });
const draft = newDraft({ name: 'Lopit', reads: ['eng', 'grc'], actorId: 'admin', from: 'quick', specs: flow, nowMs: 1_760_000_000_000 });

describe('New language’s draft (decision 143)', () => {
  it('folds as the language’s stream would: its checks, in order, and its reference languages', () => {
    const state = foldDraft(draft);
    expect(Object.keys(state.invalidEvents)).toEqual([]);
    expect(deriveFlow(state).steps.map((s) => [s.kindIds, s.checkpoint])).toEqual([[['peer'], false], [['final'], true]]);
    expect(state.referenceLanguage?.value).toBe('eng');
    expect(Object.keys(state.referenceLanguagesAdded ?? {})).toEqual(['grc']);
    expect(draftChanged(draft)).toBe(false);
  });

  it('a change made later wins, as in a stream', () => {
    const state = foldDraft(draft);
    const hide = checkShowsSpecs(state, { commandId: 'h', kindId: 'peer', what: 'bibleText', shown: false });
    const show = checkShowsSpecs(foldDraft({ ...draft, specs: [...draft.specs, ...hide] }), { commandId: 's', kindId: 'peer', what: 'bibleText', shown: true });
    const changed = { ...draft, specs: [...draft.specs, ...hide, ...show] };
    expect(checkShows(foldDraft(changed), 'peer').bibleText).toBe(true);
    expect(checkShows(foldDraft({ ...draft, specs: [...draft.specs, ...hide] }), 'peer').bibleText).toBe(false);
    expect(draftChanged(changed)).toBe(true);
  });

  it('gives each new language its own copy, under ids of that language, without the reference languages it is added with', () => {
    const a = draftSpecsFor('L-lpx-1', draft.specs);
    const b = draftSpecsFor('L-lpx-2', draft.specs);
    expect(a.map((s) => s.payload)).toEqual(draft.specs.map((s) => s.payload));
    expect(a.every((s) => s.id.startsWith('L-lpx-1:'))).toBe(true);
    expect(new Set([...a, ...b].map((s) => s.id)).size).toBe(a.length + b.length);
    expect(a.some((s) => s.type === 'v1.ReferenceLanguageSet')).toBe(false);
  });

  it('is listed by the organization the draft’s pages see, by its name and reference language', () => {
    const org = orgWithDraft(ORG, draft)!;
    expect(org.languages[DRAFT_LANGUAGE]?.added).toMatchObject({ name: 'Lopit', sourceCode: 'eng' });
    expect(ORG.languages[DRAFT_LANGUAGE]).toBeUndefined();
  });
});
