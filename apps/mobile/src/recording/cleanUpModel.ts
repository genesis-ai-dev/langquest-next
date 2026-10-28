// Clean up on the recording screen (decision 177): which parts it is
// offered for, the slider, the bars of a part as recorded and as it would
// sound, and the button's words. Pure; the cleaning itself is the
// microphone module's (deepFilter.ts), and useCleanUp.ts runs it.
import { mayCleanUp, type CleanUpChoice, type LanguageState } from '@langquest-next/core';
import { barsFromAmps } from '../audio/barsModel';
import { t } from '../i18n';

/** What a note says cleaned the part (v1.CardCleanUpSet `tool`): DeepFilterNet 3. */
export const CLEAN_UP_TOOL = 'dfn3';

/** Where the slider starts: a third of the way, 12 dB (Caleb, 2026-10-28). */
export const SLIDER_START = 1 / 3;

/**
 * The most the slider's place lets Clean up take out, in dB: 6 at Less,
 * doubling every third of the way, and no limit at More (null). Rounded to
 * a whole dB, as the note keeps it.
 */
export function limitAt(place: number): number | null {
  const p = Math.min(1, Math.max(0, place));
  return p >= 1 ? null : Math.round(6 * 8 ** p);
}

/** The slider's place for a limit (`limitAt` the other way). */
export function placeOf(limitDb: number | null): number {
  return limitDb === null ? 1 : Math.min(1, Math.max(0, Math.log(limitDb / 6) / Math.log(8)));
}

/**
 * How much of the part as recorded the sound keeps beside the cleaned one,
 * as deepFilter.ts mixGain: at most `limitDb` taken out, so the noise left
 * is 10^(−limitDb/20) of what it was; none with no limit.
 */
export function gainOf(limitDb: number | null): number {
  return limitDb === null ? 0 : 10 ** (-Math.abs(limitDb) / 20);
}

/**
 * What the module measured of a cleaned part (MicrophoneEnergyModule.ts
 * CleanedPart): in each slice its bars are drawn in, how many samples and
 * the sums of x*x, x*y and y*y, x the part as recorded and y the cleaned sound.
 */
export interface CleanSums { n: number[]; xx: number[]; xy: number[]; yy: number[] }

export function cleanSums(sums: readonly (readonly number[])[]): CleanSums | null {
  const [n, xx, xy, yy] = sums;
  if (!n || !xx || !xy || !yy || ![xx, xy, yy].every((s) => s.length === n.length)) return null;
  return { n: [...n], xx: [...xx], xy: [...xy], yy: [...yy] };
}

/**
 * The two rows' bars: each bar's height (as barsModel.ts draws a part), and
 * the height of its voice, the cleaned sound's share; the rest of the bar
 * is the noise. `limitDb` undefined: the part as recorded. Both rows are
 * scaled to the part as recorded, so a bar that lost its noise is shorter.
 */
export function toneBars(s: CleanSums, limitDb?: number | null): { bars: number[]; voice: number[] } {
  const g = limitDb === undefined ? 1 : gainOf(limitDb);
  const amp = (e: number, n: number) => (n > 0 ? Math.sqrt(Math.max(0, e) / n) : 0);
  const original = s.n.map((n, k) => amp(s.xx[k]!, n));
  const noise = s.n.map((_, k) => Math.max(0, s.xx[k]! - 2 * s.xy[k]! + s.yy[k]!));
  // The sound is y + g(x − y): the cleaned sound with g of the noise taken out left in.
  const sound = s.n.map((n, k) => amp(s.yy[k]! + 2 * g * (s.xy[k]! - s.yy[k]!) + g * g * noise[k]!, n));
  const bars = barsFromAmps(sound, original);
  const voice = bars.map((h, k) => {
    const v = Math.max(0, s.yy[k]!), left = g * g * noise[k]!;
    return v + left > 0 ? h * (v / (v + left)) : h;
  });
  return { bars, voice };
}

/** The bars a part's chosen sound is drawn with in its row (barsStore.ts). */
export function mixBars(s: CleanSums, limitDb: number | null): number[] {
  return toneBars(s, limitDb).bars;
}

/**
 * The parts Clean up is offered for (decisions.md 176 `mayCleanUp`), by
 * where they are in the list, and those it is not, because they were
 * cleaned before.
 */
export function cleanUpOffer(state: LanguageState, unitId: string, list: readonly string[]): { offered: number[]; before: number[] } {
  const offered: number[] = [];
  const before: number[] = [];
  list.forEach((hash, i) => (mayCleanUp(state, unitId, hash) ? offered : before).push(i));
  return { offered, before };
}

export type CleanUpPick = CleanUpChoice['use'];

/** The sheet's button: "Use cleaned", or for several parts "Use 3 cleaned, 1 original". */
export function buttonLabel(picks: readonly CleanUpPick[]): string {
  const cleaned = picks.filter((p) => p === 'cleaned').length;
  const original = picks.length - cleaned;
  if (picks.length === 1) return cleaned ? t('recording.cleanUp.useCleaned') : t('recording.cleanUp.useOriginal');
  if (!original) return t('recording.cleanUp.useAllCleaned', { count: cleaned });
  if (!cleaned) return t('recording.cleanUp.useAllOriginal', { count: original });
  return t('recording.cleanUp.useBoth', { cleaned, original });
}
