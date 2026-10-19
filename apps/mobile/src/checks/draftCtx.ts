// The pages a ready language sets its checks up on, working on New
// language's draft (decisions.md 141): the same screen code, given a ctx
// whose language is the draft. What they write goes into the draft, never a
// stream; the organization lists the draft by its name and reference
// language; and what this person may do there is what they may do across
// the organization, since the language is added under those privileges.
import { privilegesFor, type EventPayloads, type EventSpec, type EventType, type Privilege } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { addToDraft, type DraftSnapshot } from './draft';
import { DRAFT_LANGUAGE, orgWithDraft } from './languageDraftModel';

export function draftCtx(ctx: Ctx, snap: DraftSnapshot): Ctx {
  const org = ctx.org.state;
  const mine: ReadonlySet<Privilege> = org ? privilegesFor(org, ctx.session.actorId) : new Set<Privilege>();
  const run = (specs: EventSpec[]) => { addToDraft(specs); return Promise.resolve(); };
  const spec = <T extends EventType>(type: T, payload: EventPayloads[T]) => ({ id: Crypto.randomUUID(), type, payload }) as EventSpec;
  return {
    ...ctx,
    org: { ...ctx.org, state: orgWithDraft(org, snap.draft) },
    language: {
      ...ctx.language,
      languageId: DRAFT_LANGUAGE,
      state: snap.state,
      revision: snap.revision,
      pulled: true,
      refused: null,
      refusedEvents: 0,
      run,
      append: (type, payload) => run([spec(type, payload)]),
      appendMany: (items) => run(items.map((x) => spec(x.type, x.payload)))
    },
    session: { ...ctx.session, can: (p) => mine.has(p) },
    act: (specs, message) => { addToDraft(specs); ctx.toast(message); return Promise.resolve(); },
    // The draft's pages open one another as drafts; a language id would open a language.
    go: (to, params = {}) => {
      const { languageId: _language, ...rest } = params;
      ctx.go(to, { ...rest, draft: '1' });
    }
  };
}

/** A page opened for a draft that is gone (New language closed): nothing to show, and nothing it does reaches a language. */
export function goneCtx(ctx: Ctx): Ctx {
  return { ...ctx, language: { ...ctx.language, languageId: DRAFT_LANGUAGE, state: null }, act: () => Promise.resolve() };
}
