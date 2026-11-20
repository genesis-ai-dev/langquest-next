// An outline language's map (MAP-6): its folders and their stories instead of
// books and chapters. Someone who may edit templates also adds a story to a
// folder, makes a new folder and renames one here, and adds a Bible book at
// the end of a Bible language's book list (LAN-239,
// docs/decisions/2026-11-20-add-folders-and-stories-on-the-map.md). Each
// change is for this language only (useMapTemplateEdit.ts).
import { bookNameOf, type LanguageState } from '@langquest-next/core';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpRow } from '../helpMode/helpBadge';
import { Field, Group, Ico, PrimaryBtn, Row, SearchField, SectionLabel, Sheet, ShowMore } from '../ui/kit';
import { C, radius, space, target, type as T } from '../ui/theme';
import { matchRanges } from '../ui/textMatch';
import { bookNameOf as appBookName } from '../templates/contentTemplatesModel';
import { PAGE, type Entry } from './mapModel';
import { mapFolders, nameReady, outlineAdds, type MapFolder } from './outlineEditModel';
import { useMapTemplateEdit, type MapTemplateEdit } from './useMapTemplateEdit';
import { QuietIconLink } from './mapParts';

/** How the map draws one story's row: the map's own PassageRow, so a story reads the same everywhere. */
export type StoryRow = (e: Entry, last: boolean) => ReactNode;

export function OutlineMap(props: { ctx: Ctx; state: LanguageState; entries: Entry[]; canEdit: boolean; row: StoryRow }) {
  return props.canEdit ? <EditableOutline {...props} /> : <Folders {...props} edit={null} />;
}

/** The hooks that change the template run only for someone who may change it: they ask the server who uses it. */
function EditableOutline(props: { ctx: Ctx; state: LanguageState; entries: Entry[]; row: StoryRow }) {
  const edit = useMapTemplateEdit(props.ctx);
  return <Folders {...props} edit={edit} />;
}

type Naming = { kind: 'story'; parentId: string | null } | { kind: 'folder' } | { kind: 'rename'; nodeId: string; was: string };

function Folders(props: { ctx: Ctx; state: LanguageState; entries: Entry[]; row: StoryRow; edit: MapTemplateEdit | null }) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [naming, setNaming] = useState<Naming | null>(null);
  const folders = useMemo(() => mapFolders(props.state, props.entries), [props.state, props.entries]);
  const edit = props.edit?.ready ? props.edit : null;
  const adds = useMemo(() => outlineAdds(edit?.doc ?? null), [edit?.doc]);
  return (
    <>
      {folders.map((f) => (
        <FolderView key={f.unitId ?? ''} f={f} row={props.row} limit={limits[f.unitId ?? ''] ?? PAGE}
          onMore={(n) => setLimits((l) => ({ ...l, [f.unitId ?? '']: n }))}
          {...(edit && f.nodeId ? { onRename: () => setNaming({ kind: 'rename', nodeId: f.nodeId!, was: f.name }) } : {})}
          {...(edit && adds.storyIn(f.nodeId) ? { onAdd: () => setNaming({ kind: 'story', parentId: f.nodeId }) } : {})} />
      ))}
      {edit && adds.newFolder ? (
        <HelpRow of="map.edit.newFolder">
          <AddSlot label={t('map.edit.newFolder')} help={t('map.edit.newFolderHelp')} icon="folder" testID="map-new-folder" onPress={() => setNaming({ kind: 'folder' })} />
        </HelpRow>
      ) : null}
      {edit && naming ? <NameSheet naming={naming} edit={edit} onClose={() => setNaming(null)} /> : null}
    </>
  );
}

function FolderView(props: { f: MapFolder; row: StoryRow; limit: number; onMore: (n: number) => void; onRename?: () => void; onAdd?: () => void }) {
  const { f, limit } = props;
  const shown = f.entries.slice(0, limit);
  const rename = props.onRename
    ? <QuietIconLink icon="edit" label={t('map.edit.rename')} color={C.primary} detail={t('map.edit.renameHelp')} onPress={props.onRename} />
    : undefined;
  return (
    <HelpRow of="map.section">
      <View style={{ gap: space.sm }}>
        {f.name || rename ? <SectionLabel label={f.name} {...(rename ? { action: rename } : {})} /> : null}
        {shown.length > 0 ? (
          <Group>
            {shown.map((e, i) => <HelpRow key={e.unitId} of="map.passage">{props.row(e, i === shown.length - 1)}</HelpRow>)}
          </Group>
        ) : null}
        <ShowMore remaining={f.entries.length - limit} step={PAGE} onMore={() => props.onMore(limit + PAGE)} />
        {props.onAdd ? (
          <HelpRow of="map.edit.addStory">
            <AddSlot label={t('map.edit.addStory')} help={t('map.edit.addStoryHelp')} icon="plus" testID={`map-add-story-${f.nodeId ?? 'top'}`} onPress={props.onAdd} />
          </HelpRow>
        ) : null}
      </View>
    </HelpRow>
  );
}

/** A dashed place to add something, where it will go: a story at the end of its folder, a folder at the end of the map. */
export function AddSlot(props: { label: string; help: string; icon: 'plus' | 'folder' | 'book'; onPress: () => void; testID?: string }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable testID={props.testID} onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.slot, pressed && { opacity: 0.7 }]}>
      <Ico name={props.icon} size={20} color={C.primary} />
      <Text style={styles.slotText}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A short sheet to name a new story or folder, or to rename a folder. */
function NameSheet(props: { naming: Naming; edit: MapTemplateEdit; onClose: () => void }) {
  const n = props.naming;
  const was = n.kind === 'rename' ? n.was : '';
  const [name, setName] = useState(was);
  const ready = nameReady(name, was) && !props.edit.busy;
  const title = n.kind === 'story' ? t('map.edit.storyTitle') : n.kind === 'folder' ? t('map.edit.folderTitle') : t('map.edit.renameTitle');
  const action = n.kind === 'rename' ? t('map.edit.rename') : t('map.edit.add');
  const save = async () => {
    if (!ready) return;
    const done = n.kind === 'story' ? await props.edit.addStory(n.parentId, name)
      : n.kind === 'folder' ? await props.edit.addFolder(name)
        : await props.edit.rename(n.nodeId, name);
    if (done) props.onClose();
  };
  return (
    <Sheet visible title={title} onClose={props.onClose}
      footer={<PrimaryBtn label={action} disabled={!ready} busy={props.edit.busy} help={t('map.edit.saveHelp')} onPress={() => void save()} />}>
      <Field label={t('map.edit.name')} value={name} onChangeText={setName} autoFocus autoCapitalize="sentences" help={t('map.edit.nameHelp')}
        onSubmit={() => void save()} testID="map-name-field" />
    </Sheet>
  );
}

/** "Add a book" at the end of a Bible language's book list, for someone who may edit templates. */
export function AddBook(props: { ctx: Ctx; state: LanguageState }) {
  const edit = useMapTemplateEdit(props.ctx);
  const [open, setOpen] = useState(false);
  if (!edit.ready || edit.books.length === 0) return null;
  return (
    <>
      <HelpRow of="map.edit.addBook">
        <AddSlot label={t('map.edit.addBook')} help={t('map.edit.addBookHelp')} icon="book" testID="map-add-book" onPress={() => setOpen(true)} />
      </HelpRow>
      {open ? <BookPicker edit={edit} state={props.state} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The books to add, typed to search; a tap adds one and closes. */
function BookPicker(props: { edit: MapTemplateEdit; state: LanguageState; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(20);
  const nameOf = (book: string) => bookNameOf(props.state, book) ?? appBookName(book);
  const list = props.edit.books.filter((b) => !query.trim() || matchRanges(`${nameOf(b)} ${b}`, query).length > 0);
  const pick = async (book: string) => {
    if (await props.edit.addBook(book, nameOf(book))) props.onClose();
  };
  return (
    <Sheet visible title={t('map.edit.addBook')} onClose={props.onClose}>
      <SearchField value={query} onChangeText={(v) => { setQuery(v); setLimit(20); }} placeholder={t('map.edit.findBook')} help={t('map.edit.findBookHelp')} testID="map-book-search" />
      {list.length === 0 ? <Text style={styles.none}>{t('map.edit.noBook')}</Text> : (
        <Group>
          {list.slice(0, limit).map((b, i, shown) => (
            <HelpRow key={b} of="map.edit.book">
              <Row icon="plus" label={nameOf(b)} help={t('map.edit.bookHelp')} onPress={() => void pick(b)} last={i === shown.length - 1} />
            </HelpRow>
          ))}
        </Group>
      )}
      <ShowMore remaining={list.length - limit} step={20} onMore={() => setLimit((l) => l + 20)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  slot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: target.min + 8,
    borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: C.primary, paddingHorizontal: space.md, marginHorizontal: space.md },
  slotText: { fontSize: T.base, fontWeight: '700', color: C.primary, flexShrink: 1, textAlign: 'center' },
  none: { color: C.muted, fontSize: T.sm, paddingHorizontal: space.xs }
});
