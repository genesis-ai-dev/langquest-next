// Content templates: the structure each language records against. Ports the
// UX demo's src/screens/content.tsx: ContentTemplatesScreen (templates_home,
// the organization's templates and a language's own), TemplatePickerScreen
// (template_picker), TemplateEditorScreen with OutlineScroll, LevelSheet and
// NodeSheet (template_editor) and BookStructureScreen (book_structure).
// Requirements TPL-1, TPL-2, TPL-7, TPL-9; ADR-025 (a language uses its own
// version, suggestions are advice), ADR-026 (a whole book in one scroll) and
// ADR-027 (the book reads like a Bible, FIA's breaks are suggestions).
//
// Templates are library items (docs/library.md, docs/decisions.md 36): the
// organization's own, copies, and ones it follows from another organization,
// plus what other organizations share. A language uses one version of one;
// when the item moves to a new version the language follows it
// (library/follow.ts). Dividing books into passages (TPL-4..7), drafts and
// template tasks need events that do not exist yet: book_structure reads.
// Languages set up from the catalog that used to ship in the app keep its
// name and levels, read-only.
//
// There is no project level (docs/decisions.md 34). templates_home params:
// `level` ('org' | 'language'; an old 'project' reads as 'org') and/or
// `laneId`. template_picker: `laneId`. template_editor: `itemId` (a library
// template), `new` (start one), or `laneId` (a language on a catalog
// template, read-only). book_structure: `laneId`, `bookId`.
import {
  chaptersInBook, derivePassage, languageProgress, laneName,
  type LibraryItemView, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  bibleBook, bookRows, bookSegments, chapterBlocks, chipLabel, choiceLine, continuesInto, countOutline, addNode, docFromForm,
  docLevels, englishBookName, fiaStarts, formChanged, formFromDoc, laneTemplateLine, laneTemplateOf, levelsForDivide,
  levelsForOutline, libraryChoices, moveNode, newTemplateForm, partName, pluralOf, recordedCount, removeNode, renameNode,
  setAsideCount, siblingsOf, findNode, STARTER_TEMPLATE, versesText, versificationBooks, versionNumber,
  type BibleBook, type Block, type LibraryChoice, type Segment, type TemplateForm
} from '../contentTemplates';
import type { Ctx } from '../ctx';
import { indexesFor } from '../indexes';
import {
  Banner, Card, Chip, ChipRow, Disclosure, EmptyState, Field, GhostBtn, Group, Header, Ico, PrimaryBtn, Row, Screen, SearchField,
  SectionLabel, SmallBtn, Sheet, ShowMore, Toggle, txt
} from '../kit';
import { loadDocs } from '../library/docStore';
import { lanesUsing, sourceLine, type SharedItem } from '../library/model';
import { useLibrary, useLibraryDocs, useLibraryUpdates, useSharedItems } from '../library/useLibrary';
import { plural } from '../passageView';
import { failureMessage } from '../report';
import { readingsFor } from '../scripture';
import { contractsFor } from '../screenContracts';
import { C, radius, space, target, tile, TINT, type as T } from '../theme';

/**
 * What to say when something fails (error-tracking): a command's own reason,
 * or, for a fault, a code a tester can read out, having reported it.
 */
const failure = failureMessage;

const lower = (s: string) => s.toLowerCase();

/** "Dinka", "Dinka and Nuer", "Dinka, Nuer and Shilluk". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** "Dinka moves to it by itself." / "Dinka and Nuer move to it by themselves." */
function movesLine(names: string[]): string {
  if (names.length === 0) return '';
  return names.length === 1 ? `${names[0]} moves to it by itself.` : `${joinNames(names)} move to it by themselves.`;
}

type Level = 'org' | 'language';
type Lib = ReturnType<typeof useLibrary>;

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

/** A document still on its way: a light line, never a spinner over the screen. */
function LoadingLine() {
  return <Text style={txt.smMuted}>Loading…</Text>;
}

function Loading(props: { title: string; onBack: () => void }) {
  return (
    <Screen header={<Header title={props.title} onBack={props.onBack} />}>
      <EmptyState icon="template" title="Getting your organization ready…" />
    </Screen>
  );
}

/** Offline, the list of shared templates is the one this phone saved. */
function SharedOffline(props: { error: string; empty: boolean }) {
  if (!props.error) return null;
  return (
    <Banner icon="cloud" tone="amber" title="Could not refresh this list"
      body={props.empty ? 'Connect to see what other organizations share.' : 'Showing the list this phone saved.'} />
  );
}

/** Run one library action: busy while it runs, and "Not saved" with the reason when it fails. */
function useRunner(ctx: Ctx) {
  const [busy, setBusy] = useState(false);
  async function run(what: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.toast(`Not saved. ${failure(what, e)}`);
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

// ---- Content Templates -------------------------------------------------------------------

export function TemplatesHome(ctx: Ctx) {
  const { level, laneId } = levelOf(ctx);
  if (level === 'language') return <LanguageTemplateView ctx={ctx} laneId={laneId} />;
  return <TemplateLibraryView ctx={ctx} />;
}

/** The organization: its templates, what others share, and what each language uses (TPL-1). */
function TemplateLibraryView({ ctx }: { ctx: Ctx }) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const canManage = ctx.session.can('manage_templates');
  const all = lib.items('template');
  const active = all.filter((i) => !i.archived);
  const archived = all.filter((i) => i.archived);
  const shared = useSharedItems('template', lib.orgId);
  const others = useMemo(() => libraryChoices(library ?? {}, [], shared.rows, STARTER_TEMPLATE.name), [library, shared.rows]);
  const { updates } = useLibraryUpdates(lib.orgId);
  const [limit, setLimit] = useState(8);
  const [sharedLimit, setSharedLimit] = useState(5);
  const [laneLimit, setLaneLimit] = useState(8);
  const [options, setOptions] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<SharedItem | null>(null);
  const docs = useLibraryDocs(lib.orgId, [...all.map((i) => i.current), ...others.slice(0, sharedLimit).map((c) => c.hash)]);
  const archivedOpen = ctx.details('templates:archived');
  const lanes = state ? Object.keys(state.lanes).sort((a, b) => laneName(state, a).localeCompare(laneName(state, b))) : [];
  const scopeName = orgName(ctx);
  const optionsItem = options ? lib.item(options) : null;

  const itemCard = (it: LibraryItemView) => {
    const doc = docs.get<TemplateDoc>(it.current);
    const users = lanesUsing(state, it.itemId).map((l) => (state ? laneName(state, l) : l));
    const update = it.source === 'subscription' && it.subscription?.active && !it.subscription.autoUpdate ? updates[it.itemId] : undefined;
    return (
      <Card key={it.itemId}>
        <View style={styles.head}>
          <View style={styles.tile}><Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={C.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3}>{it.name}</Text>
            <Text style={[txt.sm, { fontWeight: '600', color: C.primary }]}>{sourceLine(it)}</Text>
            {it.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{it.description}</Text> : null}
          </View>
        </View>
        {doc ? <LevelsLine levels={docLevels(doc)} /> : <LoadingLine />}
        <Text style={[txt.sm, { fontWeight: '600', color: users.length ? C.primary : C.muted }]}>
          {users.length ? `Used by ${joinNames(users)}` : 'Not used here yet'}
        </Text>
        {update ? <Text style={[txt.sm, { color: TINT.amberText }]}>{it.subscription!.sourceOrgName} has a newer version.</Text> : null}
        <View style={styles.cardActions}>
          {canManage ? <SmallBtn label="Options" icon="settings" onPress={() => setOptions(it.itemId)} /> : null}
          <View style={{ flex: 1 }} />
          <SmallBtn label={canManage && it.source !== 'subscription' ? 'Edit' : 'View'} icon="right" onPress={() => ctx.go('template_editor', { itemId: it.itemId })} />
        </View>
      </Card>
    );
  };

  return (
    <Screen header={<Header title="Content Templates" sub={scopeName} onBack={ctx.back}
      action={canManage ? <SmallBtn label="Template" icon="plus" tone="primary" onPress={() => ctx.go('template_editor', { new: '1' })} /> : undefined} />}>
      <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
        A template is the structure a language records against — books and passages, or lessons, or stories. Each language uses one version of one, and moves to the next when the template changes.
      </Text>

      <SectionLabel label="Your organization" />
      {active.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          No templates yet. {canManage ? 'Follow or copy one another organization shares, or make your own.' : 'Whoever manages content templates adds them.'}
        </Text>
      ) : active.slice(0, limit).map(itemCard)}
      <ShowMore remaining={active.length - limit} step={8} onMore={() => setLimit((l) => l + 8)} />
      {archived.length > 0 ? (
        <Disclosure icon="history" title="Archived" summary={`${plural(archived.length, 'template')} · languages using them keep them`}
          open={archivedOpen.open} onToggle={archivedOpen.onToggle}>
          {archived.map((it, i) => (
            <Row key={it.itemId} icon="template" iconColor={C.muted} iconBg={C.bg} label={it.name} sub={sourceLine(it)} muted
              onPress={canManage ? () => setOptions(it.itemId) : () => ctx.go('template_editor', { itemId: it.itemId })} last={i === archived.length - 1} />
          ))}
        </Disclosure>
      ) : null}

      <SectionLabel label="From other organizations" />
      <SharedOffline error={shared.error} empty={shared.rows.length === 0} />
      {shared.loaded && others.length === 0 && !shared.error ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Nothing else is shared yet.</Text>
      ) : null}
      {others.slice(0, sharedLimit).map((c) => {
        if (c.source !== 'shared') return null;
        const doc = docs.get<TemplateDoc>(c.hash);
        return (
          <Card key={c.key} onPress={() => setBrowsing(c.shared)} accessibilityLabel={`${c.name}, from ${c.shared.org_name}`}>
            <View style={styles.head}>
              <View style={styles.tile}><Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={C.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={txt.h3}>{c.name}</Text>
                <Text style={[txt.sm, { color: C.muted }]}>{choiceLine(c, sourceLine)}</Text>
                {c.shared.description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{c.shared.description}</Text> : null}
              </View>
              <Ico name="right" size={22} color={C.muted} />
            </View>
            {doc ? <LevelsLine levels={docLevels(doc)} /> : null}
          </Card>
        );
      })}
      <ShowMore remaining={others.length - sharedLimit} step={5} onMore={() => setSharedLimit((l) => l + 5)} />

      <SectionLabel label="By language" />
      {lanes.length === 0 || !state ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No languages here yet.</Text>
      ) : (
        <>
          <Group>
            {lanes.slice(0, laneLimit).map((laneId, i, shown) => (
              <Row key={laneId} icon="globe" iconColor={C.muted} iconBg={C.bg} label={laneName(state, laneId)}
                sub={laneTemplateLine(state, lib.item, laneId)} last={i === shown.length - 1} />
            ))}
          </Group>
          <ShowMore remaining={lanes.length - laneLimit} step={8} onMore={() => setLaneLimit((l) => l + 8)} />
        </>
      )}

      {optionsItem ? (
        <ItemOptions ctx={ctx} lib={lib} item={optionsItem} update={updates[optionsItem.itemId]} onClose={() => setOptions(null)} />
      ) : null}
      {browsing ? <SharedTemplateSheet ctx={ctx} lib={lib} shared={browsing} canManage={canManage} onClose={() => setBrowsing(null)} /> : null}
    </Screen>
  );
}

/**
 * What an admin can do with one of the organization's templates: share it
 * (and let others follow it), archive it, or, for one it follows, how it
 * takes updates, take one, stop following, or copy it to change it.
 */
function ItemOptions(props: { ctx: Ctx; lib: Lib; item: LibraryItemView; update?: string; onClose: () => void }) {
  const { ctx, lib, item: it, onClose } = props;
  const { busy, run } = useRunner(ctx);
  const sub = it.subscription;

  const setSharing = (shared: boolean, subscribable: boolean, message: string) => run('template sharing', async () => {
    const before = { shared: it.shared, subscribable: it.subscribable };
    await lib.setSharing(it, shared, subscribable);
    ctx.toast(message, () => run('undo template sharing', async () => {
      await lib.setSharing(it, before.shared, before.subscribable);
      ctx.toast('Undone.');
    }));
  });

  if (sub) {
    return (
      <Sheet visible title={it.name} sub={sourceLine(it)} onClose={onClose}>
        {sub.active ? (
          <Group>
            <Row label="Update automatically" sub={`New versions from ${sub.sourceOrgName} reach your languages by themselves.`} last
              right={<Toggle on={sub.autoUpdate} disabled={busy} label="Update automatically"
                onToggle={() => void run('template updates', async () => {
                  const auto = !sub.autoUpdate;
                  await lib.follow(it.itemId, { autoUpdate: auto });
                  ctx.toast(auto ? `${it.name} updates automatically.` : `You take ${it.name}'s updates.`, () => run('undo template updates', async () => {
                    await lib.follow(it.itemId, { autoUpdate: !auto });
                    ctx.toast('Undone.');
                  }));
                })} />} />
          </Group>
        ) : null}
        {props.update ? (
          <GhostBtn label="Take update" icon="download" disabled={busy} onPress={() => void run('take template update', async () => {
            await lib.takeUpdate(it, props.update!);
            onClose();
            ctx.toast(`${it.name} updated. Languages using it move to the new version by themselves.`);
          })} />
        ) : null}
        {sub.active ? (
          <GhostBtn label="Stop following" icon="close" disabled={busy} onPress={() => void run('stop following template', async () => {
            await lib.follow(it.itemId, { active: false });
            onClose();
            ctx.toast(`Stopped following ${it.name}. Languages keep the version they use.`, () => run('undo stop following', async () => {
              await lib.follow(it.itemId, { active: true });
              ctx.toast('Undone.');
            }));
          })} />
        ) : null}
        <GhostBtn label="Copy to change it" icon="edit" disabled={busy} onPress={() => void run('copy template', async () => {
          await lib.copyFollowed(it);
          onClose();
          ctx.toast(`${it.name} copied. The copy is yours to change.`);
        })} />
      </Sheet>
    );
  }

  return (
    <Sheet visible title={it.name} sub={sourceLine(it)} onClose={onClose}>
      <Group>
        <Row label="Share with other organizations" sub="They can see it and copy it." last={!it.shared}
          right={<Toggle on={it.shared} disabled={busy} label="Share with other organizations"
            onToggle={() => void setSharing(!it.shared, it.subscribable, it.shared ? `${it.name} is no longer shared. Anyone using it keeps their version.` : `${it.name} is shared with other organizations.`)} />} />
        {it.shared ? (
          <Row label="Let them follow updates" sub="They can follow it and get each new version." last
            right={<Toggle on={it.subscribable} disabled={busy} label="Let them follow updates"
              onToggle={() => void setSharing(true, !it.subscribable, it.subscribable ? 'Others can no longer follow it.' : 'Others can follow it and get your new versions.')} />} />
        ) : null}
      </Group>
      <GhostBtn label={it.archived ? 'Unarchive' : 'Archive'} icon="history" disabled={busy} onPress={() => void run('archive template', async () => {
        const archived = !it.archived;
        await lib.archive(it, archived);
        onClose();
        ctx.toast(archived ? `${it.name} archived. Languages using it keep it.` : `${it.name} is back in the list.`, () => run('undo archive', async () => {
          await lib.archive(it, !archived);
          ctx.toast('Undone.');
        }));
      })} />
    </Sheet>
  );
}

/** Another organization's template: follow it (automatic updates or not), or copy it to make it ours. */
function SharedTemplateSheet(props: { ctx: Ctx; lib: Lib; shared: SharedItem; canManage: boolean; onClose: () => void }) {
  const { ctx, lib, shared: s, onClose } = props;
  const { busy, run } = useRunner(ctx);
  const [following, setFollowing] = useState(false);
  const follow = (auto: boolean) => run('follow template', async () => {
    const itemId = await lib.subscribe(s, auto);
    onClose();
    ctx.toast(`Following ${s.name} from ${s.org_name}.`, () => run('undo follow', async () => {
      await lib.follow(itemId, { active: false });
      ctx.toast('Undone.');
    }));
  });
  return (
    <Sheet visible title={s.name} sub={`From ${s.org_name} · ${plural(s.version_count, 'version')}`} onClose={onClose}>
      {s.description ? <Text style={txt.body}>{s.description}</Text> : null}
      {!props.canManage ? (
        <Text style={txt.smMuted}>Whoever manages content templates can follow it or copy it.</Text>
      ) : following ? (
        <Group>
          <Row icon="download" label="Update automatically" sub="New versions reach your languages by themselves." onPress={busy ? undefined : () => void follow(true)} />
          <Row icon="notif" label="I'll take updates" sub="You'll see when there is a new version and choose when to take it." onPress={busy ? undefined : () => void follow(false)} last />
        </Group>
      ) : (
        <Group>
          {s.subscribable ? (
            <Row icon="history" label="Follow" sub={`Use ${s.org_name}'s versions as they publish them.`} onPress={() => setFollowing(true)} />
          ) : null}
          <Row icon="edit" label="Copy" sub="Make it ours to change." last onPress={busy ? undefined : () => void run('copy template', async () => {
            await lib.copy(s);
            onClose();
            ctx.toast(`${s.name} copied. The copy is yours to change.`);
          })} />
        </Group>
      )}
    </Sheet>
  );
}

/** A language: its template and version, its levels and counts, Change, and the books (TPL-1, TPL-7). */
function LanguageTemplateView({ ctx, laneId }: { ctx: Ctx; laneId: string | null }) {
  const state = ctx.project.state;
  const lib = useLibrary(ctx);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const { busy, run } = useRunner(ctx);
  const sel = state && laneId && state.lanes[laneId] ? laneTemplateOf(state, laneId) : null;
  const libSel = sel?.source === 'library' ? sel : null;
  const docs = useLibraryDocs(lib.orgId, [libSel?.docHash]);
  const { updates } = useLibraryUpdates(lib.orgId);
  const data = useMemo(() => {
    if (!state || !laneId || !state.lanes[laneId]) return null;
    const idx = indexesFor(state);
    return {
      lane: laneName(state, laneId),
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
  const item = libSel ? lib.item(libSel.itemId) : null;
  const doc = docs.get<TemplateDoc>(libSel?.docHash);
  const v11n = doc?.bible ? docs.get<VersificationDoc>(doc.bible.versification) : null;
  const levels = sel?.source === 'legacy' ? sel.levels : doc ? docLevels(doc) : [];
  const last = partName(state, laneId, doc);
  const parts = lower(pluralOf(last));
  const q = query.trim().toLowerCase();
  const books = data.books.filter((b) => !q || b.label.toLowerCase().includes(q) || b.book.label.toLowerCase().includes(q));
  const n = versionNumber(item, libSel?.docHash);
  const from = item?.subscription ? ` · from ${item.subscription.sourceOrgName}` : item?.copiedFrom ? ` · copied from ${item.copiedFrom.orgName}` : '';
  const newer = item?.current && libSel && item.current !== libSel.docHash ? versionNumber(item, item.current) : null;
  const update = item?.subscription?.active && !item.subscription.autoUpdate ? updates[item.itemId] : undefined;

  return (
    <Screen header={<Header title="Content Template" sub={data.lane} onBack={ctx.back} />}>
      {sel ? (
        <Card>
          <View>
            <Text style={txt.label}>{data.lane} records against</Text>
            <Text style={[txt.h2, { marginTop: space.xs }]}>{sel.source === 'legacy' ? sel.name : item?.name ?? doc?.name ?? 'Its template'}</Text>
            <Text style={[txt.smMuted, { marginTop: 2 }]}>
              {sel.source === 'legacy' ? 'Built into the app' : n ? `Version ${n}${from}` : from.replace(/^ · /, '')}
            </Text>
          </View>
          {sel.source === 'library' && !doc ? <LoadingLine /> : <LevelsLine levels={levels} />}
          {doc?.bible ? (
            <Text style={txt.sm}>
              {`${libSel?.books ? `${libSel.books.length} of its ${plural(doc.bible.books.length, 'book')}` : plural(doc.bible.books.length, 'book')} · ${v11n ? `${v11n.name} versification` : 'versification loading…'}`}
            </Text>
          ) : null}
          <Text style={txt.sm}>
            {`${data.books.length && !doc?.bible ? `${plural(data.books.length, 'book')} · ` : ''}${plural(data.progress.total, lower(last), parts)} · ${data.progress.recorded.toLocaleString('en-US')} recorded`}
          </Text>
          {newer ? (
            <Text style={[txt.sm, { color: C.primary, fontWeight: '600' }]}>Version {newer} is out. {data.lane} moves to it by itself.</Text>
          ) : update ? (
            <>
              <Text style={[txt.sm, { color: TINT.amberText }]}>{item!.subscription!.sourceOrgName} has a newer version.</Text>
              {canManage ? (
                <SmallBtn label="Take update" icon="download" disabled={busy} onPress={() => void run('take template update', async () => {
                  await lib.takeUpdate(item!, update);
                  ctx.toast(`${data.lane} moves to the new version of ${item!.name}.`);
                })} />
              ) : null}
            </>
          ) : null}
          {sel.source === 'legacy' ? (
            <Text style={txt.smMuted}>Choose a template from the library to change its structure.</Text>
          ) : null}
          {canManage ? (
            <View style={{ gap: space.sm }}>
              <GhostBtn label={item && item.source !== 'subscription' ? 'Edit template' : 'View template'} icon="edit"
                onPress={() => ctx.go('template_editor', sel.source === 'library' ? { itemId: sel.itemId } : { laneId })} />
              <GhostBtn label="Change template" icon="swap" onPress={() => ctx.go('template_picker', { laneId })} />
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
          body={`${data.setAside === 1 ? 'It is' : 'They are'} not in the template ${data.lane} uses now. Set aside, not deleted: change back to bring ${data.setAside === 1 ? 'it' : 'them'} back.`} />
      ) : null}

      {sel && canShape && data.books.length > 0 ? (
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
                <Row key={b.book.itemId} icon="book" label={b.label} sub={plural(b.parts, lower(last), parts)}
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
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), shared.rows, STARTER_TEMPLATE.name), [library, lib.items, shared.rows]);
  const ours = choices.filter((c) => c.source === 'ours');
  const others = choices.filter((c) => c.source === 'shared');
  const [picked, setPicked] = useState<string | null>(null);
  const [sharedLimit, setSharedLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const sel = state && laneId && state.lanes[laneId] ? laneTemplateOf(state, laneId) : null;
  const pick = choices.find((c) => c.key === picked);
  const docs = useLibraryDocs(lib.orgId, [pick?.hash, sel?.source === 'library' ? sel.docHash : null]);
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
  const canUse = ctx.session.can('manage_templates');
  const currentName = sel ? (sel.source === 'legacy' ? sel.name : lib.item(sel.itemId)?.name ?? 'its template') : null;
  const inUse = (c: LibraryChoice) => sel?.source === 'library' && c.source === 'ours' && c.item.itemId === sel.itemId;
  const currentDoc = sel?.source === 'library' ? docs.get<TemplateDoc>(sel.docHash) : null;
  const currentParts = lower(pluralOf(partName(state, laneId, currentDoc)));

  async function use(c: LibraryChoice) {
    if (!state || !laneId || busy || !canUse) return;
    setBusy(true);
    try {
      const prev = state.laneTemplates[laneId]?.value;
      const books = prev?.books;
      // Undo re-applies the version used before, worked out now (none for a template from the app,
      // or when that version's document is not on the phone).
      const undo = prev?.itemId && prev.docHash
        ? await lib.applySpecs(laneId, prev.itemId, { docHash: prev.docHash, ...(books ? { books } : {}) }).catch(() => null)
        : null;
      // Another organization's template is followed, with automatic updates, before it is used.
      const itemId = c.source === 'shared' ? await lib.subscribe(c.shared, true) : c.item.itemId;
      const specs = await lib.applySpecs(laneId, itemId, { docHash: c.hash, ...(books ? { books } : {}) });
      // ctx.act says "Not saved" and why itself; stay here to try again.
      try {
        await ctx.act(specs, `${lane} now uses ${c.name}.`, undo ? () => undo : undefined);
      } catch { return; }
      ctx.go('templates_home', { laneId });
    } catch (e) {
      ctx.toast(failure('use template', e));
    } finally {
      setBusy(false);
    }
  }

  const card = (c: LibraryChoice) => {
    const on = picked === c.key;
    const used = inUse(c);
    const doc = on ? docs.get<TemplateDoc>(c.hash) : null;
    const description = c.source === 'ours' ? c.item.description : c.shared.description;
    return (
      <Card key={c.key} onPress={() => setPicked(on ? null : c.key)} accessibilityLabel={`${c.name}${used ? ', in use' : ''}`}
        style={on ? { borderWidth: 2, borderColor: C.primary } : null}>
        <View style={styles.head}>
          <View style={[styles.tile, on ? { backgroundColor: C.primary } : null]}>
            <Ico name={doc?.structure === 'outline' ? 'folder' : 'book'} size={22} color={on ? C.white : C.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={txt.h3}>{c.name}{used ? ' · in use' : ''}</Text>
            <Text style={[txt.sm, { fontWeight: '600', color: C.primary }]}>{choiceLine(c, sourceLine)}</Text>
            {description ? <Text style={[txt.smMuted, { marginTop: 2 }]}>{description}</Text> : null}
          </View>
          {on ? <Ico name="check" size={22} color={C.primary} /> : null}
        </View>
        {on ? (doc ? <LevelsLine levels={docLevels(doc)} /> : <LoadingLine />) : null}
      </Card>
    );
  };

  const changing = !!pick && !inUse(pick);
  return (
    <Screen
      header={<Header title="Choose a Template" sub={currentName ? `For ${lane} · now ${currentName}` : `For ${lane}`} onBack={ctx.back} />}
      footer={changing && pick ? (
        <>
          <Text style={txt.smMuted}>
            {sel
              ? `${lane}'s current ${currentParts} are hidden, not deleted.${recorded ? ` ${plural(recorded, 'part has', 'parts have')} recordings — change back to this template to bring them back.` : ''}`
              : `${lane} will record against ${pick.name}. You can change it later; nothing recorded is ever deleted.`}
            {pick.source === 'shared' ? ` Your organization follows it, so ${pick.shared.org_name}'s new versions reach ${lane} by themselves.` : ''}
          </Text>
          <PrimaryBtn label={`Use ${pick.name}`} icon="check" busy={busy} disabled={!canUse} onPress={() => void use(pick)} />
        </>
      ) : undefined}>
      <SectionLabel label="Your organization" />
      {ours.length === 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>Your organization has no templates yet. Choose one another organization shares.</Text>
      ) : ours.map(card)}
      <SectionLabel label="From other organizations" />
      <SharedOffline error={shared.error} empty={shared.rows.length === 0} />
      {others.slice(0, sharedLimit).map(card)}
      <ShowMore remaining={others.length - sharedLimit} step={5} onMore={() => setSharedLimit((l) => l + 5)} />
    </Screen>
  );
}

// ---- Template editor (TPL-9) -------------------------------------------------------------------

const levelSub = (i: number, count: number, display?: string) =>
  i === count - 1 ? `Recorded · shown by ${display ?? 'reference'}` : i === count - 2 ? "Holds what's recorded · can be downloaded" : 'Holds folders';

export function TemplateEditor(ctx: Ctx) {
  const itemId = ctx.params['itemId'];
  if (itemId) return <LibraryTemplate ctx={ctx} itemId={itemId} />;
  if (ctx.params['new']) return <NewTemplate ctx={ctx} />;
  return <AppTemplate ctx={ctx} />;
}

/** A language on a template from the catalog that used to ship in the app: its name and levels, read-only. */
function AppTemplate({ ctx }: { ctx: Ctx }) {
  const state = ctx.project.state;
  const laneId = ctx.params['laneId'] ?? ctx.laneId;
  if (!state) return <Loading title="Template Outline" onBack={ctx.back} />;
  const sel = laneId && state.lanes[laneId] ? laneTemplateOf(state, laneId) : null;
  if (!sel || sel.source !== 'legacy' || !laneId) {
    return (
      <Screen header={<Header title="Template Outline" onBack={ctx.back} />}>
        <EmptyState icon="template" title="Template not found" sub="Open a template from Content Templates." />
      </Screen>
    );
  }
  const lane = laneName(state, laneId);
  return (
    <Screen header={<Header title={sel.name} sub={`${lane}'s template`} onBack={ctx.back} />}>
      <Banner icon="lock" title="Built into the app" body={`To change ${lane}'s structure, choose a template from the library under Change template.`} />
      <SectionLabel label="Levels" />
      <Group>
        {sel.levels.map((l, i) => (
          <Row key={`${l}-${i}`} icon={i === sel.levels.length - 1 ? 'media' : 'folder'} label={l} sub={levelSub(i, sel.levels.length)} last={i === sel.levels.length - 1} />
        ))}
      </Group>
    </Screen>
  );
}

/** One of the organization's templates, opened once its document is on the phone. */
function LibraryTemplate({ ctx, itemId }: { ctx: Ctx; itemId: string }) {
  const lib = useLibrary(ctx);
  const item = lib.item(itemId);
  const docs = useLibraryDocs(lib.orgId, [item?.current]);
  const doc = docs.get<TemplateDoc>(item?.current);
  if (!item || item.kind !== 'template') {
    return (
      <Screen header={<Header title="Template Outline" onBack={ctx.back} />}>
        <EmptyState icon="template" title="Template not found" sub="It is not in your organization's library." />
      </Screen>
    );
  }
  if (!doc) {
    return (
      <Screen header={<Header title={item.name} sub={sourceLine(item)} onBack={ctx.back} />}>
        {docs.error ? <Banner icon="cloud" tone="amber" title="Not on this phone yet" body="Connect to open this template." /> : <LoadingLine />}
      </Screen>
    );
  }
  return <TemplateEditorForm key={item.current} ctx={ctx} lib={lib} item={item} initial={formFromDoc(doc, item.name, item.description)} />;
}

/** The versifications a Bible template can be numbered in: the organization's, then shared ones (LangQuest's English first). */
function useVersifications(ctx: Ctx, lib: Lib, enabled = true) {
  const shared = useSharedItems('versification', lib.orgId, enabled);
  const library = ctx.org.state?.library;
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('versification'), shared.rows, 'English'), [library, lib.items, shared.rows]);
  return { choices, error: shared.error };
}

/** "New template": Scripture from a chosen versification, or an outline built by hand. */
function NewTemplate({ ctx }: { ctx: Ctx }) {
  const lib = useLibrary(ctx);
  const v = useVersifications(ctx, lib);
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [bible, setBible] = useState(false);
  const [busy, setBusy] = useState(false);
  if (form) return <TemplateEditorForm ctx={ctx} lib={lib} item={null} initial={form} />;

  async function start(c: LibraryChoice) {
    if (busy) return;
    setBusy(true);
    try {
      const doc = (await loadDocs(lib.orgId, [c.hash])).get(c.hash);
      if (!doc || doc.format !== 'versification@1') throw new Error('Its versification is not on this phone yet. Try again when connected.');
      setForm(newTemplateForm('bible', { hash: c.hash, doc }));
    } catch (e) {
      ctx.toast(failure('new template versification', e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<Header title="New Template" sub={orgName(ctx)} onBack={bible ? () => setBible(false) : ctx.back} />}>
      {!bible ? (
        <>
          <Text style={txt.body}>What will languages record with it?</Text>
          <Card onPress={() => setBible(true)} accessibilityLabel="Scripture">
            <View style={styles.head}>
              <View style={styles.tile}><Ico name="book" size={22} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={txt.h3}>Scripture</Text>
                <Text style={txt.smMuted}>Books and chapters of the Bible, divided into passages as teams go.</Text>
              </View>
            </View>
          </Card>
          <Card onPress={() => setForm(newTemplateForm('outline'))} accessibilityLabel="Something else">
            <View style={styles.head}>
              <View style={styles.tile}><Ico name="folder" size={22} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={txt.h3}>Something else</Text>
                <Text style={txt.smMuted}>Lessons, stories, a commentary — any outline you build yourself.</Text>
              </View>
            </View>
          </Card>
        </>
      ) : (
        <>
          <Text style={txt.body}>Which numbering of chapters and verses does it follow?</Text>
          <SharedOffline error={v.error} empty={v.choices.length === 0} />
          <Group>
            {v.choices.map((c, i) => (
              <Row key={c.key} icon="book" label={c.name} sub={choiceLine(c, sourceLine)} onPress={busy ? undefined : () => void start(c)} last={i === v.choices.length - 1} />
            ))}
          </Group>
        </>
      )}
    </Screen>
  );
}

/**
 * The editor itself (the demo's TemplateEditorScreen): name, description,
 * levels, and for Scripture the versification, the books and their names,
 * and how they divide; for an outline, the whole outline in one scroll.
 * Save publishes the next version. A followed template opens read-only.
 */
function TemplateEditorForm({ ctx, lib, item, initial }: { ctx: Ctx; lib: Lib; item: LibraryItemView | null; initial: TemplateForm }) {
  const state = ctx.project.state;
  const [f, setF] = useState<TemplateForm>(initial);
  const [editingLevel, setEditingLevel] = useState<number | null>(null);
  const [editingBook, setEditingBook] = useState<string | null>(null);
  const [addingBook, setAddingBook] = useState(false);
  const [choosingV11n, setChoosingV11n] = useState(false);
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [bookLimit, setBookLimit] = useState(12);
  const { busy, run } = useRunner(ctx);
  const v = useVersifications(ctx, lib, f.structure === 'bible');
  const docs = useLibraryDocs(lib.orgId, [f.versification]);
  const v11n = docs.get<VersificationDoc>(f.versification);
  const set = (patch: Partial<TemplateForm>) => setF((prev) => ({ ...prev, ...patch }));
  const isNew = item === null;
  const followed = item?.source === 'subscription';
  const readOnly = !ctx.session.can('manage_templates') || followed;
  const changed = isNew || formChanged(f, initial) || f.name.trim() !== initial.name || f.description.trim() !== initial.description;
  const users = item ? lanesUsing(state, item.itemId).map((l) => (state ? laneName(state, l) : l)) : [];
  const bible = f.structure === 'bible';
  const v11nChoice = v.choices.find((c) => c.hash === f.versification);
  const v11nName = v11n?.name ?? v11nChoice?.name ?? (f.versification ? 'Loading…' : 'Choose one');
  const ready = !!f.name.trim() && (!bible || (!!f.versification && f.books.length > 0)) && (bible || f.outline.length > 0);

  function save() {
    void run('save template', async () => {
      const name = f.name.trim();
      // A versification another organization shares is followed (or copied) first, so this organization may name it.
      if (bible && v11nChoice?.source === 'shared') {
        if (v11nChoice.shared.subscribable) await lib.subscribe(v11nChoice.shared, true);
        else await lib.copy(v11nChoice.shared);
      }
      const { docHash } = await lib.publish({
        kind: 'template', ...(item ? { itemId: item.itemId } : {}), name, description: f.description.trim(), doc: docFromForm(f)
      });
      const n = (item?.versions.length ?? 0) + (item?.versions.some((x) => x.docHash === docHash) ? 0 : 1);
      ctx.toast(isNew ? `${name} created.` : `${name} saved as version ${n}. ${movesLine(users)}`.trim());
      ctx.back();
    });
  }

  const sub = isNew ? `New template · ${orgName(ctx)}` : followed ? sourceLine(item) : `Template · ${sourceLine(item)}`;
  const shownBooks = f.books.slice(0, bookLimit);
  const bookSheet = editingBook ? f.books.find((b) => b.book === editingBook) : undefined;
  const missing = v11n ? versificationBooks(v11n).filter((b) => !f.books.some((x) => x.book === b)) : [];
  const node = editingNode ? findNode(f.outline, editingNode) : undefined;
  const nodeSiblings = editingNode ? siblingsOf(f.outline, editingNode) : [];

  return (
    <Screen
      header={<Header title={f.name.trim() || 'New template'} sub={sub} onBack={() => (changed && !readOnly && !isNew ? setLeaving(true) : ctx.back())} />}
      footer={readOnly ? undefined : (
        <PrimaryBtn label={isNew ? 'Create template' : 'Save changes'} icon="check" busy={busy} disabled={!changed || !ready} onPress={save} />
      )}>
      {followed ? (
        <>
          <Banner icon="lock" title={`It follows ${item!.subscription!.sourceOrgName}`} body="Its versions come from there. Copy it to change it." />
          {ctx.session.can('manage_templates') ? (
            <GhostBtn label="Copy to change it" icon="edit" disabled={busy} onPress={() => void run('copy template', async () => {
              await lib.copyFollowed(item!);
              ctx.toast(`${item!.name} copied. Find the copy under Your organization.`);
              ctx.back();
            })} />
          ) : null}
        </>
      ) : null}

      {readOnly ? (
        f.description ? <Card><Text style={txt.body}>{f.description}</Text></Card> : null
      ) : (
        <>
          <Field label="Name" value={f.name} onChangeText={(name) => set({ name })} placeholder="Template name" autoCapitalize="words" />
          <Field label="What it's for" value={f.description} onChangeText={(description) => set({ description })} placeholder="What it's for, in a sentence" multiline />
        </>
      )}
      {users.length > 0 ? (
        <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
          Used by {joinNames(users)}. {users.length === 1 ? 'It moves' : 'They move'} to each new version by {users.length === 1 ? 'itself' : 'themselves'}; recordings stay where they are.
        </Text>
      ) : null}

      <SectionLabel label="Levels" />
      <Group>
        {f.levels.map((l, i) => (
          <Row key={`${l.name}-${i}`} icon={i === f.levels.length - 1 ? 'media' : 'folder'} label={l.name}
            sub={levelSub(i, f.levels.length, l.display ?? (bible ? 'reference' : 'name'))}
            onPress={readOnly ? undefined : () => setEditingLevel(i)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />}
            last={i === f.levels.length - 1} />
        ))}
      </Group>

      {bible ? (
        <>
          <SectionLabel label="Versification" />
          <Group>
            <Row icon="book" label={v11nName} sub="How its chapters and verses are numbered" last
              onPress={readOnly ? undefined : () => setChoosingV11n(true)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />} />
          </Group>

          <SectionLabel label="Divide into" />
          <ChipRow>
            <Chip label="Whole books" on={f.divide === 'books'} onPress={() => !readOnly && set({ divide: 'books', levels: levelsForDivide(f.levels, 'books') })} />
            <Chip label="Chapters" on={f.divide === 'chapters'} onPress={() => !readOnly && set({ divide: 'chapters', levels: levelsForDivide(f.levels, 'chapters') })} />
            {f.passages.length > 0 ? (
              <Chip label="Passages" on={f.divide === 'passages'} onPress={() => !readOnly && set({ divide: 'passages', levels: levelsForDivide(f.levels, 'passages') })} />
            ) : null}
          </ChipRow>
          <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>
            {f.divide === 'passages'
              ? `${plural(f.passages.length, 'passage')}, as the version this started from divides them. Changing where passages start is coming.`
              : f.divide === 'books' ? 'Each book is one part to record.' : 'Each chapter is one part to record.'}
          </Text>

          <SectionLabel label={`Books · ${f.books.length}`} />
          {f.books.length === 0 ? (
            <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>No books yet.</Text>
          ) : (
            <Group>
              {shownBooks.map((b, i) => {
                const english = englishBookName(b.book);
                const chapters = v11n ? chaptersInBook(v11n, b.book) : 0;
                return (
                  <Row key={b.book} icon="book" label={b.name}
                    sub={`${b.book}${english !== b.name ? ` · ${english}` : ''}${chapters ? ` · ${plural(chapters, 'chapter')}` : ''}`}
                    onPress={readOnly ? undefined : () => setEditingBook(b.book)} right={readOnly ? undefined : <Ico name="edit" size={20} color={C.muted} />}
                    last={i === shownBooks.length - 1} />
                );
              })}
            </Group>
          )}
          <ShowMore remaining={f.books.length - bookLimit} step={12} onMore={() => setBookLimit((l) => l + 12)} />
          {!readOnly ? <GhostBtn label="Add a book" icon="plus" disabled={!v11n || missing.length === 0} onPress={() => setAddingBook(true)} /> : null}
        </>
      ) : (
        <>
          <SectionLabel label="Outline" />
          <OutlineScroll outline={f.outline} levels={f.levels} readOnly={readOnly}
            onChange={(outline, edit) => { set({ outline, levels: levelsForOutline(outline, f.levels) }); if (edit) setEditingNode(edit); }}
            onEdit={setEditingNode} />
        </>
      )}

      {editingLevel !== null && f.levels[editingLevel] ? (
        <LevelSheet level={f.levels[editingLevel]!} last={editingLevel === f.levels.length - 1} bible={bible} onClose={() => setEditingLevel(null)}
          onSave={(l) => { set({ levels: f.levels.map((x, i) => (i === editingLevel ? l : x)) }); setEditingLevel(null); }} />
      ) : null}
      {bookSheet ? (
        <BookSheet book={bookSheet} onClose={() => setEditingBook(null)}
          onSave={(name) => { set({ books: f.books.map((b) => (b.book === bookSheet.book ? { ...b, name } : b)) }); setEditingBook(null); }}
          onRemove={() => { set({ books: f.books.filter((b) => b.book !== bookSheet.book) }); setEditingBook(null); }} />
      ) : null}
      {addingBook ? (
        <AddBookSheet books={missing} onClose={() => setAddingBook(false)}
          onAdd={(book) => set({ books: [...f.books, { book, name: englishBookName(book) }] })} />
      ) : null}
      {choosingV11n ? (
        <Sheet visible title="Versification" sub="How chapters and verses are numbered. Study material numbered another way still lines up." onClose={() => setChoosingV11n(false)}>
          <SharedOffline error={v.error} empty={v.choices.length === 0} />
          <Group>
            {v.choices.map((c, i) => (
              <Row key={c.key} label={c.name} sub={choiceLine(c, sourceLine)} role="radio" selected={c.hash === f.versification}
                onPress={() => { set({ versification: c.hash }); setChoosingV11n(false); }} last={i === v.choices.length - 1}
                right={c.hash === f.versification ? <Ico name="check" size={22} color={C.primary} /> : <View style={{ width: 22 }} />} />
            ))}
          </Group>
        </Sheet>
      ) : null}
      {node ? (
        <NodeSheet node={node} index={nodeSiblings.findIndex((s) => s.id === node.id)} count={nodeSiblings.length} onClose={() => setEditingNode(null)}
          onRename={(title) => set({ outline: renameNode(f.outline, node.id, title) })}
          onMove={(by) => set({ outline: moveNode(f.outline, node.id, by) })}
          onRemove={() => { const outline = removeNode(f.outline, node.id); set({ outline, levels: levelsForOutline(outline, f.levels) }); setEditingNode(null); }} />
      ) : null}
      {leaving ? (
        <Sheet visible title="Leave without saving?" sub="Your changes to this template are not saved." onClose={() => setLeaving(false)}
          footer={<>
            <PrimaryBtn label="Keep editing" onPress={() => setLeaving(false)} />
            <GhostBtn label="Leave" tone="red" onPress={() => { setLeaving(false); ctx.back(); }} />
          </>}>
          <Text style={txt.smMuted}>Save publishes them as the next version.</Text>
        </Sheet>
      ) : null}
    </Screen>
  );
}

/** A level: what the team calls it, and for a Bible template's last level how each part is shown (the demo's LevelSheet). */
function LevelSheet(props: { level: TemplateForm['levels'][number]; last: boolean; bible: boolean; onClose: () => void; onSave: (l: TemplateForm['levels'][number]) => void }) {
  const [name, setName] = useState(props.level.name);
  const [display, setDisplay] = useState(props.level.display ?? (props.bible ? 'reference' : 'name'));
  return (
    <Sheet visible title="Level" sub="What your team calls it. Everyone sees this word in the app — on the map, in requests, on the record." onClose={props.onClose}
      footer={<PrimaryBtn label="Done" disabled={!name.trim()} onPress={() => props.onSave({ name: name.trim(), ...(props.last ? { display } : {}) })} />}>
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Passage, Story, Lesson" autoCapitalize="words" />
      {props.last && props.bible ? (
        <>
          <Text style={txt.xsStrong}>Show each one by</Text>
          <ChipRow>
            <Chip label="Reference" on={display === 'reference'} onPress={() => setDisplay('reference')} />
            <Chip label="Name" on={display === 'name'} onPress={() => setDisplay('name')} />
            <Chip label="Both" on={display === 'both'} onPress={() => setDisplay('both')} />
          </ChipRow>
          <Text style={txt.smMuted}>
            {display === 'reference' ? 'Luke 15:11–32' : display === 'name' ? "The lost son (the reference when there's no name)" : 'The lost son · Luke 15:11–32'}
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

/** A book: its name in the language, or take it out of the template. */
function BookSheet(props: { book: { book: string; name: string }; onClose: () => void; onSave: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(props.book.name);
  return (
    <Sheet visible title={englishBookName(props.book.book)} sub="What the language calls it. Everyone sees this name on the map and the record." onClose={props.onClose}
      footer={<PrimaryBtn label="Done" disabled={!name.trim()} onPress={() => props.onSave(name.trim())} />}>
      <Field label="Name in the language" value={name} onChangeText={setName} placeholder={englishBookName(props.book.book)} autoCapitalize="words" />
      <GhostBtn label="Remove this book" icon="trash" tone="red" onPress={props.onRemove} />
      <Text style={txt.smMuted}>Languages using the template keep anything recorded in it; its parts are set aside, not deleted.</Text>
    </Sheet>
  );
}

/** Books the versification has that the template does not, to add. */
function AddBookSheet(props: { books: string[]; onClose: () => void; onAdd: (book: string) => void }) {
  const [limit, setLimit] = useState(20);
  const [added, setAdded] = useState<string[]>([]);
  const left = props.books.filter((b) => !added.includes(b));
  return (
    <Sheet visible title="Add a book" sub="Books this versification has that the template does not." onClose={props.onClose}
      footer={<PrimaryBtn label="Done" onPress={props.onClose} />}>
      {left.length === 0 ? <Text style={txt.smMuted}>Every book is in the template.</Text> : (
        <Group>
          {left.slice(0, limit).map((b, i, shown) => (
            <Row key={b} icon="plus" label={englishBookName(b)} sub={b} onPress={() => { props.onAdd(b); setAdded((a) => [...a, b]); }} last={i === shown.length - 1} />
          ))}
        </Group>
      )}
      <ShowMore remaining={left.length - limit} step={20} onMore={() => setLimit((l) => l + 20)} />
    </Sheet>
  );
}

/**
 * The outline in one scroll (the demo's OutlineScroll): folders are headers
 * and what's recorded sits under them. A folder holds folders or items,
 * never both; a folder of items is what a phone downloads for offline use.
 */
function OutlineScroll(props: {
  outline: TemplateForm['outline']; levels: TemplateForm['levels']; readOnly: boolean;
  onChange: (outline: TemplateForm['outline'], edit?: string) => void; onEdit: (id: string) => void;
}) {
  const levelName = (d: number) => props.levels[Math.min(d, props.levels.length - 1)]?.name ?? 'Part';

  function add(parentId: string | null, folder: boolean, depth: number) {
    const id = `n${Crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
    // Opened straight away so it can be named.
    props.onChange(addNode(props.outline, parentId, { id, title: `New ${lower(levelName(depth))}`, folder }), id);
  }

  function render(list: TemplateForm['outline'], depth: number, parentId: string | null) {
    const holds = list.length === 0 ? 'either' : list[0]!.children ? 'folders' : 'items';
    return (
      <View style={depth ? styles.outlineIndent : null}>
        {list.map((n) => n.children ? (
          <View key={n.id}>
            <Pressable disabled={props.readOnly} onPress={() => props.onEdit(n.id)} accessibilityRole="button" accessibilityLabel={`Edit ${n.title}`}
              style={({ pressed }) => [styles.outlineHead, pressed && { opacity: 0.7 }]}>
              <Ico name="folder" size={depth ? 18 : 22} color={C.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[depth ? txt.body : txt.h3, { fontWeight: '700' }]} numberOfLines={1}>{n.title}</Text>
                <Text style={txt.smMuted}>{(() => { const c = countOutline(n.children); return c.folders ? plural(c.folders, 'folder') : plural(c.items, 'item'); })()}</Text>
              </View>
              {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
            </Pressable>
            {render(n.children, depth + 1, n.id)}
          </View>
        ) : (
          <Pressable key={n.id} disabled={props.readOnly} onPress={() => props.onEdit(n.id)} accessibilityRole="button" accessibilityLabel={`Edit ${n.title}`}
            style={({ pressed }) => [styles.outlineItem, pressed && { opacity: 0.7 }]}>
            <View style={[styles.tile, { backgroundColor: TINT.green }]}><Ico name="media" size={20} color={TINT.greenText} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[txt.body, { fontWeight: '600' }]} numberOfLines={1}>{n.title}</Text>
              <Text style={txt.smMuted}>{levelName(depth)}</Text>
            </View>
            {!props.readOnly ? <Ico name="edit" size={20} color={C.muted} /> : null}
          </Pressable>
        ))}
        {!props.readOnly ? (
          <View style={styles.addRow}>
            {holds !== 'items' ? <SmallBtn label={`Add ${lower(levelName(depth))} folder`} icon="folder" onPress={() => add(parentId, true, depth)} /> : null}
            {holds !== 'folders' ? <SmallBtn label={`Add ${lower(levelName(depth))}`} icon="media" onPress={() => add(parentId, false, depth)} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (props.readOnly && props.outline.length === 0) return <Text style={[txt.smMuted, { paddingHorizontal: space.xs }]}>The outline is empty.</Text>;
  return render(props.outline, 0, null);
}

/** One part of the outline: rename, move, or remove it (the demo's NodeSheet). */
function NodeSheet(props: {
  node: TemplateForm['outline'][number]; index: number; count: number;
  onClose: () => void; onRename: (title: string) => void; onMove: (by: number) => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(props.node.title);
  const folder = !!props.node.children;
  const done = () => {
    if (title.trim() && title.trim() !== props.node.title) props.onRename(title.trim());
    props.onClose();
  };
  return (
    <Sheet visible title={folder ? 'Folder' : 'Item'} sub={folder ? "Groups what's inside it." : 'Something people record.'} onClose={done}
      footer={<PrimaryBtn label="Done" disabled={!title.trim()} onPress={done} />}>
      <Field label="Name" value={title} onChangeText={setTitle} placeholder="Name" autoCapitalize="sentences" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}><GhostBtn label="Move up" icon="up" disabled={props.index <= 0} onPress={() => props.onMove(-1)} /></View>
        <View style={{ flex: 1 }}><GhostBtn label="Move down" icon="down" disabled={props.index >= props.count - 1} onPress={() => props.onMove(1)} /></View>
      </View>
      <GhostBtn label={folder ? 'Remove this folder' : 'Remove this item'} icon="trash" tone="red" onPress={props.onRemove} />
      <Text style={txt.smMuted}>Languages using the template keep anything recorded on it; it is set aside, not deleted.</Text>
    </Sheet>
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
  const sel = state && laneId && state.lanes[laneId] ? laneTemplateOf(state, laneId) : null;
  const docs = useLibraryDocs(ctx.project.orgId, [sel?.source === 'library' ? sel.docHash : null]);
  const doc = sel?.source === 'library' ? docs.get<TemplateDoc>(sel.docHash) : null;

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
    // FIA's breaks show only where the language divides differently (TPL-5): where a part starts there, no mark.
    const textOf = (c: number, v: number) => text.get(`${c}:${v}`);
    const label = bookRows(state, idx, laneId).find((r) => r.book.itemId === book.itemId)?.label ?? book.label;
    return { lane: laneName(state, laneId), label, segments, recorded, textOf, translation, fia: fiaStarts(book) };
  }, [state, laneId, book]);

  if (!state) return <Loading title="Divide a Book" onBack={ctx.back} />;
  if (!book || !data || !laneId) {
    return (
      <Screen header={<Header title="Divide a Book" onBack={ctx.back} />}>
        <EmptyState icon="book" title="Choose a book" sub="Open a book from the language's Content Template, or from its Map." />
      </Screen>
    );
  }
  const part = partName(state, laneId, doc);
  const parts = lower(pluralOf(part));
  const chapters = book.verses.map((_, i) => i + 1);
  const fia = canShape ? data.fia : new Set<number>();
  const jump = (c: number) => list.current?.scrollToIndex({ index: c - 1, animated: true });

  return (
    <Screen fixed header={<Header title={data.label} sub={`${data.lane} · ${plural(data.segments.length, lower(part), parts)}`} onBack={ctx.back} />}>
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
              body={`For now you can read how ${data.lane}'s ${parts} divide ${data.label}${fia.size ? ", with FIA's breaks marked as suggestions" : ''}.`} />
            {data.segments.length === 0 ? (
              <Text style={txt.smMuted}>{data.lane} has no {parts} in {data.label} yet.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item: c }) => (
          <ChapterView book={book} c={c} segments={data.segments} fia={fia} text={data.textOf} part={part}
            translation={data.translation.get(c)} recorded={data.recorded} />
        )}
      />
      <Sheet visible={picking} title={data.label} sub="Jump to a chapter." onClose={() => setPicking(false)}>
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
  pair: { flexDirection: 'row', gap: space.sm },
  outlineIndent: { marginLeft: space.lg, paddingLeft: space.md, borderLeftWidth: 2, borderColor: C.border },
  outlineHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, paddingTop: space.sm },
  outlineItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, marginTop: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.card
  },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
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
