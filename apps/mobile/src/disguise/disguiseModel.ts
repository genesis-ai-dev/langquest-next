// What disguise means (decisions.md 167), with no platform: the looks a
// phone may take, the codes that open it, and the working calculator that
// stands in front of the app. disguise.ts keeps the choice; faces.tsx draws it.
import { t } from '../i18n';

/** A calculator opens with its keypad, a notepad with a line of its own. */
export type DisguiseKind = 'calculator' | 'notes';

export interface Look {
  /** Also the folder of its pictures under assets/disguise. */
  id: string;
  kind: DisguiseKind;
  /** The app icon's name in app.json (expo-alternate-app-icons): the id in PascalCase. */
  icon: string;
}

const pascal = (id: string) => id.replace(/^\w/, (c) => c.toUpperCase());
const looks = (kind: DisguiseKind) => [1, 2, 3, 4, 5].map((n): Look => ({ id: `${kind}${n}`, kind, icon: pascal(`${kind}${n}`) }));

/** Five calculators and five notepads, as the old app had (v2, July 2026), so one can look like the phone's own. */
export const LOOKS: readonly Look[] = [...looks('calculator'), ...looks('notes')];

export function lookById(id: string | null): Look | null {
  return LOOKS.find((l) => l.id === id) ?? null;
}

/** The name a look goes by, as Android's home screen shows it under the icon; LangQuest with none. */
export function lookName(look: Look | null): string {
  if (!look) return t('disguise.langquest');
  return look.kind === 'calculator' ? t('native.calculator') : t('native.notes');
}

/** One look among the five of its kind, for a screen reader: "Calculator 3". */
export function tileLabel(look: Look): string {
  const n = Number(look.id.replace(/\D/g, ''));
  return look.kind === 'calculator' ? t('disguise.calculatorN', { n }) : t('disguise.notesN', { n });
}

/** A code is 4 to 12 digits: typed on a calculator's keys, or on a line of a note. */
export const CODE_MIN = 4;
export const CODE_MAX = 12;

export function digitsOnly(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, CODE_MAX);
}

export function codeAllowed(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= CODE_MIN && code.length <= CODE_MAX;
}

/**
 * What to check after a key: the last `length` digits typed, so sums done
 * first never stand in the way, and the app opens on the code's last digit
 * with no = to press (a key that a person could forget, v2).
 */
export function keypadCandidate(typed: string, length: number): string | null {
  return typed.length >= length ? typed.slice(-length) : null;
}

/** Lines of a note that could be the code: it opens on a line of its own. */
export function noteCandidates(text: string, length: number): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length === length && /^\d+$/.test(line));
}

/** The note as it is kept once it has opened the app: without the line that held the code. */
export function withoutCode(text: string, code: string): string {
  return text.split(/\r?\n/).filter((line) => line.trim() !== code).join('\n');
}

// ---- the calculator -------------------------------------------------------------------

export type Op = '+' | '−' | '×' | '÷';
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type Key = Digit | '.' | Op | '=' | 'AC' | '⌫' | '%';

export function isDigit(key: Key): key is Digit {
  return key.length === 1 && key >= '0' && key <= '9';
}

export interface Calc {
  /** What the display shows. */
  display: string;
  /** The number before the operator, waiting for the next. */
  held: number | null;
  op: Op | null;
  /** The next digit starts a new number. */
  fresh: boolean;
  /** Every digit typed since AC, for the code (⌫ takes the last one back). */
  typed: string;
}

export const CALC_START: Calc = { display: '0', held: null, op: null, fresh: true, typed: '' };

/** Digits a display holds before it stops taking more. */
const DISPLAY_DIGITS = 12;

export function press(c: Calc, key: Key): Calc {
  if (isDigit(key)) {
    const typed = (c.typed + key).slice(-CODE_MAX);
    if (c.fresh || c.display === '0') return { ...c, display: key, fresh: false, typed };
    if (c.display.replace(/[^0-9]/g, '').length >= DISPLAY_DIGITS) return { ...c, typed };
    return { ...c, display: c.display + key, typed };
  }
  switch (key) {
    case '.':
      if (c.fresh) return { ...c, display: '0.', fresh: false };
      return c.display.includes('.') ? c : { ...c, display: `${c.display}.` };
    case 'AC':
      return CALC_START;
    case '⌫': {
      const typed = c.typed.slice(0, -1);
      if (c.fresh) return { ...c, typed };
      const display = c.display.length <= 1 || (c.display.length === 2 && c.display.startsWith('-')) ? '0' : c.display.slice(0, -1);
      return { ...c, display, typed };
    }
    case '%':
      return { ...c, display: formatResult(value(c.display) / 100), fresh: true };
    case '=':
      if (c.op === null || c.held === null) return c;
      return { ...c, display: formatResult(compute(c.held, value(c.display), c.op)), held: null, op: null, fresh: true };
    default: {
      // An operator. A second in a row only changes which one.
      if (c.fresh && c.op !== null) return { ...c, op: key };
      const held = c.held !== null && c.op !== null ? compute(c.held, value(c.display), c.op) : value(c.display);
      return { ...c, held, op: key, fresh: true, display: formatResult(held) };
    }
  }
}

function value(display: string): number {
  const n = Number.parseFloat(display);
  return Number.isFinite(n) ? n : 0;
}

export function compute(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '−': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? Number.NaN : a / b;
  }
}

/** A result as a calculator shows it: no float noise, and "Error" for what has no answer. */
export function formatResult(n: number): string {
  // i18n-ignore: a calculator's own word, the same on the phone's calculator in every language
  if (!Number.isFinite(n)) return 'Error';
  const rounded = Math.round(n * 1e10) / 1e10;
  const text = String(rounded);
  return text.length > 14 ? rounded.toPrecision(9).replace(/\.?0+(e|$)/, '$1') : text;
}
