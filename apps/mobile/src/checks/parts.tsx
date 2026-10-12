// Parts every check screen shares (decision 91): who is on a check, as faces
// and names, and a check's helps as a reviewer opens them.
import { checkHelps, type LanguageState } from '@langquest-next/core';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { C, space } from '../theme';
import { usePerson, PersonAvatar } from '../UserChip';
import type { IconName } from '../kit';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { refKindOf } from '../reference/model';
import { referenceKindName } from '../screens/configModel';

/** Up to four faces, overlapping. */
export function Faces(props: { people: string[]; size?: number }) {
  const look = usePerson();
  const size = props.size ?? 26;
  return (
    <View style={{ flexDirection: 'row' }}>
      {props.people.slice(0, 4).map((id, i) => (
        <View key={id} style={[styles.face, { borderRadius: size / 2 + 1 }, i > 0 && { marginLeft: -size / 3 }]}><PersonAvatar look={look(id)} size={size} /></View>
      ))}
    </View>
  );
}

/** "Achol, Deng" with their faces, or "Anyone" when nobody is on the check. */
export function PeopleLine(props: { ctx: Ctx; people: string[]; size?: number }) {
  if (props.people.length === 0) return <Text style={styles.anyone}>{t('checks.anyone')}</Text>;
  return (
    <View style={styles.line}>
      <Faces people={props.people} {...(props.size ? { size: props.size } : {})} />
      <Text style={styles.names} numberOfLines={1}>{props.people.map((id) => props.ctx.name(id)).join(t('admin.list.separator'))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  anyone: { fontSize: 15, color: C.muted, fontWeight: '600' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  face: { borderWidth: 1.5, borderColor: C.white },
  names: { flex: 1, fontSize: 15, color: C.muted, fontWeight: '600' }
});

/** A help on a check, as a reviewer opens it: a note or document, a study guide, or a Bible. */
export interface HelpRow {
  key: string;
  name: string;
  sub?: string;
  icon: IconName;
  open: { screen: 'material_editor'; params: Record<string, string> } | { screen: 'study_guide' } | { bible: string };
}

/** A check's helps (decision 91) with their names and how each opens. */
export function useCheckHelpRows(ctx: Ctx, state: LanguageState | null | undefined, kindId: string): HelpRow[] {
  const lib = useLibrary(ctx);
  const helps = useMemo(() => (state ? checkHelps(state, kindId) : []), [state, kindId]);
  const docs = useLibraryDocs(lib.orgId, helps.map((h) => ('itemId' in h ? lib.item(h.itemId)?.current : undefined)), { deps: false });
  if (!state) return [];
  return helps.flatMap((h): HelpRow[] => {
    if ('materialId' in h) {
      const m = state.materials[h.materialId];
      if (!m) return [];
      return [{ key: h.materialId, name: m.title, sub: referenceKindName(m.kind), icon: 'note', open: { screen: 'material_editor', params: { materialId: h.materialId, languageId: ctx.language.languageId } } }];
    }
    const it = lib.item(h.itemId);
    if (!it) return [];
    const kind = refKindOf(docs.get(it.current));
    if (kind === 'source') return [{ key: h.itemId, name: it.name, icon: 'book', open: { bible: h.itemId } }];
    if (kind === 'guide') return [{ key: h.itemId, name: it.name, icon: 'sparkle', open: { screen: 'study_guide' } }];
    return [{ key: h.itemId, name: it.name, ...(it.description ? { sub: it.description } : {}), icon: 'note', open: { screen: 'material_editor', params: { itemId: h.itemId } } }];
  });
}
