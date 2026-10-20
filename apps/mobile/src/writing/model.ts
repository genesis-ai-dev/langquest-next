// Writing beside recording (decisions.md 147): what a passage needs to know
// about writing on every visit, pure so it is tested: what the language
// leads with, what a making step works from, and what a check reads. The
// writing boxes and reading verse by verse are in boxesModel.ts, which loads
// with the screens that write or read (decisions.md 123).
import {
  madeVersionOf, mediaAllowed, versionMedium,
  type KindDef, type LanguageState, type MadeView, type MakesSpec, type Medium, type PassageState, type Version
} from '@langquest-next/core';

// ---- what a passage leads with, and what a step works from -------------------------------

/** Recording or writing, whichever the language leads with. */
export function leadMedium(state: LanguageState): Medium {
  const m = mediaAllowed(state);
  return m.first === 'writing' && m.writing ? 'writing' : 'recording';
}

/** The other one, when the language allows both. */
export function otherMedium(state: LanguageState): Medium | null {
  const m = mediaAllowed(state);
  if (!m.recording || !m.writing) return null;
  return leadMedium(state) === 'writing' ? 'recording' : 'writing';
}

export type MakingSource =
  | { kind: 'version'; version: Version }
  | { kind: 'made'; made: MadeView };

/**
 * What a making step turns: what its earlier step made from the latest
 * version, else the latest version. Null when there is nothing yet.
 */
export function makingSource(p: PassageState, makes: MakesSpec): MakingSource | null {
  const latest = p.latest;
  if (!latest) return null;
  if (makes.fromKindId) {
    const made = [...p.made].reverse().find((m) => m.kindId === makes.fromKindId);
    return made ? { kind: 'made', made } : null;
  }
  return { kind: 'version', version: latest };
}

/** What the source is in. */
export function sourceMedium(src: MakingSource): Medium {
  return src.kind === 'version' ? versionMedium(src.version) : src.made.medium;
}

/** The language a step makes in, as a code, when not the team's own. */
export function makingLanguage(makes: MakesSpec, referenceLanguage: string): string | undefined {
  return makes.language === 'other' ? makes.otherLanguage ?? referenceLanguage : undefined;
}

/** Is this kind a step that makes something (new, `makes`) or the shipped back translation (`produces`)? */
export function isMaking(kind: KindDef): boolean {
  return !!kind.makes || !!kind.produces;
}

/**
 * What a check reads of a version (decisions.md 147): what its earlier
 * making step made from that version, when the check reads one, else the
 * version itself.
 */
export function readsFor(p: PassageState, kind: KindDef, version: Version): { medium: Medium; parts: string[]; made?: MadeView } {
  if (kind.looksAt) {
    const made = [...p.made].reverse().find((m) => m.kindId === kind.looksAt && madeVersionOf(p, m) === version.takeId);
    if (made) return { medium: made.medium, parts: made.parts.map((c) => c.hash), made };
  }
  return { medium: versionMedium(version), parts: version.cardHashes };
}
