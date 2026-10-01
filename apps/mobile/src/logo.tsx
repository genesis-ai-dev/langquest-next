import Svg, { G, Path, Rect } from 'react-native-svg';
import { C } from './theme';

/** The check's path, shared by the gap it cuts and the stroke itself (assets/logo.svg). */
const CHECK = 'M57 60 L67 70 L87 36';

/**
 * The LangQuest mark on its black tile: three rising bars and a check lying
 * over the tallest one. Drawn from the same geometry as `assets/logo.svg`, so
 * the in-app logo matches the app icon. The gap is the tile colour painted
 * under the check.
 */
export function Logo(props: { size: number }) {
  const { size } = props;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="LangQuest">
      <Rect width={100} height={100} rx={30} fill={C.primary} />
      <G transform="translate(50 50) scale(0.86) translate(-49 -56)">
        <Rect x={15} y={68} width={14} height={22} rx={7} fill={C.white} />
        <Rect x={35} y={54} width={14} height={36} rx={7} fill={C.white} />
        <Rect x={55} y={38} width={14} height={52} rx={7} fill={C.white} />
        <Path d={CHECK} fill="none" stroke={C.primary} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
        <Path d={CHECK} fill="none" stroke={C.white} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      </G>
    </Svg>
  );
}
