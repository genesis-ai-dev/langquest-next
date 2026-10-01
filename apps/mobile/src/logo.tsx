import Svg, { G, Path, Rect } from 'react-native-svg';
import { C } from './theme';

/** The check's path, shared by the gap it cuts and the stroke itself (assets/logo.svg). */
const CHECK = 'M738 518 L878 652 L1124 415';

/**
 * The LangQuest mark on its black tile: three bars and a check lying over the
 * tallest one. Drawn from the same geometry as `assets/logo.svg`, so the
 * in-app logo matches the app icon. The gap is the tile colour painted under
 * the check.
 */
export function Logo(props: { size: number }) {
  const { size } = props;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="LangQuest">
      <Rect width={100} height={100} rx={30} fill={C.primary} />
      <G transform="translate(50 50) scale(0.088) translate(-780.5 -516.5)">
        <Rect x={385} y={465} width={111} height={192} rx={55.5} fill={C.white} />
        <Rect x={531} y={374} width={111} height={342} rx={55.5} fill={C.white} />
        <Rect x={677} y={273} width={113} height={487} rx={56.5} fill={C.white} />
        <Path d={CHECK} fill="none" stroke={C.primary} strokeWidth={150} strokeLinecap="round" strokeLinejoin="round" />
        <Path d={CHECK} fill="none" stroke={C.white} strokeWidth={106} strokeLinecap="round" strokeLinejoin="round" />
      </G>
    </Svg>
  );
}
