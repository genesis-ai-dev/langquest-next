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
  stored(language: ChannelLanguage, film: Film): Promise<boolean>;
  /** The film's bytes from the release. */
  download(language: ChannelLanguage, film: Film): Promise<Uint8Array<ArrayBuffer>>;
  /** Into R2 through the Worker, which refuses bytes that are not the hash. */
  put(language: ChannelLanguage, film: Film, bytes: Uint8Array): Promise<void>;
  /** `ops_tutorial_made`: true when it is new to the dashboard. */
  made(language: ChannelLanguage, film: Film): Promise<boolean>;
  /** The run was asked to stop (SIGTERM): start nothing new. */
  stopping(): boolean;
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
  for (const language of Object.keys(CHANNELS) as ChannelLanguage[]) {
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
        if (!(await deps.stored(language, film))) {
          const bytes = await deps.download(language, film);
          if (bytes.length !== film.bytes || (await hex(bytes)) !== film.sha256) throw named('film_digest');
          await deps.put(language, film, bytes);
          report.brought += 1;
        }
        if (await deps.made(language, film)) report.listed += 1;
      } catch (e) {
        fail(e);
      }
    }
  }
  return report;
}
