import { CHANNELS, type ChannelLanguage } from './youtube';

/**
 * What the intake job does (server/tutorialIntake.ts, docs/tutorial-videos.md):
 * brings each film the nightly filming made on GitHub into R2 and onto the
 * ops dashboard, with the files and the database given in so a test can
 * play GitHub and the Worker.
 *
 * The filming runs in GitHub Actions with no production key (decisions.md
 * 141): it keeps each video's newest film as an asset of the repository's
 * `tutorials` release, listed in that language's manifest. The job reads
 * the manifests, and for each film R2 does not have yet it downloads the
 * film, checks its bytes against the hash the manifest names, and puts it
 * through the Worker, which checks them again. Then `ops_tutorial_made`
 * lists it, once. Reading a manifest again changes nothing.
 */

/** Where the filming keeps its films and manifests: a public release, read without a key. */
export const TUTORIALS_RELEASE = 'https://github.com/genesis-ai-dev/langquest-next/releases/download/tutorials';
/** The release's tag, for the workflow's `gh release` calls. */
export const TUTORIALS_TAG = 'tutorials';

/** A language's manifest, as a release asset. */
export const manifestName = (language: string) => `manifest-${language}.json`;
/** A film, as a release asset: its hash in the name, so a newer film never takes an older one's name. */
export const filmName = (language: string, tutorial: string, sha256: string) => `${language}.${tutorial}.${sha256.slice(0, 16)}.mp4`;

/**
 * A film the frame check held (e2e/tutorials/nightly.ts), as a release asset: it is never in a manifest, so it never
 * goes to YouTube; the intake brings it into R2 only so the ops dashboard can play it at the problem's time.
 */
export const heldFilmName = (language: string, tutorial: string, sha256: string) => `held.${language}.${tutorial}.${sha256.slice(0, 16)}.mp4`;
/** A still of a held film that the frame check found wrong, as a release asset. */
export const heldStillName = (language: string, sha256: string) => `held.${language}.${sha256.slice(0, 16)}.jpg`;
/** The release assets of a language's held films and stills start with this. */
export const heldPrefix = (language: string) => `held.${language}.`;

/** A still the frame check found wrong in a held film: when, what was said, the picture, and each problem with its box. */
export interface HeldStill {
  /** Seconds into the film. */
  t: number;
  says: string;
  /** Its name where the dashboard reads it: its bytes' SHA-256, then .jpg (/api/tutorial-pictures/). */
  picture: string;
  bytes: number;
  problems: string[];
  /** For each problem, [left, top, width, height] as parts of the still (0 to 1), or null when the check gave none. */
  boxes: ([number, number, number, number] | null)[];
}
/** A film the frame check held, in status-<language>.json: the film itself and the stills it found wrong. */
export interface HeldFilm { sha256: string; bytes: number; stills: HeldStill[] }

const PICTURE = /^[0-9a-f]{64}\.jpg$/;
/** The held films a status-<language>.json names, those that read right (each with its video), for the intake. */
export function heldFilmsOf(json: unknown): { tutorial: string; held: HeldFilm }[] {
  const videos = (json as { videos?: unknown } | null)?.videos;
  if (!Array.isArray(videos)) return [];
  return videos.flatMap((v: { tutorial?: unknown; heldFilm?: Partial<HeldFilm> }) => {
    const h = v?.heldFilm;
    if (typeof v?.tutorial !== 'string' || !TUTORIAL.test(v.tutorial) || !h || typeof h.sha256 !== 'string' || !SHA256.test(h.sha256)
      || !whole(h.bytes, 1, FILM_MAX_BYTES) || !Array.isArray(h.stills)) return [];
    const stills = h.stills.filter((s) => s && typeof s.picture === 'string' && PICTURE.test(s.picture) && whole(s.bytes, 1, 3 * 1024 * 1024));
    return [{ tutorial: v.tutorial, held: { sha256: h.sha256, bytes: h.bytes, stills } as HeldFilm }];
  });
}

/** One film in a manifest: its file, and what YouTube shows, in the manifest's language. */
export interface Film {
  tutorial: string;
  sha256: string;
  bytes: number;
  seconds: number;
  title: string;
  description: string;
  /** Its playlist, by title: who it is for (Translators, Reviewers...). */
  playlist: string;
  /** Its place among the language's videos, the plan's order. */
  position: number;
  /** The film's screens and words as text, hashed: what the filming compares to see a video changed. */
  look: string;
  /** How it was framed and described (e2e/tutorials/playlists.ts FRAME); none before films were wide (decisions.md 191). */
  frame?: string;
  // Why it was filmed and what from (e2e/tutorials/why.ts, decisions.md 183 amended 2026-11-13); none on films
  // from before. The intake does not read them: they tell the filming's next night, and people, what changed a video.
  /** The commit of main it was filmed from. */
  commit?: string;
  filmedAt?: string;
  /** Its script as said in the manifest's language, hashed (why.ts `scriptOf`). */
  script?: string;
  /** Each step's look on its own (look.ts `stepLooks`). */
  steps?: string[];
  /** What made it (why.ts `Cause`): no film yet, its script, the words on its screens and the changes that did it. */
  why?: { kind: string }[];
  /** The last night it was tried and read the same: changes merged before that commit slot it no more. */
  checked?: { commit: string; at: string };
}

/**
 * Whether the intake chooses a film for YouTube itself (decisions.md 192):
 * every film made wide is; a tall one left from before (decisions.md 191),
 * whose refilm failed, would go up as a Short and waits for a person's Publish.
 */
export const chosenOnIntake = (film: Film) => film.frame !== undefined;

export interface Manifest {
  language: ChannelLanguage;
  films: Film[];
}

/** Cloudflare takes a request of up to 100 MB; a film is about 10 MB. */
export const FILM_MAX_BYTES = 100 * 1024 * 1024;

const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const plain = (text: unknown, max: number, measure: (t: string) => number = (t) => t.length): text is string =>
  typeof text === 'string' && measure(text) >= 1 && measure(text) <= max && !/[<>]/.test(text);
const whole = (n: unknown, min: number, max: number): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;

/** Why a film cannot be listed as it is (the database's checks, and YouTube's), or null when it can. */
export function filmProblem(film: unknown): string | null {
  if (typeof film !== 'object' || film === null) return 'not_a_film';
  const f = film as Record<string, unknown>;
  if (typeof f['tutorial'] !== 'string' || f['tutorial'].length > 80 || !TUTORIAL.test(f['tutorial'])) return 'tutorial';
  if (typeof f['sha256'] !== 'string' || !SHA256.test(f['sha256'])) return 'sha256';
  if (!whole(f['bytes'], 1, FILM_MAX_BYTES)) return 'bytes';
  if (!whole(f['seconds'], 1, 3600)) return 'seconds';
  if (!plain(f['title'], 100)) return 'title';
  if (!plain(f['description'], 5000, bytesOf)) return 'description';
  if (!plain(f['playlist'], 150)) return 'playlist';
  if (!whole(f['position'], 0, 10000)) return 'position';
  if (typeof f['look'] !== 'string' || !SHA256.test(f['look'])) return 'look';
  if (f['frame'] !== undefined && (typeof f['frame'] !== 'string' || !/^[a-z0-9-]{1,20}$/.test(f['frame']))) return 'frame';
  return null;
}

/** A manifest read from the release: the films that can be listed, and a count of those that cannot. */
export function readManifest(language: ChannelLanguage, json: unknown): { films: Film[]; refused: number } {
  const films = (json as { language?: unknown; films?: unknown } | null)?.films;
  if ((json as { language?: unknown } | null)?.language !== language || !Array.isArray(films)) return { films: [], refused: 1 };
  const good = films.filter((f) => filmProblem(f) === null) as Film[];
  return { films: good, refused: films.length - good.length };
}

export interface IntakeDeps {
  /** A language's manifest as JSON, or null when the filming has made none in it yet. */
  manifest(language: ChannelLanguage): Promise<unknown>;
  /** Whether R2 already has the film (the Worker's HEAD). */
  stored(language: ChannelLanguage, film: Pick<Film, 'tutorial' | 'sha256'>): Promise<boolean>;
  /** The film's bytes from the release. */
  download(language: ChannelLanguage, film: Film): Promise<Uint8Array<ArrayBuffer>>;
  /** Into R2 through the Worker, which refuses bytes that are not the hash. */
  put(language: ChannelLanguage, film: Pick<Film, 'tutorial' | 'sha256'>, bytes: Uint8Array): Promise<void>;
  /** `ops_tutorial_made`: true when it is new to the dashboard. */
  made(language: ChannelLanguage, film: Film): Promise<boolean>;
  /** The run was asked to stop (SIGTERM): start nothing new. */
  stopping(): boolean;
  /** A pause before the one try again after the server failed (serverFailed). */
  wait(): Promise<void>;
  /**
   * The films the frame check held and their wrong stills (status-<language>.json `heldFilm`), for the ops
   * dashboard's card: each is brought into R2 like a film, but never listed, so never put on YouTube.
   */
  held?: {
    /** A language's status-<language>.json, or null when it has none. */
    status(language: ChannelLanguage): Promise<unknown>;
    /** A release asset's bytes, by its name. */
    asset(name: string): Promise<Uint8Array<ArrayBuffer>>;
    /** Whether R2 already has the picture (`<sha256>.jpg`). */
    storedPicture(name: string): Promise<boolean>;
    putPicture(name: string, bytes: Uint8Array): Promise<void>;
  };
}

/**
 * The Worker or R2 answered 5xx (tutorialIntake.ts marks it): the server is in trouble, not the film.
 * The intake tries such a step once again after a pause; when it fails again, the run stops, and the next
 * run brings the rest. Before, a run went on through every film: 263 failed requests in 3 minutes (LAN-325).
 */
export const serverFailed = (e: unknown) => e instanceof Error && (e as { server?: unknown }).server === true;

async function twice<T>(deps: IntakeDeps, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (!serverFailed(e)) throw e;
    await deps.wait();
    return step();
  }
}

export interface IntakeReport {
  languages: number;
  films: number;
  /** Downloaded and put in R2 by this run. */
  brought: number;
  /** Listed on the dashboard by this run. */
  listed: number;
  failed: number;
  /** The first failure's code, for the job run. */
  firstError: string | null;
  /** The run stopped early: the server failed twice in a row (serverFailed). */
  stopped?: boolean;
  /** Held films and stills brought into R2 by this run, for the dashboard. */
  held?: number;
}

/** A code for the job run, from anything thrown. */
export const intakeCode = (e: unknown) => (e instanceof Error ? e.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) || 'Error' : 'unknown');

const named = (name: string, message = name) => Object.assign(new Error(message), { name });

async function hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every language's manifest, in turn; each film R2 lacks is brought, and each is listed once. */
export async function takeInFilms(deps: IntakeDeps, report: IntakeReport): Promise<IntakeReport> {
  const fail = (e: unknown) => {
    report.failed += 1;
    report.firstError ??= intakeCode(e);
  };
  languages: for (const language of Object.keys(CHANNELS) as ChannelLanguage[]) {
    if (deps.stopping()) break;
    let json: unknown;
    try {
      json = await deps.manifest(language);
    } catch (e) {
      fail(e);
      continue;
    }
    if (json === null) continue;
    report.languages += 1;
    const { films, refused } = readManifest(language, json);
    for (let i = 0; i < refused; i += 1) fail(named('manifest_entry'));
    for (const film of films) {
      if (deps.stopping()) break;
      report.films += 1;
      try {
        if (!(await twice(deps, () => deps.stored(language, film)))) {
          const bytes = await deps.download(language, film);
          if (bytes.length !== film.bytes || (await hex(bytes)) !== film.sha256) throw named('film_digest');
          await twice(deps, () => deps.put(language, film, bytes));
          report.brought += 1;
        }
        if (await deps.made(language, film)) report.listed += 1;
      } catch (e) {
        fail(e);
        if (serverFailed(e)) {
          report.stopped = true;
          break languages;
        }
      }
    }
    if (deps.held && !(await takeInHeld(deps, deps.held, language, fail))) {
      report.stopped = true;
      break;
    }
  }
  return report;

  /** A language's held films and stills that R2 lacks; false when the server failed twice and the run must stop. */
  async function takeInHeld(deps: IntakeDeps, held: NonNullable<IntakeDeps['held']>, language: ChannelLanguage, fail: (e: unknown) => void): Promise<boolean> {
    let json: unknown;
    try {
      json = await held.status(language);
    } catch (e) {
      fail(e);
      return true;
    }
    for (const { tutorial, held: film } of heldFilmsOf(json)) {
      if (deps.stopping()) return true;
      const steps: [() => Promise<boolean>, () => Promise<Uint8Array<ArrayBuffer>>, number, string, (b: Uint8Array) => Promise<void>][] = [
        [() => deps.stored(language, { tutorial, sha256: film.sha256 }), () => held.asset(heldFilmName(language, tutorial, film.sha256)), film.bytes, film.sha256,
          (b) => deps.put(language, { tutorial, sha256: film.sha256 }, b)],
        ...film.stills.map((s) => [() => held.storedPicture(s.picture), () => held.asset(heldStillName(language, s.picture.slice(0, 64))), s.bytes, s.picture.slice(0, 64),
          (b: Uint8Array) => held.putPicture(s.picture, b)] as (typeof steps)[number])
      ];
      for (const [stored, download, size, hash, put] of steps) {
        try {
          if (await twice(deps, stored)) continue;
          const bytes = await download();
          if (bytes.length !== size || (await hex(bytes)) !== hash) throw named('held_digest');
          await twice(deps, () => put(bytes));
          report.held = (report.held ?? 0) + 1;
        } catch (e) {
          fail(e);
          if (serverFailed(e)) return false;
        }
      }
    }
    return true;
  }
}
