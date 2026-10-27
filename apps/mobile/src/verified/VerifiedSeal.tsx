// The blue check after a verified organization's name (decisions.md 172):
// the same small seal wherever the name shows, which explains itself to a
// screen reader. It is not a button of its own: rows keep their one action,
// and what the check means is on the organization's Manage page.
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '../ui/text';
import Svg, { Path, Polygon } from 'react-native-svg';
import { t } from '../i18n';
import { C } from '../ui/theme';
import { useOrgBadge, type OrgBadge } from './useOrgBadges';

/** A 24-point rosette: the seal's outline. */
const POINTS = Array.from({ length: 24 }, (_, i) => {
  const r = i % 2 ? 9.3 : 11.6;
  const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
  return `${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

export function Seal(props: { size?: number; badge?: OrgBadge | null }) {
  const size = props.size ?? 16;
  return (
    <View accessible accessibilityRole="image"
      accessibilityLabel={props.badge ? t('verified.sealLabelDomain', { domain: props.badge.domain }) : t('verified.sealLabel')}
      style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Polygon points={POINTS} fill={C.verified} stroke={C.verified} strokeWidth={1.6} strokeLinejoin="round" />
        <Path d="M7.4 12.3l3.1 3.1 6.1-6.4" fill="none" stroke={C.white} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

/** The seal sized to sit in a line of text of this font size, a little below its middle. */
function InlineSeal(props: { fontSize: number; badge: OrgBadge }) {
  const size = Math.round(props.fontSize * 1.05);
  return (
    <View style={{ marginLeft: Math.max(2, Math.round(props.fontSize * 0.22)), transform: [{ translateY: Math.round(size * 0.16) }] }}>
      <Seal size={size} badge={props.badge} />
    </View>
  );
}

/**
 * A line that names an organization ("6 checks · from unfoldingWord",
 * "Following LangQuest · updates automatically"), with the seal right after
 * the name when the organization is verified. The line is the whole sentence
 * in the language showing; the seal goes after the first place the name
 * appears in it.
 */
export function OrgLine(props: { text: string; orgName: string | null | undefined; orgId: string | null | undefined; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const badge = useOrgBadge(props.orgId);
  const style = props.style;
  const at = badge && props.orgName ? props.text.indexOf(props.orgName) : -1;
  if (at < 0 || !badge) return <Text style={style} {...(props.numberOfLines ? { numberOfLines: props.numberOfLines } : {})}>{props.text}</Text>;
  const end = at + props.orgName!.length;
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};
  return (
    <Text style={style} {...(props.numberOfLines ? { numberOfLines: props.numberOfLines } : {})}>
      {props.text.slice(0, end)}
      <InlineSeal fontSize={flat.fontSize ?? 15} badge={badge} />
      {props.text.slice(end)}
    </Text>
  );
}

/** Just the seal, for a line already holding the name (a row's label): nothing when the organization is not verified. */
export function OrgSeal(props: { orgId: string | null | undefined; fontSize?: number }) {
  const badge = useOrgBadge(props.orgId);
  return badge ? <InlineSeal fontSize={props.fontSize ?? 17} badge={badge} /> : null;
}

/** An organization's name, with its seal when it is verified. */
export function OrgName(props: { name: string; orgId: string | null | undefined; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return <OrgLine text={props.name} orgName={props.name} orgId={props.orgId} {...(props.style ? { style: props.style } : {})}
    {...(props.numberOfLines ? { numberOfLines: props.numberOfLines } : {})} />;
}
