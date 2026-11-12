import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * react-native-screens freezes the screens under the top one with react-freeze (`freezeOnBlur`,
 * decision 119), whose 1.0.4 re-commits frozen screens without end on React 19.1 and later
 * (software-mansion/react-freeze#44): opening a passage from a book's list left a phone on a blank
 * page. Metro hands react-native-screens the app's mended `Freeze` instead (decision 250). The
 * phone flows that caught it (JRN-006, MAP-031) show the behaviour; these hold the redirect in
 * place and say when react-freeze moves on, so it can go.
 */

const require = createRequire(import.meta.url);
const APP = join(import.meta.dirname, '..');
const SHIM = join(APP, 'src/shell/freeze.tsx');

describe('the react-freeze redirect (decision 250)', () => {
  const config = require(join(APP, 'metro.config.js'));
  const asked: string[] = [];
  const context = { resolveRequest: (_c: unknown, name: string) => { asked.push(name); return { type: 'sourceFile', filePath: `/resolved/${name}` }; } };

  it("gives react-native-screens the app's Freeze for react-freeze, on every platform", () => {
    for (const platform of ['android', 'ios', 'web']) {
      expect(config.resolver.resolveRequest(context, 'react-freeze', platform)).toEqual({ type: 'sourceFile', filePath: SHIM });
    }
    expect(asked).toEqual([]);
  });

  it('resolves everything else as Metro would', () => {
    expect(config.resolver.resolveRequest(context, 'react', 'android')).toEqual({ type: 'sourceFile', filePath: '/resolved/react' });
    expect(config.resolver.resolveRequest(context, 'react-freeze/package.json', 'android')).toEqual({ type: 'sourceFile', filePath: '/resolved/react-freeze/package.json' });
  });

  it('freezes through use() on a promise of its own, never a thrown thenable', () => {
    const code = readFileSync(SHIM, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/export function Freeze\(/);
    expect(code).toMatch(/\buse\(suspension\.current\.promise\)/);
    expect(code).not.toMatch(/\bthrow\b/);
  });

  it('is still needed: react-native-screens freezes with react-freeze 1.0.4', () => {
    const screens = readFileSync(require.resolve('react-native-screens/src/components/helpers/DelayedFreeze.tsx'), 'utf8');
    expect(screens).toMatch(/from 'react-freeze'/);
    const version = require('react-freeze/package.json').version;
    expect(version, 'react-freeze has moved past 1.0.4: if it fixes software-mansion/react-freeze#44, remove src/shell/freeze.tsx and its redirect in metro.config.js (decision 250)').toBe('1.0.4');
  });
});
