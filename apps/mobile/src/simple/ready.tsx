// Getting a language ready, read from the record (decision 71, demo
// ADR-039): which of the four questions are answered, what each answer says
// in plain words, who translates there and who is waiting to be let in. The
// language's page (screens/org.tsx LanguageHome) and Get ready
// (screens/getReady.tsx) both read it, so they always agree.
import {
  deriveFlow, languageName, libraryItems, libraryItemView, mayGrantRole, recommendedFor, scopeKey,
  type LibraryDoc, type Scope, type SourceDoc, type TemplateDoc
} from '@langquest-next/core';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { deriveKinds } from '../coreText';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { pendingRequests, type PendingRequest } from '../invites';
import { useLibraryDocs } from '../library/useLibrary';
import { noteExpected } from '../report';
import { space } from '../theme';
import { ChecklistRow } from './admin';
import {
  flowShort, guideShortName, helpsSummary, invitedTo, languageLabel, languageTranslators, plainRoleChoices, QUESTIONS, questionLabel, readiness,
  recordSummary, translatorsOf, type Readiness, type RoleInfo
} from './adminModel';

export interface ReadySummary {
  languageId: string;
  name: string;
  readiness: Readiness;
  /** Plain answers, per question; undefined while unanswered. */
  lines: (string | undefined)[];
  /** Everyone who translates there (the organization's translators too). */
  team: string[];
}

/** What the four questions say for the open language. */
export function useReadySummary(ctx: Ctx): ReadySummary {
  const state = ctx.language.state;
  const org = ctx.org.state;
  const languageId = ctx.language.languageId;
  const orgId = ctx.language.orgId;
  const sel = state?.template?.value;
  const offered = useMemo(() => recommendedFor(org?.recommendations, state), [org, state]);
  // Recommended items and the library's own material (guides and notes reach the team unless hidden).
  const offeredHashes = [...offered.keys(), ...libraryItems(org?.library ?? {}, 'material').map((it) => it.itemId)].map((id) => libraryItemView(org?.library ?? {}, id)?.current);
  const docs = useLibraryDocs(orgId, [sel?.docHash, ...offeredHashes], { deps: false });
  return useMemo(() => {
    const templateDoc = docs.get<TemplateDoc>(sel?.docHash);
    const templateName = sel ? libraryItemView(org?.library ?? {}, sel.itemId)?.name ?? templateDoc?.name : undefined;
    const bibles: string[] = [];
    const guides: string[] = [];
    let notes = 0;
    // What reaches the team: recommended items, and the library's guides and notes not hidden here (reference/offered.ts).
    const reach = new Set(offered.keys());
    for (const it of libraryItems(org?.library ?? {}, 'material')) {
      if (it.current && !it.archived && state?.languageReferences[it.itemId]?.value !== 'hidden') reach.add(it.itemId);
    }
    for (const id of reach) {
      const it = libraryItemView(org?.library ?? {}, id);
      const doc: LibraryDoc | null = docs.get(it?.current);
      if (!it || it.archived || !doc) continue;
      if (doc.format === 'source@1') { if (offered.has(id)) bibles.push(languageLabel((doc as SourceDoc).language)); }
      else if (doc.format === 'study@1' || doc.format === 'study@2' || doc.format === 'collection@1') guides.push(guideShortName(it.name));
      else if (doc.format === 'material@1' && doc.kind === 'note') notes++;
    }
    const flow = state?.flow ? deriveFlow(state) : null;
    const team = translatorsOf(org, languageId);
    const facts = {
      template: !!sel, helps: bibles.length + guides.length + notes > 0, flow: !!flow,
      translators: languageTranslators(org, languageId).length, invited: invitedTo(org, languageId)
    };
    const r = readiness(facts);
    const lines = [
      sel ? recordSummary(templateDoc, sel.books, templateName) : undefined,
      facts.helps ? helpsSummary(bibles, guides, notes) : undefined,
      flow && state ? flowShort(flow.steps, deriveKinds(state)) : undefined,
      r.done[3] ? (team.length ? t('admin.ready.translators', { count: team.length }) : t('admin.ready.invited')) : undefined
    ];
    return { languageId, name: languageName(org, languageId), readiness: r, lines, team };
  }, [docs, sel, org, state, offered, languageId]);
}

/** Join requests this person may decide; empty for everyone else, and offline (a server read). */
export function usePendingRequests(ctx: Ctx): PendingRequest[] {
  const may = ctx.session.can('invite_members');
  const orgId = ctx.language.orgId;
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  useEffect(() => {
    if (!may) return;
    let live = true;
    void pendingRequests(orgId).then((r) => { if (live) setRequests(r); }).catch((e: unknown) => noteExpected('language join requests', e));
    return () => { live = false; };
  }, [may, orgId]);
  return requests;
}

/** The four questions as a checklist; each opens its own step screen. */
export function ReadyChecklist(props: { ctx: Ctx; s: ReadySummary }) {
  const { ctx, s } = props;
  return (
    <View style={{ gap: space.md }}>
      {QUESTIONS.map((q, i) => (
        <ChecklistRow key={q.id} icon={q.icon} label={questionLabel(q.id)} sub={s.lines[i]}
          state={s.readiness.done[i] ? 'done' : i === s.readiness.current ? 'now' : 'later'}
          onPress={() => ctx.go('get_ready', { languageId: s.languageId, step: String(i + 1) })} />
      ))}
    </View>
  );
}

/** "How this works": the checklist's own words, spoken in help mode (about 40 seconds). */
export function howItWorks(language: string): string {
  return t('admin.howItWorks.text', { language });
}

/** The four plain choices of what someone will do, from this organization's roles. */
/**
 * The roles to offer as plain choices. With a scope, only those this person
 * may grant there: nobody invites to more than they hold (decisions.md 75).
 */
export function usePlainRoles(ctx: Ctx, scope?: Scope | null) {
  // The fold changes its maps in place; the state object is new on every change.
  const org = ctx.org.state;
  const me = ctx.session.actorId;
  const key = scope ? scopeKey(scope) : '';
  return useMemo(() => {
    const list: RoleInfo[] = Object.entries(org?.roles ?? {}).filter(([id, r]) => !r.retired && (!scope || mayGrantRole(org, me, id, scope)))
      .map(([id, r]) => ({ id, name: r.name.value || id, privileges: r.privileges.value ?? [] }));
    return plainRoleChoices(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scope is its key
  }, [org, me, key]);
}
