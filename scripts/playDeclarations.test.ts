import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DIAG_CONTEXT, DIAG_SCHEMA } from '@langquest-next/sync';
import { NEARBY_DIAG_SCHEMA } from '@langquest-next/sync/nearby';

/**
 * What we told Google Play (docs/play-store-declarations.md, decisions.md 49)
 * must stay true. The inputs that decide what the Android app asks
 * permission for, which SDKs it ships and what diagnostics it sends are held
 * to the facts block in that file; a change to any of them fails here until
 * someone has checked the Play Console answers and updated the file.
 */

const DOC = 'docs/play-store-declarations.md';
const HOW = `Play Store declarations may be out of date. Check the Play Console answers this change affects, update ${DOC} (its tables and its play-store-facts block), and tell the developer which answers changed.`;

interface Facts {
  package: string;
  appName: string;
  androidPermissions: string[];
  blockedPermissions: string[];
  /** Permissions the app's own native modules declare in their manifests, with the attributes that limit them. */
  modulePermissions: string[];
  /** Hardware features they declare, and whether a phone needs them to install the app. */
  moduleFeatures: string[];
  plugins: string[];
  mobileDependencies: string[];
  diagnostics: { context: string[]; kinds: Record<string, string[]> };
}

function declared(): Facts {
  const block = /```json play-store-facts\n([\s\S]*?)\n```/.exec(readFileSync(DOC, 'utf8'))?.[1];
  if (!block) throw new Error(`${DOC} has no play-store-facts block`);
  return JSON.parse(block) as Facts;
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/**
 * Every `uses-permission` and `uses-feature` in apps/mobile/modules/<module>/android/src/main/AndroidManifest.xml.
 * They merge into the app's manifest as app.json's do (autolinking finds each module), so they
 * count as the app's permissions: a module manifest is where attributes app.json cannot say
 * live (docs/nearby-sync-plan.md section 9).
 */
function moduleManifests(): { permissions: string[]; features: string[] } {
  const permissions: string[] = [];
  const features: string[] = [];
  const dir = 'apps/mobile/modules';
  for (const mod of readdirSync(dir)) {
    const path = `${dir}/${mod}/android/src/main/AndroidManifest.xml`;
    if (!existsSync(path)) continue;
    const xml = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const attr = (tag: string, name: string) => new RegExp(`android:${name}="([^"]+)"`).exec(tag)?.[1];
    for (const [tag] of xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
      const limits = ['maxSdkVersion', 'usesPermissionFlags'].flatMap((n) => (attr(tag, n) ? [`${n}=${attr(tag, n)}`] : []));
      permissions.push([attr(tag, 'name'), ...limits].join(' '));
    }
    for (const [tag] of xml.matchAll(/<uses-feature\b[^>]*>/g)) features.push(`${attr(tag, 'name')} required=${attr(tag, 'required') ?? 'true'}`);
  }
  return { permissions: sorted(permissions), features: sorted(features) };
}

function actual(): Facts {
  const app = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8')).expo;
  const pkg = JSON.parse(readFileSync('apps/mobile/package.json', 'utf8'));
  const plugins = (app.plugins ?? []).map((p: string | [string, Record<string, unknown>]) => {
    if (typeof p === 'string') return p;
    const options = Object.fromEntries(Object.entries(p[1] ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    return `${p[0]} ${JSON.stringify(options)}`;
  });
  // Android's `nearby` kind sits in the nearby entry, and phones send it as they send the rest.
  const kinds = Object.fromEntries(Object.entries({ ...DIAG_SCHEMA, ...NEARBY_DIAG_SCHEMA }).map(([kind, s]) =>
    [kind, sorted([...s.n, ...Object.keys(s.t)])]));
  const modules = moduleManifests();
  return {
    package: app.android.package,
    appName: app.name,
    androidPermissions: sorted(app.android.permissions ?? []),
    blockedPermissions: sorted(app.android.blockedPermissions ?? []),
    modulePermissions: modules.permissions,
    moduleFeatures: modules.features,
    plugins: sorted(plugins),
    mobileDependencies: sorted(Object.keys(pkg.dependencies ?? {})),
    diagnostics: { context: sorted(DIAG_CONTEXT), kinds }
  };
}

describe('Play Store declarations', () => {
  const doc = declared();
  const code = actual();

  it('name the same app', () => {
    expect(code.package, HOW).toBe(doc.package);
    expect(code.appName, HOW).toBe(doc.appName);
  });

  it('cover every Android permission and plugin', () => {
    expect(code.androidPermissions, HOW).toEqual(sorted(doc.androidPermissions));
    expect(code.blockedPermissions, HOW).toEqual(sorted(doc.blockedPermissions));
    expect(code.plugins, HOW).toEqual(sorted(doc.plugins));
  });

  it('cover every permission and feature the app\'s own native modules declare', () => {
    expect(code.modulePermissions, HOW).toEqual(sorted(doc.modulePermissions ?? []));
    expect(code.moduleFeatures, HOW).toEqual(sorted(doc.moduleFeatures ?? []));
    // A feature a phone must have would hide the app from every phone without it, whoever has the feature turned on.
    for (const f of code.moduleFeatures) expect(f, HOW).toMatch(/ required=false$/);
  });

  it('cover every SDK the app ships (an SDK can collect data on its own)', () => {
    expect(code.mobileDependencies, HOW).toEqual(sorted(doc.mobileDependencies));
  });

  it('cover everything diagnostics send', () => {
    expect(code.diagnostics.context, HOW).toEqual(sorted(doc.diagnostics.context));
    const kinds = Object.fromEntries(Object.entries(doc.diagnostics.kinds).map(([k, v]) => [k, sorted(v)]));
    expect(code.diagnostics.kinds, HOW).toEqual(kinds);
  });
});
