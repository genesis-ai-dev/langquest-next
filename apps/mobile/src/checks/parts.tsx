// Parts every check screen shares (decision 91): who is on a check, as faces
// and names, and a check's helps as a reviewer opens them.
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { C, space } from '../ui/theme';
import { PersonAvatar } from '../ui/UserChip';
import { usePerson } from '../ui/usePerson';

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

