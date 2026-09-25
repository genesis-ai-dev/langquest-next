import { StyleSheet } from './theme';
// The one way to show a person: avatar + name, tap for name and full id.
// Names are not unique and can change, so the id is always one tap away.
import { createContext, useContext, useRef, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { personLook, type PersonLook } from './people';
import { colors, radius, space } from './theme';
import { text } from './ui';

/** profileId -> display name. Provided once per workspace (App.tsx). */
export const PeopleContext = createContext<Record<string, string>>({});

export function usePerson(): (id: string) => PersonLook {
  const names = useContext(PeopleContext);
  return (id) => personLook(id, names[id]);
}

const SHAPE_POINTS = {
  diamond: '12,1 23,12 12,23 1,12',
  triangle: '12,2 23,21 1,21',
  hexagon: '6,2 18,2 23,12 18,22 6,22 1,12'
} as const;

export function PersonAvatar(props: { look: PersonLook; size?: number }) {
  const { look } = props;
  const size = props.size ?? 20;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {look.shape === 'circle' ? <Circle cx={12} cy={12} r={11} fill={look.color} />
        : look.shape === 'square' ? <Rect x={2} y={2} width={20} height={20} rx={4} fill={look.color} />
        : <Polygon points={SHAPE_POINTS[look.shape]} fill={look.color} />}
      {look.initials ? (
        <SvgText x={12} y={16} fontSize={10} fontWeight="600" fill={colors.white} textAnchor="middle">{look.initials}</SvgText>
      ) : null}
    </Svg>
  );
}

export function UserChip(props: { id: string }) {
  const look = usePerson()(props.id);
  const ref = useRef<View>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const { width, height } = useWindowDimensions();
  // Below the chip, or above it when too close to the bottom edge.
  const open = () => ref.current?.measureInWindow((x, y, _w, h) =>
    setAt({ x, y: y + h + TIP_HEIGHT > height ? y - TIP_HEIGHT - space.xs : y + h + space.xs }));
  return (
    <>
      <Pressable ref={ref} onPress={open} hitSlop={6} accessibilityRole="button"
        accessibilityLabel={`${look.name}. Show id`} style={[styles.chip, { backgroundColor: `${look.color}1F` }]}>
        <PersonAvatar look={look} size={16} />
        <Text style={[text.small, styles.chipName]} numberOfLines={1}>{look.name}</Text>
      </Pressable>
      <Modal visible={!!at} transparent animationType="fade" onRequestClose={() => setAt(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setAt(null)} accessibilityLabel="Close">
          {at ? (
            <View style={[styles.tip, { top: at.y, left: Math.max(space.lg, Math.min(at.x, width - TIP_WIDTH - space.lg)) }]}>
              <View style={styles.tipHead}>
                <PersonAvatar look={look} size={24} />
                <Text style={text.body} numberOfLines={2}>{look.name}</Text>
              </View>
              {look.anonymous ? <Text style={text.small}>No name set yet</Text> : null}
              <Text style={text.small} selectable>ID {look.id}</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

/** "submitted by <chip>": prose around a person, for Row and Header subs. */
export function Byline(props: { before?: string; id: string; after?: string }) {
  return (
    <View style={styles.byline}>
      {props.before ? <Text style={text.small}>{props.before}</Text> : null}
      <UserChip id={props.id} />
      {props.after ? <Text style={text.small}>{props.after}</Text> : null}
    </View>
  );
}

const TIP_WIDTH = 260;
const TIP_HEIGHT = 110;
const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', maxWidth: 200,
    paddingLeft: 3, paddingRight: space.sm, paddingVertical: 2, borderRadius: radius.full },
  chipName: { color: colors.foreground, flexShrink: 1 },
  byline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  tip: { position: 'absolute', width: TIP_WIDTH, gap: space.xs, padding: space.md, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm }
});
