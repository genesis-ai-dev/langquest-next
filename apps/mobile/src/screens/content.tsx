// Content templates: the structure each language records against. Ports the
// UX demo's src/screens/content.tsx: ContentTemplatesScreen (templates_home,
// the organization's library and a language's own template), TemplatePickerScreen
// (template_picker), TemplateEditorScreen (template_editor) and
// BookStructureScreen (book_structure). Requirements TPL-1..9; ADR-025
// (a language owns its copy, suggestions are advice), ADR-026 (a whole book
// in one scroll) and ADR-027 (the book reads like a Bible, FIA's breaks are
// suggestions). The catalog templates ship with the app (core
// `contentTemplates()`); choosing one for a language is the old
// TemplatesHome's selection. Dividing books, drafts, publishing, template
// tasks and library editing need events that do not exist yet, so those
// screens read the structure and say editing is coming.
//
// There is no project level (docs/decisions.md 34): the organization
// suggests, each language chooses. templates_home params: `level` ('org' |
// 'language'; an old 'project' reads as 'org') and/or
// `laneId`. template_editor: `templateId` (a library template) or `laneId`
// (a language's copy). book_structure: `laneId`, `bookId`.
import { CommandError, contentTemplate, contentTemplates, derivePassage, languageProgress, laneName, privilegesFor, type ContentTemplate } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  bibleBook, bookRows, bookSegments, chapterBlocks, chipLabel, continuesInto, fiaStarts, laneTemplate, partName, pluralOf,
  recordedCount, setAsideCount, suggestedAt, suggestionsFor, templateLeafCount, templateLevels, templateOutline,
  templateRestoreSpecs, templateSelectionSpecs, templateUsage, versesText, type BibleBook, type Block, type Segment
} from '../contentTemplates';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Banner, Card, Chip, ChipRow, Disclosure, EmptyState, GhostBtn, Group, Header, Ico, PrimaryBtn, Row, Screen, SearchField,
  SectionLabel, SmallBtn, Sheet, ShowMore, Toggle, txt
} from '../kit';
import { plural } from '../passageView';
import { reportError, failureMessage } from '../report';
import { readingsFor } from '../scripture';
import { contractsFor } from '../screenContracts';
import { C, radius, space, target, tile, TINT, type as T } from '../theme';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

const lower = (s: string) => s.toLowerCase();

type Level = 'org' | 'language';

/** Which view of templates this is: the level from params, else the viewer's own scope (ADR-017). */
function levelOf(ctx: Ctx): { level: Level; laneId: string | null } {
  const level = ctx.params['level'];
  const laneParam = ctx.params['laneId'];
  if (level === 'org' || level === 'project') return { level: 'org', laneId: null };
  if (level === 'language' || level === 'lane' || laneParam) return { level: 'language', laneId: laneParam ?? ctx.laneId };
  const scope = ctx.session.adminScope;
  if (scope?.level === 'org' || scope?.level === 'project') return { level: 'org', laneId: null };
  return { level: 'language', laneId: scope?.laneId ?? ctx.laneId };
}

function orgName(ctx: Ctx): string {
  return ctx.org.state?.org?.value.name ?? 'Your organization';
}

/** Book › Chapter › Passage: folders, then what's recorded (TPL-2). */
function LevelsLine(props: { levels: string[] }) {
  return (
    <View style={styles.levels} accessibilityLabel={`Levels: ${props.levels.join(', ')}`}>
      {props.levels.map((l, i) => (
        <View key={`${l}-${i}`} style={styles.level}>
          {i > 0 ? <Ico name="right" size={14} color={C.muted} /> : null}
          <Ico name={i === props.levels.length - 1 ? 'media' : 'folder'} size={16} color={C.primary} />
          <Text style={[txt.sm, { color: C.primary, fontWeight: '700' }]}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function Loading(props: { title: string; onBack: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="template" title="Getting your organization ready…" />
    </Screen>
  );
}

// ---- Content Templates -------------------------------------------------------------------

export function TemplatesHome(ctx: Ctx) {
  const { level, laneId } = levelOf(ctx);
  if (level === 'language') return <LanguageTemplateView ctx={ctx} laneId={laneId} />;
  return <TemplateLibraryView ctx={ctx} />;
}

/** The organization: the library, what it suggests, and what each language uses (TPL-1). */
function TemplateLibraryView({ ctx }: { ctx: Ctx }) {
  const level = 'org' as const;
  const state = ctx.project.state;
  const org = ctx.org.state;
  const projectId = ctx.project.projectId;
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(8);
  const library = contentTemplates();
  const usage = useMemo(() => (state ? templateUsage(state) : []), [state]);
  const scopeName = orgName(ctx);
  // Suggesting at the org level needs the permission there, not only over its languages.
  const canManage = !!org && privilegesFor(org, ctx.session.actorId, {}).has('manage_templates');
  const canOpen = ctx.session.can('manage_templates');

  const suggested = (id: string) => suggestedAt(org, id, level, projectId);
  const sorted = [...library].sort((a, b) => {
    const rank = (t: ContentTemplate) => (suggested(t.id) ? 0 : 1);
    return rank(a) - rank(b);
  });

  async function toggle(t: ContentTemplate) {
    if (busy || !canManage) return;
    const on = !suggested(t.id);
    const payload = (enabled: boolean) => ({ kind: 'template' as const, itemId: t.id, level, enabled });
    setBusy(true);
    try {
      await ctx.org.append('v1.CatalogItemToggled', payload(on));
      ctx.toast(on ? `${t.name} is suggested to languages in ${scopeName}.` : `${t.name} is no longer suggested.`, async () => {
        try {
          await ctx.org.append('v1.CatalogItemToggled', payload(!on));
          ctx.toast('Undone.');
        } catch (e) {
          ctx.toast(`Not undone. ${failure('undo template suggestion', e)}`);
        }
      });
    } catch (e) {
      ctx.toast(`Not saved. ${failure('template suggestion', e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title="Content Templates" sub={scopeName} onBack={ctx.back} />}>
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
        A template is the structure a language records against — books and passages, or lessons, or stories. Each language keeps its own copy.
        {canManage ? ` Suggest the ones languages in ${scopeName} should start from; whoever sets a language up can still choose another.` : ''}
      </Text>
      {sorted.map((t) => {
        const users = usage.filter((u) => u.templateId === t.id).map((u) => (state ? laneName(state, u.laneId) : u.laneId));
        const on = suggested(t.id);
        return (
          <Card key={t.id}>
            <View style={styles.head}>
              <View style={styles.tile}><Ico name="book" size={22} color={C.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={txt.h3}>{t.name}</Text>
                <Text style={[txt.smMuted, { marginTop: 2 }]}>{t.description}</Text>
              </View>
            </View>
            <LevelsLine levels={templateLevels(t)} />
            <Text style={[txt.sm, { fontWeight: '600', color: users.length ? C.primary : C.muted }]}>
              {users.length ? `Used by ${users.join(', ')}` : 'Not used here yet'}
            </Text>
            <View style={styles.cardActions}>
              {canManage ? (
                <View style={styles.toggle}>
                  <Toggle on={on} onToggle={() => void toggle(t)} label={`Suggest ${t.name}`} disabled={busy} />
                  <Text style={[txt.sm, { fontWeight: '700', color: on ? C.primary : C.muted }]}>{on ? 'Suggested' : 'Suggest'}</Text>
                </View>
              ) : <View style={{ flex: 1 }} />}
              {canOpen ? <SmallBtn label="View" icon="right" onPress={() => ctx.go('template_editor', { templateId: t.id })} /> : null}
            </View>
          </Card>
        );
      })}
      <SectionLabel label="By language" />
      {usage.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No languages here yet.</Text>
      ) : (
        <>
          <Group>
            {usage.slice(0, limit).map((u, i, shown) => {
              const t = u.templateId ? contentTemplate(u.templateId) : undefined;
              const catalogVersion = state?.laneTemplates[u.laneId]?.value.catalogVersion;
              return (
                <Row key={u.laneId} icon="globe" iconColor={C.muted} iconBg={C.bg} label={state ? laneName(state, u.laneId) : u.laneId}
                  sub={t ? `${t.name} · catalog version ${catalogVersion ?? 1}` : 'No template yet'} last={i === shown.length - 1} />
              );
            })}
          </Group>
          <ShowMore remaining={usage.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
        </>
      )}
    </Screen>
  );
}

/** A language: its own template, its levels and counts, Change, and the books to divide (TPL-1, TPL-4, TPL-7). */
function LanguageTemplateView({ ctx, laneId }: { ctx: Ctx; laneId: string | null }) {
  const state = ctx.project.state;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const data = useMemo(() => {
    if (!state || !laneId || !state.lanes[laneId]) return null;
    const idx = indexesFor(state);
    return {
      lane: laneName(state, laneId),
      template: laneTemplate(state, laneId),
      selection: state.laneTemplates[laneId]?.value,
      books: bookRows(state, idx, laneId),
      progress: languageProgress(state, laneId, idx),
      setAside: setAsideCount(state, laneId)
    };
  }, [state, laneId]);
  if (!state) return <Loading title="Content Template" onBack={ctx.back} />;
  if (!data || !laneId) {
    return (
      <Screen header={<Header title="Content Template" onBack={ctx.back} />}>
        <EmptyState icon="globe" title="No language chosen" sub="Open Content Templates from a language to see the structure it records against." />
      </Screen>
    );
  }
  const canManage = ctx.session.can('manage_templates');
  const canShape = ctx.session.can('shape_templates') || canManage;
  const t = data.template;
  const levels = t ? templateLevels(t) : [];
  const last = levels.at(-1) ?? 'Passage';
  const parts = lower(pluralOf(last));
  const q = query.trim().toLowerCase();
  const books = data.books.filter((b) => !q || b.book.label.toLowerCase().includes(q));

  return (
    <Screen header={<Header title="Content Template" sub={data.lane} onBack={ctx.back} />}>
      {t ? (
        <Card>
          <View>
            <Text style={txt.label}>{data.lane} records against</Text>
            <Text style={[txt.h2, { marginTop: space.xs }]}>{t.name}</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>Based on {t.name} · catalog version {data.selection?.catalogVersion ?? 1}</Text>
          </View>
          <LevelsLine levels={levels} />
          <Text style={txt.sm}>
            {`${plural(data.books.length, 'book')} · ${plural(data.progress.total, lower(last), parts)} · ${data.progress.recorded.toLocaleString('en-US')} recorded`}
          </Text>
          {canManage ? (
            <View style={styles.pair}>
              <View style={{ flex: 1 }}><GhostBtn label="Levels" icon="edit" onPress={() => ctx.go('template_editor', { laneId })} /></View>
              <View style={{ flex: 1 }}><GhostBtn label="Change" icon="swap" onPress={() => ctx.go('template_picker', { laneId })} /></View>
            </View>
          ) : null}
        </Card>
      ) : (
        <Card>
          <Text style={txt.h3}>No template yet</Text>
          <Text style={txt.smMuted}>
            {canManage
              ? `Choose the structure ${data.lane} records against. Its passages come from the template.`
              : `Whoever manages content templates chooses the structure ${data.lane} records against.`}
          </Text>
          {canManage ? <PrimaryBtn label="Choose a template" icon="template" onPress={() => ctx.go('template_picker', { laneId })} /> : null}
        </Card>
      )}

      {data.setAside > 0 ? (
        <Banner icon="history" title={`${plural(data.setAside, 'recorded part')} set aside`}
          body={`${data.setAside === 1 ? 'It is' : 'They are'} from an earlier template, set aside, not deleted. Change back to that template to bring ${data.setAside === 1 ? 'it' : 'them'} back.`} />
      ) : null}

      {t && canShape && data.books.length > 0 ? (
        <>
          <SectionLabel label={`Divide into ${parts}`} />
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            Open a book to read through it and see where each {lower(last)} starts, with FIA's breaks marked as suggestions.
          </Text>
          <SearchField value={query} onChangeText={(v) => { setQuery(v); setLimit(8); }} placeholder="Find a book" />
          {books.length === 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No book matches “{query.trim()}”.</Text>
          ) : (
            <Group>
              {books.slice(0, limit).map((b, i, shown) => (
                <Row key={b.book.itemId} icon="book" label={b.book.label} sub={plural(b.parts, lower(last), parts)}
                  onPress={() => ctx.go('book_structure', { laneId, bookId: b.book.itemId })} last={i === shown.length - 1} />
              ))}
            </Group>
          )}
          <ShowMore remaining={books.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
        </>
      ) : null}
    </Screen>
  );
}

// ---- Choose a Template ------------------------------------------------------------------------

export function TemplatePicker(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? ctx.laneId;
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const library = contentTemplates();
  const recorded = useMemo(() => (state && laneId ? recordedCount(state, laneId) : 0), [state, laneId]);
  if (!state) return <Loading title="Choose a Template" onBack={ctx.back} />;
  if (!laneId || !state.lanes[laneId]) {
    return (
      <Screen header={<Header title="Choose a Template" onBack={ctx.back} />}>
        <EmptyState icon="globe" title="No language chosen" sub="Choose a template from a language's Content Template." />
      </Screen>
    );
  }
  const lane = laneName(state, laneId);
  const current = state.laneTemplates[laneId]?.value;
  const currentT = current ? contentTemplate(current.templateId) : undefined;
  const suggestions = suggestionsFor(ctx.org.state, ctx.project.projectId, library);
  const suggested = suggestions.flatMap((s) => {
    const t = library.find((x) => x.id === s.templateId);
    return t ? [{ t, by: orgName(ctx) }] : [];
  });
  const others = library.filter((t) => !suggestions.some((s) => s.templateId === t.id));
  const pick = library.find((t) => t.id === picked);
  const canUse = ctx.session.can('manage_templates');

  async function use(t: ContentTemplate) {
    if (!state || !laneId || busy || !canUse) return;
    setBusy(true);
    try {
      const specs = templateSelectionSpecs(state, laneId, t.id, Crypto.randomUUID());
      const previous = current;
      // ctx.act says "Not saved" and why itself; stay here to try again.
      try {
        await ctx.act(specs, `${lane} now records against ${t.name}.`,
          previous ? () => templateRestoreSpecs(laneId, previous, Crypto.randomUUID()) : undefined);
      } catch { return; }
      ctx.go('templates_home', { laneId });
    } catch (e) {
      ctx.toast(failure('use template', e));
    } finally {
      setBusy(false);
    }
  }

  const card = (t: ContentTemplate, by?: string) => {
    const on = picked === t.id;
    const inUse = current?.templateId === t.id;
    const levels = templateLevels(t);
    return (
      <Card key={t.id} onPress={() => setPicked(on ? null : t.id)} accessibilityLabel={`${t.name}${inUse ? ', in use' : ''}`}
        style={on ? { borderWidth: 2, borderColor: C.primary } : null}>
        <View style={styles.head}>
          <View style={[styles.tile, on ? { backgroundColor: C.primary } : null]}>
            <Ico name="book" size={22} color={on ? C.white : C.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3}>{t.name}{inUse ? ' · in use' : ''}</Text>
            {by ? <Text style={[txt.sm, { fontWeight: '700', color: C.primary }]}>Suggested by {by}</Text> : null}
            <Text style={[txt.smMuted, { marginTop: 2 }]}>{t.description}</Text>
          </View>
          {on ? <Ico name="check" size={22} color={C.primary} /> : null}
        </View>
        {on ? (
          <>
            <LevelsLine levels={levels} />
            <Text style={txt.smMuted}>{plural(templateLeafCount(t), lower(levels.at(-1) ?? 'part'), lower(pluralOf(levels.at(-1) ?? 'part')))}</Text>
          </>
        ) : null}
      </Card>
    );
  };

  const changing = !!pick && pick.id !== current?.templateId;
  const currentParts = lower(pluralOf(currentT ? templateLevels(currentT).at(-1) ?? 'part' : 'part'));
  return (
    <Screen
      header={<Header title="Choose a Template" sub={currentT ? `For ${lane} · now ${currentT.name}` : `For ${lane}`} onBack={ctx.back} />}
      footer={changing && pick ? (
        <>
          <Text style={txt.smMuted}>
            {current
              ? `${lane}'s current ${currentParts} are hidden, not deleted.${recorded ? ` ${plural(recorded, 'part has', 'parts have')} recordings — change back to this template to bring them back.` : ''}`
              : `${lane} will record against ${pick.name}. You can change it later; nothing recorded is ever deleted.`}
          </Text>
          <PrimaryBtn label={`Use ${pick.name}`} icon="check" busy={busy} disabled={!canUse} onPress={() => void use(pick)} />
        </>
      ) : undefined}>
      {suggested.length > 0 ? (
        <>
          <SectionLabel label="Suggested" />
          {suggested.map((s) => card(s.t, s.by))}
        </>
      ) : null}
      <SectionLabel label={suggested.length ? 'Other templates' : 'Templates'} />
      {others.map((t) => card(t))}
    </Screen>
  );
}

// ---- Template Outline ---------------------------------------------------------------------------

const levelSub = (i: number, count: number) =>
  i === count - 1 ? 'Recorded · shown by reference' : i === count - 2 ? "Holds what's recorded · can be downloaded" : 'Holds folders';

const startsAs = (t: ContentTemplate) =>
  t.id === 'fia' ? "FIA's passages" : t.id === 'book' ? 'Whole books' : 'Whole chapters';

export function TemplateEditor(ctx: Ctx) {
  const state = ctx.project.state;
  const templateId = ctx.params['templateId'];
  const laneId = ctx.params['laneId'] ?? ctx.laneId;
  const [limit, setLimit] = useState(10);
  if (!state) return <Loading title="Template Outline" onBack={ctx.back} />;
  const target: 'library' | 'language' = templateId ? 'library' : 'language';
  const t = templateId ? contentTemplate(templateId) : laneId ? laneTemplate(state, laneId) : undefined;
  if (!t) {
    return (
      <Screen header={<Header title="Template Outline" onBack={ctx.back} />}>
        <EmptyState icon="template" title={target === 'language' ? 'No template yet' : 'Template not found'}
          sub={target === 'language' ? 'Choose a template for this language first.' : 'It is not in this version of the library.'} />
      </Screen>
    );
  }
  const lane = laneId ? laneName(state, laneId) : '';
  const levels = templateLevels(t);
  const usedBy = templateUsage(state).filter((u) => u.templateId === t.id).map((u) => laneName(state, u.laneId));
  const outline = templateOutline(t);
  const flat = outline.every((o) => o.items.length === 0);

  return (
    <Screen header={<Header title={t.name} sub={target === 'language' ? `${lane}'s template` : 'Template · in the library'} onBack={ctx.back} />}>
      {target === 'library' ? (
        <>
          <Card><Text style={txt.body}>{t.description}</Text></Card>
          {usedBy.length > 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
              Used by {usedBy.join(', ')}. Each has its own copy, so changes here reach languages that start from it later, not the ones already using it.
            </Text>
          ) : null}
          <Banner icon="lock" title="Library templates ship with the app"
            body="You can read this one here. Making your own template, and renaming its levels, is coming." />
        </>
      ) : (
        <>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            What {lane}'s team calls each level. {pluralOf(levels.at(-1) ?? 'Passage')} themselves are divided in each book.
          </Text>
          <Banner icon="lock" title="Renaming levels is coming" body={`For now ${lane} uses the names ${t.name} comes with.`} />
        </>
      )}

      <SectionLabel label="Levels" />
      <Group>
        {levels.map((l, i) => (
          <Row key={`${l}-${i}`} icon={i === levels.length - 1 ? 'media' : 'folder'} label={l} sub={levelSub(i, levels.length)} last={i === levels.length - 1} />
        ))}
      </Group>

      {target === 'library' ? (
        <>
          <SectionLabel label="Chapters start as" />
          <Group><Row icon="cut" label={startsAs(t)} last /></Group>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Either way, each language divides its own books later, as the team studies them.</Text>

          <SectionLabel label={`Outline · ${plural(outline.length, flat ? lower(levels[0] ?? 'item') : 'folder')}`} />
          {flat ? (
            <Group>
              {outline.slice(0, limit).map((o, i, shown) => (
                <Row key={o.folder.itemId} icon="media" label={o.folder.label} sub={levels.at(-1)} last={i === shown.length - 1} />
              ))}
            </Group>
          ) : (
            outline.slice(0, limit).map((o) => (
              <OutlineFolder key={o.folder.itemId} ctx={ctx} templateId={t.id} folder={o.folder.label} folderId={o.folder.itemId}
                items={o.items.map((it) => it.label)} itemLevel={levels.at(-1) ?? 'Item'} />
            ))
          )}
          <ShowMore remaining={outline.length - limit} step={10} onMore={() => setLimit((l) => l + 10)} />
        </>
      ) : null}
    </Screen>
  );
}

/** A folder of the outline and what it holds, opened on request (ADR-013); long folders grow (ADR-009). */
function OutlineFolder(props: { ctx: Ctx; templateId: string; folderId: string; folder: string; items: string[]; itemLevel: string }) {
  const d = props.ctx.details(`template:${props.templateId}:${props.folderId}`);
  const [limit, setLimit] = useState(20);
  return (
    <Disclosure icon="folder" title={props.folder} summary={`${plural(props.items.length, lower(props.itemLevel), lower(pluralOf(props.itemLevel)))} · offline as one download`}
      open={d.open} onToggle={d.onToggle}>
      {props.items.slice(0, limit).map((label, i, shown) => (
        <Row key={`${label}-${i}`} icon="media" iconColor={TINT.greenText} iconBg={TINT.green} label={label} sub={props.itemLevel}
          last={i === shown.length - 1 && props.items.length <= limit} />
      ))}
      {props.items.length > limit ? (
        <View style={{ padding: space.md }}>
          <ShowMore remaining={props.items.length - limit} step={20} onMore={() => setLimit((l) => l + 20)} />
        </View>
      ) : null}
    </Disclosure>
  );
}

// ---- Divide a Book ------------------------------------------------------------------------------

export function BookStructure(ctx: Ctx) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? ctx.laneId;
  const bookId = ctx.params['bookId'];
  const book = bookId ? bibleBook(bookId) : undefined;
  const list = useRef<FlatList<number>>(null);
  const [picking, setPicking] = useState(false);
  const canShape = ctx.session.can('shape_templates') || ctx.session.can('manage_templates');

  const data = useMemo(() => {
    if (!state || !laneId || !state.lanes[laneId] || !book) return null;
    const idx = indexesFor(state);
    const segments = bookSegments(state, idx, laneId, book);
    const recorded = new Set(segments.filter((s) => derivePassage(state, s.unitId, laneId, idx).recorded).map((s) => s.unitId));
    // The words, where the app has them (scripture.ts); verse numbers otherwise.
    const text = new Map<string, string>();
    const translation = new Map<number, string>();
    for (const s of segments) {
      const reading = readingsFor(state, s.unitId)[0];
      if (!reading) continue;
      for (const v of reading.verses) {
        text.set(`${v.chapter}:${v.verse}`, v.text);
        translation.set(v.chapter, reading.code);
      }
    }
    // FIA's breaks are suggestions only where the language divides differently (TPL-5).
    const fia = laneTemplate(state, laneId)?.id === 'fia' ? new Set<number>() : fiaStarts(book);
    const textOf = (c: number, v: number) => text.get(`${c}:${v}`);
    return { lane: laneName(state, laneId), part: partName(state, laneId), segments, recorded, textOf, translation, fia };
  }, [state, laneId, book]);

  if (!state) return <Loading title="Divide a Book" onBack={ctx.back} />;
  if (!book || !data) {
    return (
      <Screen header={<Header title="Divide a Book" onBack={ctx.back} />}>
        <EmptyState icon="book" title="Choose a book" sub="Open a book from the language's Content Template, or from its Map." />
      </Screen>
    );
  }
  const part = data.part;
  const parts = lower(pluralOf(part));
  const chapters = book.verses.map((_, i) => i + 1);
  const fia = canShape ? data.fia : new Set<number>();
  const jump = (c: number) => list.current?.scrollToIndex({ index: c - 1, animated: true });

  return (
    <Screen fixed header={<Header title={book.label} sub={`${data.lane} · ${plural(data.segments.length, lower(part), parts)}`} onBack={ctx.back} />}>
      <View style={styles.jumpBar}>
        <ChipRow>
          <Chip label="Chapter" icon="down" on onPress={() => setPicking(true)} />
          {data.segments.map((s) => (
            <Chip key={s.unitId} label={chipLabel(book, s)} on={false} onPress={() => jump(s.from.c)} />
          ))}
        </ChipRow>
      </View>
      <FlatList
        ref={list}
        data={chapters}
        keyExtractor={(c) => String(c)}
        initialNumToRender={2}
        windowSize={5}
        contentContainerStyle={{ paddingBottom: space.xxl }}
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index: info.index, animated: false }), 120);
        }}
        ListHeaderComponent={
          <View style={{ padding: space.lg, gap: space.md }}>
            <Banner icon="cut" title={`Changing where ${parts} start is coming`}
              body={`For now you can read how ${data.lane}'s ${parts} divide ${book.label}${fia.size ? ", with FIA's breaks marked as suggestions" : ''}.`} />
            {data.segments.length === 0 ? (
              <Text style={txt.smMuted}>{data.lane} has no {parts} in {book.label} yet.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item: c }) => (
          <ChapterView book={book} c={c} segments={data.segments} fia={fia} text={data.textOf} part={part}
            translation={data.translation.get(c)} recorded={data.recorded} />
        )}
      />
      <Sheet visible={picking} title={book.label} sub="Jump to a chapter." onClose={() => setPicking(false)}>
        <View style={styles.grid}>
          {chapters.map((c) => {
            const n = data.segments.filter((s) => s.from.c === c).length;
            return (
              <Pressable key={c} onPress={() => { setPicking(false); jump(c); }} accessibilityRole="button"
                accessibilityLabel={`Chapter ${c}${n > 1 ? `, ${n} ${parts}` : ''}`}
                style={({ pressed }) => [styles.chapterTile, pressed && { opacity: 0.7 }]}>
                <Text style={[txt.h3, { fontVariant: ['tabular-nums'] }]}>{c}</Text>
                {n > 1 ? <Text style={txt.xsStrong}>{n}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}

/** One chapter read like a Bible: cards where parts start, FIA's suggestions, gaps, and the verses (ADR-027). */
function ChapterView(props: {
  book: BibleBook; c: number; segments: Segment[]; fia: Set<number>; text: (c: number, v: number) => string | undefined;
  part: string; translation?: string; recorded: Set<string>;
}) {
  const { book, c, part } = props;
  const blocks = useMemo(() => chapterBlocks(book, c, props.segments, props.fia, props.text), [book, c, props.segments, props.fia, props.text]);
  const continues = continuesInto(props.segments, c);
  return (
    <View style={{ paddingHorizontal: space.lg }}>
      <Text style={[txt.label, styles.chapterHead]}>
        Chapter {c}
        {props.translation ? <Text style={txt.xs}> · {props.translation}</Text> : null}
        {continues ? <Text style={txt.xs}> · {lower(part)} {versesText(continues)} continues</Text> : null}
      </Text>
      {blocks.map((b, i) => <BlockView key={i} block={b} c={c} part={part} recorded={props.recorded} />)}
    </View>
  );
}

function BlockView(props: { block: Block; c: number; part: string; recorded: Set<string> }) {
  const b = props.block;
  const part = lower(props.part);
  if (b.kind === 'card') {
    const recorded = props.recorded.has(b.seg.unitId);
    return (
      <View style={styles.passageCard} accessibilityLabel={`${props.part} ${b.n}, ${versesText(b.seg)}${recorded ? ', recorded' : ''}`}>
        <View style={styles.tile}><Ico name="media" size={22} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700' }]}>{props.part} {versesText(b.seg)}</Text>
          <View style={styles.cardSub}>
            {recorded ? <Ico name="check" size={14} color={TINT.greenText} /> : null}
            <Text style={[txt.sm, { color: recorded ? TINT.greenText : C.muted }]}>{recorded ? 'Recorded' : 'Not recorded yet'}</Text>
          </View>
        </View>
      </View>
    );
  }
  if (b.kind === 'fia') {
    return (
      <View style={styles.fia}>
        <Ico name="cut" size={16} color={C.muted} />
        <Text style={[txt.sm, { color: C.muted, flex: 1 }]}>FIA starts a passage at {b.at.c}:{b.at.v}</Text>
      </View>
    );
  }
  if (b.kind === 'gap') {
    return (
      <Text style={[txt.sm, styles.gap]}>From verse {b.from}, these verses aren't in any {part} yet.</Text>
    );
  }
  return (
    <Text style={[styles.para, { borderLeftColor: b.seg ? (b.n % 2 ? C.primary : C.soft) : C.border }]}>
      {b.verses.map((v) => (
        <Text key={v.v} accessibilityLabel={`Verse ${props.c}:${v.v}`}>
          <Text style={styles.verseNo}>{v.v} </Text>
          {v.text ?? <Text style={{ color: C.muted }}>verse {v.v}</Text>}{' '}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  levels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  level: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: tile.sm, height: tile.sm, borderRadius: 14, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min },
  pair: { flexDirection: 'row', gap: space.sm },
  jumpBar: { backgroundColor: C.card, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  chapterHead: { paddingTop: space.xl, paddingBottom: space.xs, paddingHorizontal: space.xs },
  passageCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, marginTop: space.sm, marginBottom: space.xs,
    paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card
  },
  cardSub: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  fia: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, marginVertical: space.xs,
    paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border
  },
  gap: { marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: TINT.gray, color: TINT.grayText },
  para: { fontSize: T.base, lineHeight: 30, color: C.dark, paddingLeft: space.md, paddingVertical: space.xs, borderLeftWidth: 3 },
  verseNo: { fontSize: T.xs, fontWeight: '700', color: C.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chapterTile: {
    width: target.primary, height: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center'
  }
});

export const contracts = contractsFor('templates_home', 'template_picker', 'template_editor', 'book_structure');
