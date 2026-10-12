import { geoEqualEarth, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../text';
import Svg, { Path } from 'react-native-svg';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { t } from '../i18n';
import { txt } from '../kit';
import { C, space } from '../theme';
import { countryName, numericOf } from './countries';
import { num } from './ui';

let shapesCache: FeatureCollection<Geometry, { name: string }> | null = null;
function shapes() {
  if (!shapesCache) {
    const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    shapesCache = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
  }
  return shapesCache;
}

/**
 * Countries shaded by a count (ported from the web dashboard). The count is
 * always in the words below the map and in its accessibility label, and a
 * country too small for the map is listed.
 */
/** One country's count, said with its unit. */
function spoken(unit: 'languages' | 'recordings', country: string, count: number): string {
  return unit === 'languages' ? t('reports.map.countryLanguages', { country, count }) : t('reports.map.countryRecordings', { country, count });
}

export default function WorldMap(props: { values: { country: string; value: number }[]; unit: 'languages' | 'recordings'; compact?: boolean }) {
  const [width, setWidth] = useState(0);
  const aspect = props.compact ? 420 / 960 : 500 / 960;
  const all = shapes();
  const byId = useMemo(() => new Map(props.values.map((v) => [numericOf(v.country), v])), [props.values]);
  const max = Math.max(1, ...props.values.map((v) => v.value));
  const W = width, H = Math.round(width * aspect);
  const paths = useMemo(() => {
    if (W === 0) return [];
    const shaded = all.features.filter((f) => byId.has(String(f.id)));
    const projection = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], shaded.length ? { type: 'FeatureCollection', features: shaded } : all);
    const path = geoPath(projection);
    return all.features.map((f) => ({ id: String(f.id), d: path(f) ?? '' }));
  }, [W, H, all, byId]);
  const missing = props.values.filter((v) => !all.features.some((f) => String(f.id) === numericOf(v.country)));
  return (
    <View style={{ gap: space.sm }}>
      <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ width: '100%', height: H || 200 }}
        accessible accessibilityRole="image" accessibilityLabel={props.values.map((v) => spoken(props.unit, countryName(v.country), v.value)).join(', ')}>
        {W > 0 ? (
          <Svg width={W} height={H}>
            {paths.map((p, i) => {
              const v = byId.get(p.id);
              return <Path key={i} d={p.d} fill={v ? C.primary : C.border} fillOpacity={v ? 0.25 + (0.75 * v.value) / max : 1} stroke={C.card} strokeWidth={0.5} />;
            })}
          </Svg>
        ) : null}
      </View>
      <Text style={txt.xs}>
        {props.unit === 'languages' ? t('reports.map.scaleLanguages', { min: num(1), max: num(max) }) : t('reports.map.scaleRecordings', { min: num(1), max: num(max) })}
      </Text>
      {missing.length ? (
        <Text style={txt.xs}>
          {t('reports.map.tooSmall', { list: missing.map((v) => t('reports.map.countryValue', { country: countryName(v.country), value: num(v.value) })).join(', ') })}
        </Text>
      ) : null}
    </View>
  );
}
