import { geoEqualEarth, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';
import { useMemo } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import { countryName, numericOf } from '../countries';
import { num } from '../ui';

/**
 * Countries shaded by a count. Loaded on demand (the shapes are the only
 * heavy part of the dashboard). The count is always in the legend and in
 * each country's title, and a country too small for the map is listed below.
 */
export default function WorldMap(props: { values: { country: string; value: number }[]; unit: string; compact?: boolean }) {
  const W = 960, H = props.compact ? 420 : 500;
  const shapes = useMemo(() => {
    const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    return feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
  }, []);
  const byId = new Map(props.values.map((v) => [numericOf(v.country), v]));
  const max = Math.max(1, ...props.values.map((v) => v.value));
  const shaded = shapes.features.filter((f) => byId.has(String(f.id)));
  const projection = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]],
    shaded.length ? { type: 'FeatureCollection', features: shaded } : shapes);
  const path = geoPath(projection);
  const missing = props.values.filter((v) => !shapes.features.some((f) => String(f.id) === numericOf(v.country)));
  return (
    <figure className="chart map" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={props.values.map((v) => `${countryName(v.country)}: ${num(v.value)} ${props.unit}`).join(', ')}>
        {shapes.features.map((f, i) => {
          const v = byId.get(String(f.id));
          const d = path(f) ?? '';
          if (!v) return <path key={i} d={d} className="land" />;
          return (
            <path key={i} d={d} className="land-on" style={{ fill: 'var(--primary)', fillOpacity: 0.25 + (0.75 * v.value) / max }}>
              <title>{`${countryName(v.country)}: ${num(v.value)} ${props.unit}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="map-legend" aria-hidden="true">
        <span className="muted">{props.unit[0]!.toUpperCase() + props.unit.slice(1)} per country</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          1 <span style={{ width: 80, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 25%, transparent), var(--primary))' }} /> {num(max)}
        </span>
      </div>
      {missing.length ? (
        <p className="muted xs">Too small for the map: {missing.map((v) => `${countryName(v.country)} (${num(v.value)})`).join(', ')}.</p>
      ) : null}
    </figure>
  );
}
