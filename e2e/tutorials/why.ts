// Why a tutorial video is filmed again, and what waits for it
// (docs/tutorial-videos.md "Why a video is filmed again", decisions.md 183
// amended 2026-11-13). Each film in a language's manifest keeps the commit of
// main it was filmed from, its script as it was said, and each step's look;
// so each night the filming can say what made a video change:
//
// - its script: what it says (in the film's language), does or lights, from
//   its own file and the lines it says (a fix asked for in a comment comes in
//   this way, as a pull request that changes the script);
// - its words on a screen: a step's screen reads differently (look.ts), with
//   the changes merged since the film that touched that screen's own code
//   (screens.ts), or the code screens share when no screen's own changed;
// - or no film yet, a film framed as films no longer are, or a person asking.
//
// A change merged into main that touched the own code of a screen a video
// shows slots that video: the night's try then says whether its words
// changed (filmed again) or not (the slot is cleared). Pure: git and the
// files are read by nightly.ts.
import { createHash } from 'node:crypto';
import type { ScreenCode } from './screens';

/** A change merged into main: its commit, the pull request it came from, and what it touched. */
export interface Change {
  sha: string;
  pr: number | null;
  subject: string;
  files: string[];
}

/** A change as a cause names it. */
export type Ref = Omit<Change, 'files'>;

export type Cause =
  /** The video had no film in this language. */
  | { kind: 'new' }
  /** A person named it when running the filming by hand. */
  | { kind: 'asked' }
  /** Its film was framed or described as films no longer are (playlists.ts FRAME). */
  | { kind: 'frame' }
  /** What it says, does or lights changed, with the changes to its script since its film. */
  | { kind: 'script'; changes: Ref[] }
  /**
   * The words on some of its steps' screens changed (steps from 1), with the changes since its film
   * that touched those screens' own code, or, `shared`, the code screens share when none did.
   */
  | { kind: 'screen'; steps: number[]; screens: string[]; changes: Ref[]; shared?: true };

/** A slot: a change since the video's last check that touched the own code of screens it shows. */
export interface Slot extends Ref {
  screens: string[];
}

/** At most this many changes are named for one cause; the rest are counted in the run's log. */
export const NAMED = 10;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * A video's script as filmed in a language: its own file's text and every line it says, as said.
 * A helper's change that alters what is said changes it; one that only moves the finger is seen by the look.
 */
export function scriptOf(source: string, said: readonly (string | undefined)[], speech: readonly string[] = []): string {
  return sha256(JSON.stringify({ source, said, speech }));
}

/** The pull request a merge into main came from, from its subject. */
export function prOf(subject: string): number | null {
  const pr = /^Merge pull request #(\d+)\b/.exec(subject) ?? /\(#(\d+)\)\s*$/.exec(subject);
  return pr ? Number(pr[1]) : null;
}

/**
 * The changes in `git log --first-parent --diff-merges=first-parent --name-only --format=%x00%H%x09%s <film>..HEAD`,
 * newest first: each merge into main with the files it changed on main.
 */
export function readLog(log: string): Change[] {
  return log.split('\0').filter((chunk) => chunk.trim()).map((chunk) => {
    const [head = '', ...files] = chunk.split('\n');
    const [sha = '', ...subject] = head.split('\t');
    return { sha, pr: prOf(subject.join('\t')), subject: subject.join('\t'), files: files.map((f) => f.trim()).filter(Boolean) };
  }).filter((c) => /^[0-9a-f]{40}$/.test(c.sha));
}

const ref = ({ sha, pr, subject }: Change): Ref => ({ sha, pr, subject });

/** The changes that touched any of these files, newest first, at most NAMED. */
export function touching(changes: readonly Change[], files: ReadonlySet<string>): Ref[] {
  return changes.filter((c) => c.files.some((f) => files.has(f))).slice(0, NAMED).map(ref);
}

/** Steps (from 1) whose look differs; every step when the film kept no step looks or had another number of steps. */
export function changedSteps(film: readonly string[] | undefined, now: readonly string[]): number[] {
  const all = now.map((_, i) => i + 1);
  if (!film || film.length !== now.length) return all;
  return all.filter((n) => film[n - 1] !== now[n - 1]);
}

const ownCode = (code: ScreenCode, screens: Iterable<string>) => new Set([...screens].flatMap((s) => [...(code.own.get(s) ?? [])]));

/** The changes since the video's last check that touched the own code of the screens it shows, each with those screens. */
export function slotsOf(screens: readonly string[], changes: readonly Change[] | null, code: ScreenCode): Slot[] {
  if (!changes) return [];
  const shown = [...new Set(screens)];
  return changes.flatMap((c) => {
    const hit = shown.filter((s) => c.files.some((f) => code.own.get(s)?.has(f)));
    return hit.length ? [{ ...ref(c), screens: hit }] : [];
  }).slice(0, NAMED);
}

export interface Tonight {
  /** What the release keeps for the video in this language, or nothing. */
  film?: { look: string; frame?: string; script?: string; steps?: string[] };
  /** Named by hand: filmed whatever its look. */
  named: boolean;
  /** How films are framed now (playlists.ts FRAME). */
  frame: string;
  /** Tonight's try: the look, its steps' looks and the script, or null when it could not be tried. */
  tried: { look: string; steps: string[] } | null;
  script: string;
  /** The screen each step is on. */
  screens: readonly string[];
  /** The video's own files: its script, the lines it says. */
  scriptFiles: ReadonlySet<string>;
  /** Changes merged into main since its film, newest first, or null when its film names no commit this history has. */
  changes: readonly Change[] | null;
  code: ScreenCode;
}

/** Why a video is filmed tonight: nothing when it is not. */
export function whyFilm(t: Tonight): Cause[] {
  const why: Cause[] = [];
  if (!t.film) return [{ kind: 'new' }];
  if (t.named) why.push({ kind: 'asked' });
  if (t.film.frame !== t.frame) why.push({ kind: 'frame' });
  if (t.film.script !== undefined && t.film.script !== t.script) why.push({ kind: 'script', changes: touching(t.changes ?? [], t.scriptFiles) });
  if (t.tried && t.tried.look !== t.film.look) {
    const steps = changedSteps(t.film.steps, t.tried.steps);
    const screens = [...new Set(steps.map((n) => t.screens[n - 1]).filter((s): s is string => !!s))];
    const own = touching(t.changes ?? [], ownCode(t.code, screens));
    why.push(own.length || !t.changes
      ? { kind: 'screen', steps, screens, changes: own }
      : { kind: 'screen', steps, screens, changes: touching(t.changes, t.code.shared), shared: true });
  }
  return why;
}

const link = (r: Ref) => (r.pr ? `#${r.pr}` : r.sha.slice(0, 7));

/** A cause in a line, for the run's log and summary. */
export function causeLine(c: Cause): string {
  const by = (changes: Ref[]) => (changes.length ? ` (${changes.map(link).join(', ')})` : '');
  switch (c.kind) {
    case 'new': return 'no film yet';
    case 'asked': return 'named by hand';
    case 'frame': return 'framed as films no longer are';
    case 'script': return `its script changed${by(c.changes)}`;
    case 'screen': return `words changed on step${c.steps.length === 1 ? '' : 's'} ${c.steps.join(', ')} (${c.screens.join(', ')})${c.shared ? ', shared code' : ''}${by(c.changes)}`;
  }
}
