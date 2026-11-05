import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  CALC_START, codeAllowed, digitsOnly, formatResult, keypadCandidate, lookName, LOOKS, noteCandidates, press, tileLabel, withoutCode, type Calc, type Key
} from '../src/disguise/disguiseModel';
import { addCatalog, showLanguage } from '../src/i18n';

// A phone's disguise (decisions.md 171): the calculator works as a
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
  type Plugin = ((config: object) => { mods?: { android?: { manifest?: (c: object) => Promise<{ modResults: Manifest }> } } }) & { ICONS: { name: string; android: { foregroundImage: string } }[] };
  type Filter = { action?: { $: Record<string, string> }[]; data?: { $: Record<string, string> }[] };
  type Manifest = { manifest: { application: { $: Record<string, string>; activity: { $: Record<string, string>; 'intent-filter': Filter[] }[]; 'activity-alias'?: { $: Record<string, string>; 'intent-filter': Filter[] }[] }[] } };
  const plugin = createRequire(import.meta.url)('../plugins/withAndroidAppIcons.js') as Plugin;
  const declared = plugin.ICONS;

  it('are five calculators and five notepads, each an icon Android declares, with its pictures', () => {
    expect(LOOKS.filter((l) => l.kind === 'calculator')).toHaveLength(5);
    expect(LOOKS.filter((l) => l.kind === 'notes')).toHaveLength(5);
    expect(declared.map((d) => d.name)).toEqual(LOOKS.map((l) => l.icon));
    // icon.png is the iPhone's picture: no iPhone build uses it while Apple refuses the icons (decisions.md 171, amended 2026-11-03), and it stays for the day one may.
    for (const look of LOOKS) {
      for (const file of ['icon.png', 'adaptive.png', 'preview.png']) expect(existsSync(join(ROOT, 'assets/disguise', look.id, file)), `${look.id}/${file}`).toBe(true);
    }
  });

  it("are named in the language showing, from the disguise's own words (src/disguise/i18n)", () => {
    const calculator = LOOKS[0]!;
    const notes = LOOKS[5]!;
    expect([lookName(calculator), lookName(notes), lookName(null), tileLabel(calculator)]).toEqual(['Calculator', 'Notes', 'LangQuest', 'Calculator 1']);
    addCatalog('fr', JSON.parse(readFileSync(join(ROOT, 'src/i18n/fr.json'), 'utf8')) as object);
    showLanguage('fr');
    try {
      expect([lookName(calculator), tileLabel(calculator)]).toEqual(['Calculatrice', 'Calculatrice 1']);
    } finally {
      showLanguage('en');
    }
  });

  it("are named under the icon on Android and keep the app's links, after the package makes them", async () => {
    // The manifest change the plugin adds, run on a manifest with one link filter: the package's
    // step makes the ten aliases first, then the plugin's own names them and copies the link.
    const link: Filter = { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'langquestnext' } }] };
    const manifest: Manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, activity: [{ $: { 'android:name': '.MainActivity' }, 'intent-filter': [link] }] }] } };
    const run = plugin({ name: 'LangQuest Next', slug: 'langquest-next' }).mods?.android?.manifest;
    const out = await run!({ name: 'LangQuest Next', slug: 'langquest-next', modResults: manifest, modRequest: { platform: 'android', modName: 'manifest', projectRoot: ROOT, platformProjectRoot: join(ROOT, 'android'), introspect: true } });
    const aliases = out.modResults.manifest.application[0]!['activity-alias'] ?? [];
    expect(aliases.map((a) => a.$['android:name'])).toEqual(LOOKS.map((l) => `.MainActivity${l.icon}`));
    for (const alias of aliases) {
      expect(alias.$['android:label']).toBe(alias.$['android:name']!.includes('Calculator') ? '@string/disguise_calculator' : '@string/disguise_notes');
      expect(alias['intent-filter']).toContainEqual(link);
    }
  });
});
