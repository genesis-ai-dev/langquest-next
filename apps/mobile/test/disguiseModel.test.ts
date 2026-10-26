import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CALC_START, codeAllowed, digitsOnly, formatResult, keypadCandidate, LOOKS, noteCandidates, press, withoutCode, type Calc, type Key
} from '../src/disguise/disguiseModel';

// A phone's disguise (decisions.md 170): the calculator works as a
// calculator, the code opens the app on its last digit or on a line of its
// own, and every look the picker offers is an icon the build declares.

const typeKeys = (keys: Key[], from: Calc = CALC_START) => keys.reduce(press, from);

describe('the calculator in front of the app', () => {
  it('adds, takes away, multiplies and divides', () => {
    expect(typeKeys(['1', '2', '+', '3', '0', '=']).display).toBe('42');
    expect(typeKeys(['9', '−', '1', '2', '=']).display).toBe('-3');
    expect(typeKeys(['6', '×', '7', '=']).display).toBe('42');
    expect(typeKeys(['1', '÷', '4', '=']).display).toBe('0.25');
  });

  it('chains sums and shows what is held when the next operator comes', () => {
    const c = typeKeys(['2', '+', '3', '×']);
    expect(c.display).toBe('5');
    expect(typeKeys(['4', '='], c).display).toBe('20');
  });

  it('takes a second operator in a row as a change of mind', () => {
    expect(typeKeys(['8', '+', '×', '2', '=']).display).toBe('16');
  });

  it('has no float noise, says Error for a division by nothing, and AC starts over', () => {
    expect(typeKeys(['0', '.', '1', '+', '0', '.', '2', '=']).display).toBe('0.3');
    expect(typeKeys(['5', '÷', '0', '=']).display).toBe('Error');
    expect(typeKeys(['5', '+', '5', 'AC'])).toEqual(CALC_START);
    expect(formatResult(1e20)).toBe('1e+20');
  });

  it('⌫ takes the last digit back from the display and from what counts as the code', () => {
    const c = typeKeys(['1', '2', '3', '⌫']);
    expect(c.display).toBe('12');
    expect(c.typed).toBe('12');
  });

  it('keeps every digit typed for the code, across operators and =', () => {
    const c = typeKeys(['1', '+', '2', '=', '3', '4']);
    expect(c.typed).toBe('1234');
    expect(keypadCandidate(c.typed, 4)).toBe('1234');
    expect(keypadCandidate('99' + c.typed, 4)).toBe('1234');
    expect(keypadCandidate('123', 4)).toBeNull();
  });
});

describe('codes', () => {
  it('are 4 to 12 digits', () => {
    expect(codeAllowed('123')).toBe(false);
    expect(codeAllowed('1234')).toBe(true);
    expect(codeAllowed('123456789012')).toBe(true);
    expect(codeAllowed('1234567890123')).toBe(false);
    expect(codeAllowed('12a4')).toBe(false);
    expect(digitsOnly('1 2-3a4567890123')).toBe('123456789012');
  });

  it('open the notepad on a line of their own, and the note keeps no trace of it', () => {
    const note = 'Buy rice\n  2468  \nCall Ana 2468';
    expect(noteCandidates(note, 4)).toEqual(['2468']);
    expect(noteCandidates(note, 5)).toEqual([]);
    expect(withoutCode(note, '2468')).toBe('Buy rice\nCall Ana 2468');
  });
});

describe('the looks', () => {
  const ROOT = join(import.meta.dirname, '..');
  const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { plugins: unknown[] } };
  const declared = (app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-alternate-app-icons') as [string, { name: string; ios: string; android: { foregroundImage: string } }[]])[1];

  it('are five calculators and five notepads, each an icon app.json declares, with its pictures', () => {
    expect(LOOKS.filter((l) => l.kind === 'calculator')).toHaveLength(5);
    expect(LOOKS.filter((l) => l.kind === 'notes')).toHaveLength(5);
    expect(declared.map((d) => d.name)).toEqual(LOOKS.map((l) => l.icon));
    for (const look of LOOKS) {
      for (const file of ['icon.png', 'adaptive.png', 'preview.png']) expect(existsSync(join(ROOT, 'assets/disguise', look.id, file)), `${look.id}/${file}`).toBe(true);
    }
  });

  it('come after the plugin that names them on Android, so its manifest change runs last', () => {
    const names = app.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.indexOf('./plugins/withDisguiseIcons')).toBeLessThan(names.indexOf('expo-alternate-app-icons'));
  });
});
