// The language explorer's globe is a committed bundle (public/languages-globe.js,
// docs/languoids.md); `npm run explorer:build` makes it from its source.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs build script, without types
import { bundleGlobe, GLOBE_FILE, worldWithCodes } from './build-explorer-globe.mjs';

describe('the explorer globe', () => {
  it('is built from its source: run npm run explorer:build after changing globe.mjs', async () => {
    expect(await bundleGlobe()).toBe(await readFile(GLOBE_FILE, 'utf8'));
  });

  it('gives every country on the map the ISO 3166-1 code region_source holds', () => {
    // Why: a click on a country opens the nation with that code.
    const codes = (worldWithCodes().objects.countries.geometries as { properties: { a2: string } }[]).map((g) => g.properties.a2);
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(codes).toContain('MW');
    expect(codes).toContain('XK');
  });
});
