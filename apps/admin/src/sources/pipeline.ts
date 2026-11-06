import { diagConnection, withDiag, type Query } from '../db';
import { jsonSecret } from '../jwt';
import { getJson, hoursAgo, ok, off, type Alert, type Section } from '../section';
import { ACTIVE_DAYS, INSTALLS_SQL, type InstallCount } from './adoption';
import { appStoreKey, appStoreToken } from './appstore';
import { githubApi } from './github';
import { googleToken } from './googleplay';

/**
 * Where every new store build and over-the-air update sits on its way to
 * people (decisions.md 157): for each platform, the stages a store build
 * goes through, with each build in the stage it is in now, and inside each
 * build the updates it takes (the pull request that made each, and how many
 * of the platform's phones run it). A new build waits in TestFlight or Play's internal testing
 * while an older one is in review, so this shows what waits and why.
 *
 * Expo says what was built and sent where; App Store Connect says where an
 * iPhone build stands; Play's tracks (read in an edit that is thrown away)
 * and Play's public page say where an Android build stands, since Google's
 * API calls a release completed before review (play-review.mjs). A store
 * whose key is missing, or that does not answer, leaves its stages to what
 * Expo knows, and says so under its lane. Who started a build is left out.
 */

/** busy: on its way; wait: waits for something; bad: needs a person; live: what people get. */
export type Tone = 'busy' | 'wait' | 'bad' | 'live';

/**
 * An over-the-air update a build takes: one published on the production
 * branch for the build's platform and runtime after the build was made. One
 * update reaches every build with that runtime, so it can show under several.
 */
export interface UpdateCard {
  id: string;
  /** The pull request whose merge published it, from the merge commit's message or GitHub; for a copy, the one on main whose change it carries. */
  pr: number | null;
  title: string | null;
  /**
   * The copy pull request that sent it to an older build, through that
   * build's release branch (decisions.md 155); null when it came from main.
   * The same pull request then shows in each build that got it: from main in
   * the newer build, as a copy in the older one.
   */
  copy: number | null;
  /** The other pull requests on main that it carries, with their titles: a copy that catches an older build up on several merges. */
  also: { pr: number; title: string | null }[];
  /** How many more it carries than `pr` and `also` name (EAS keeps only the start of a long message). */
  more: number;
  at: string;
  /** Back to the build's own code (a rollback), rather than new code. */
  rollBack: boolean;
  /** Phones active in the last week on the platform that run it, of all of them; null without the database. */
  phones: { on: number; of: number } | null;
  /** A copy not merged yet, so no phone has it: what it waits for. */
  waiting?: string;
  /** That copy needs a person: Claude could not fix its failed tests, or it has been open for hours (`COPY_HOURS`). */
  needsPerson?: boolean;
}

/** One build, in the stage it is in now. */
export interface Card {
  /** "build 51". */
  title: string;
  /** The store build number, when known. */
  build: string | null;
  /** The store version (the merge's time, app.config.js), when known. */
  version: string | null;
  /** What it is doing there, in a few words. */
  state: string;
  tone: Tone;
  /** Since when, as far as a source says. */
  at: string | null;
  /** The updates it takes, newest first (the newest is what it runs once it downloads it). */
  updates: UpdateCard[];
}

export interface Stage {
  id: string; title: string; cards: Card[];
  /** Why this stage cannot be seen now (its store is not connected): shown in place of "none", which would claim it is empty. */
  unseen?: string;
}

export interface StoreLane { id: 'ios' | 'android'; title: string; stages: Stage[]; notes: string[] }

export interface Pipeline { lanes: StoreLane[]; activeDays: number; repo: string }

// ---- what each source answers, as the pipeline uses it ------------------------------

export interface EasBuild { platform: 'ios' | 'android'; status: string; at: string; doneAt: string | null; version: string | null; build: string | null; runtime: string | null }
export interface EasSubmission { platform: 'ios' | 'android'; status: string; at: string; doneAt: string | null; track: string | null; version: string | null; build: string | null }
export interface EasUpdate { id: string; platform: 'ios' | 'android'; at: string; runtime: string | null; commit: string | null; message: string | null; rollBack: boolean }
export interface AppleVersion { version: string; state: string; at: string | null; build: string | null }
export interface AppleBuild { version: string | null; build: string | null; state: string; uploadedAt: string | null }
export interface PlayRelease { name: string | null; status: string; versionCodes: string[] }
export interface PlayTracks { internal: PlayRelease[]; production: PlayRelease[] }

export interface PipelineInputs {
  builds: EasBuild[];
  submissions: EasSubmission[];
  updates: EasUpdate[];
  /** null: App Store Connect not connected, or it did not answer (`notes` says which). */
  apple: { versions: AppleVersion[]; builds: AppleBuild[] } | null;
  play: PlayTracks | null;
  /** The version Play's public page shows, which changes only once Google approves a release; null when it could not be read. */
  playLive: string | null;
  installs: InstallCount[] | null;
  notes: { ios: string[]; android: string[] };
}

// ---- the stages ------------------------------------------------------------------------

/** App Store version states (appVersionState, or the older appStoreState). */
const LIVE = new Set(['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION']);
const APPROVED: Record<string, string> = {
  PENDING_DEVELOPER_RELEASE: 'approved, waits for someone to release it',
  PENDING_APPLE_RELEASE: 'approved, Apple releases it',
  PROCESSING_FOR_DISTRIBUTION: 'approved, Apple is putting it out',
  ACCEPTED: 'approved'
};
const IN_REVIEW: Record<string, [string, Tone]> = {
  READY_FOR_REVIEW: ['being sent for review', 'busy'],
  WAITING_FOR_REVIEW: ['waiting for review', 'wait'],
  IN_REVIEW: ['in review', 'wait'],
  WAITING_FOR_EXPORT_COMPLIANCE: ['needs an export compliance answer', 'bad'],
  REJECTED: ['rejected: answer Apple in App Store Connect, or a newer build replaces it', 'bad'],
  METADATA_REJECTED: ['listing rejected: answer Apple in App Store Connect', 'bad'],
  INVALID_BINARY: ['refused as an invalid build', 'bad']
};
/** EAS build and submission states that mean it is still going. */
const RUNNING = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'PENDING', 'AWAITING_BUILD']);

const STAGES = {
  ios: [['building', 'Building on EAS'], ['waiting', 'TestFlight'], ['review', 'App Review'], ['approved', 'Approved, not out yet'], ['live', 'On the App Store']],
  android: [['building', 'Building on EAS'], ['waiting', 'Internal testing'], ['review', 'Play review'], ['live', 'On Google Play']]
} as const;

const num = (s: string | null | undefined): number => (s && /^\d+$/.test(s) ? Number(s) : NaN);
/** Whether dotted version `a` is newer than `b` (2026.1104.1802 > 2026.1103.2251); false when either is not one. */
export function newerVersion(a: string | null, b: string | null): boolean {
  const parts = (v: string | null) => (v && /^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
  const [x, y] = [parts(a), parts(b)];
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

const emptyStages = (platform: 'ios' | 'android'): Stage[] => STAGES[platform].map(([id, title]) => ({ id, title, cards: [] }));
const stage = (stages: Stage[], id: string): Stage => stages.find((s) => s.id === id)!;
const buildCard = (build: string | null, version: string | null, state: string, tone: Tone, at: string | null): Card =>
  ({ title: build ? `build ${build}` : version ? `version ${version}` : 'a build', build, version, state, tone, at, updates: [] });

/** Builds still building on EAS, and the newest one when it failed after the last that finished. */
function building(builds: EasBuild[], platform: 'ios' | 'android'): Card[] {
  const mine = builds.filter((b) => b.platform === platform).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const cards = mine.filter((b) => RUNNING.has(b.status)).map((b) => buildCard(b.build, b.version, b.status === 'IN_PROGRESS' ? 'building' : 'queued to build', 'busy', b.at));
  const lastDone = mine.find((b) => b.status === 'FINISHED');
  const failed = mine.find((b) => b.status === 'ERRORED');
  if (failed && (!lastDone || Date.parse(failed.at) > Date.parse(lastDone.at))) cards.push(buildCard(failed.build, failed.version, 'build failed on EAS', 'bad', failed.doneAt ?? failed.at));
  return cards;
}

/** When EAS finished the build with this number, for how long it has waited. */
const builtAt = (builds: EasBuild[], platform: string, build: string | null) =>
  builds.find((b) => b.platform === platform && b.build === build && b.status === 'FINISHED')?.doneAt ?? null;

export function iosLane(i: PipelineInputs): StoreLane {
  const stages = emptyStages('ios');
  const notes = [...i.notes.ios];
  stage(stages, 'building').cards.push(...building(i.builds, 'ios'));
  const subs = i.submissions.filter((s) => s.platform === 'ios');
  if (!i.apple) {
    // Without App Store Connect, the furthest Expo knows is the upload to TestFlight; what is
    // in review, approved or live is not known, so those stages say so instead of "none".
    for (const id of ['review', 'approved', 'live']) stage(stages, id).unseen = "can't see without App Store Connect";
    for (const s of subs.slice(0, 3)) {
      if (RUNNING.has(s.status)) stage(stages, 'waiting').cards.push(buildCard(s.build, s.version, 'uploading to TestFlight', 'busy', s.at));
      else if (s.status === 'FINISHED') stage(stages, 'waiting').cards.push(buildCard(s.build, s.version, 'uploaded to TestFlight', 'wait', s.doneAt ?? s.at));
      else if (s.status === 'ERRORED') stage(stages, 'waiting').cards.push(buildCard(s.build, s.version, 'upload to TestFlight failed', 'bad', s.doneAt ?? s.at));
    }
    return { id: 'ios', title: 'iPhone store builds', stages, notes };
  }
  // Versions from the newest down to the one on the App Store; older ones are behind it.
  const versions = i.apple.versions;
  const liveAt = versions.findIndex((v) => LIVE.has(v.state));
  const live = liveAt >= 0 ? versions[liveAt]! : null;
  const ahead = liveAt >= 0 ? versions.slice(0, liveAt) : versions;
  if (live) stage(stages, 'live').cards.push(buildCard(live.build, live.version, 'what people download', 'live', null));
  // Builds a version holds: none of them waits in TestFlight.
  const held = new Set(versions.filter((v) => v.state !== 'DEVELOPER_REJECTED' && v.state !== 'REPLACED_WITH_NEW_VERSION').map((v) => v.build).filter(Boolean));
  let newestSent = num(live?.build);
  const sent = (v: AppleVersion) => !!APPROVED[v.state] || IN_REVIEW[v.state]?.[1] === 'wait';
  ahead.forEach((v, k) => {
    if (APPROVED[v.state]) stage(stages, 'approved').cards.push(buildCard(v.build, v.version, APPROVED[v.state]!, 'wait', v.at));
    else if (IN_REVIEW[v.state]) {
      // A rejection behind a newer version in review is history.
      if (IN_REVIEW[v.state]![1] === 'bad' && ahead.slice(0, k).some(sent)) return;
      stage(stages, 'review').cards.push(buildCard(v.build, v.version, IN_REVIEW[v.state]![0], IN_REVIEW[v.state]![1], v.at));
    } else if (v.state === 'PREPARE_FOR_SUBMISSION' && v.build) stage(stages, 'waiting').cards.push(buildCard(v.build, v.version, 'on a version not sent for review yet', 'wait', v.at));
    else return;
    if (num(v.build) > (newestSent || 0)) newestSent = num(v.build);
  });
  // TestFlight: builds newer than anything sent, that no version holds. Apple's build number is the EAS build's.
  const waiting = stage(stages, 'waiting');
  for (const b of i.apple.builds.slice(0, 4)) {
    if (held.has(b.build) || !(num(b.build) > (newestSent || 0))) continue;
    const state = b.state === 'PROCESSING' ? ['Apple is processing it', 'busy'] as const
      : b.state === 'VALID' ? ['waits for the review ahead of it to end', 'wait'] as const
        : ['Apple refused it after processing', 'bad'] as const;
    waiting.cards.push(buildCard(b.build, b.version, state[0], state[1], b.uploadedAt ?? builtAt(i.builds, 'ios', b.build)));
  }
  // An upload Apple has not listed yet.
  for (const s of subs.filter((s) => RUNNING.has(s.status) && !i.apple!.builds.some((b) => b.build === s.build))) {
    waiting.cards.push(buildCard(s.build, s.version, 'uploading to TestFlight', 'busy', s.at));
  }
  const failedUpload = subs[0];
  if (failedUpload?.status === 'ERRORED' && !i.apple.builds.some((b) => b.build === failedUpload.build)) {
    waiting.cards.push(buildCard(failedUpload.build, failedUpload.version, 'upload to TestFlight failed', 'bad', failedUpload.doneAt ?? failedUpload.at));
  }
  if (waiting.cards.filter((c) => c.tone === 'wait').length > 1) notes.push('Only the newest build in TestFlight goes to review; the older ones are passed over.');
  return { id: 'ios', title: 'iPhone store builds', stages, notes };
}

const SENT = new Set(['completed', 'inProgress']);
/** The newest release of a track among those sent: its version name and highest version code. */
function newestSent(releases: PlayRelease[]): { name: string | null; code: number } | null {
  let best: { name: string | null; code: number } | null = null;
  for (const r of releases) {
    if (!SENT.has(r.status)) continue;
    const code = Math.max(...r.versionCodes.map(Number).filter(Number.isFinite));
    if (Number.isFinite(code) && (!best || code > best.code)) best = { name: r.name, code };
  }
  return best;
}

export function androidLane(i: PipelineInputs): StoreLane {
  const stages = emptyStages('android');
  const notes = [...i.notes.android];
  stage(stages, 'building').cards.push(...building(i.builds, 'android'));
  const versionOf = (code: string | null) => i.builds.find((b) => b.platform === 'android' && b.build === code)?.version ?? null;
  const codeOf = (version: string | null) => i.builds.find((b) => b.platform === 'android' && b.version === version && b.status === 'FINISHED')?.build ?? null;
  const live = i.playLive;
  const prod = i.play ? newestSent(i.play.production) : null;
  if (live) stage(stages, 'live').cards.push(buildCard(prod?.name === live ? String(prod.code) : codeOf(live), live, 'what people download', 'live', null));
  else notes.push("Google Play's page could not be read, so which version people download is not known.");
  const subs = i.submissions.filter((s) => s.platform === 'android');

  if (i.play) {
    const inReview = !!prod && prod.name !== live && (!live || newerVersion(prod.name, live));
    if (prod && inReview) {
      const code = String(prod.code);
      stage(stages, 'review').cards.push(buildCard(code, prod.name ?? versionOf(code), live ? 'in review, or rejected (Play Console says which)' : 'in review or out (the page could not be read)', 'wait', builtAt(i.builds, 'android', code)));
    }
    for (const r of i.play.internal) {
      if (!SENT.has(r.status)) continue;
      for (const code of r.versionCodes) {
        if (prod && Number(code) <= prod.code) continue;
        stage(stages, 'waiting').cards.push(buildCard(code, r.name ?? versionOf(code), inReview ? 'waits for the review ahead of it to end' : 'waits to be sent for review', 'wait', builtAt(i.builds, 'android', code)));
      }
    }
  } else {
    // Without Play's tracks, where EAS sent each build is the best guess: a build moved in Play Console is not seen.
    const newerThanLive = (s: EasSubmission) => !live || newerVersion(s.version, live);
    const finished = subs.filter((s) => s.status === 'FINISHED' && newerThanLive(s));
    const toProd = finished.filter((s) => s.track === 'production');
    const newestProd = Math.max(...toProd.map((s) => num(s.build)).filter(Number.isFinite), 0);
    if (toProd[0]) stage(stages, 'review').cards.push(buildCard(toProd[0].build, toProd[0].version, 'in review, or rejected (Play Console says which)', 'wait', toProd[0].doneAt ?? toProd[0].at));
    for (const s of finished.filter((s) => s.track !== 'production' && num(s.build) > newestProd)) {
      stage(stages, 'waiting').cards.push(buildCard(s.build, s.version, toProd[0] ? 'waits for the review ahead of it to end' : 'waits to be sent for review', 'wait', s.doneAt ?? s.at));
    }
  }
  for (const s of subs.filter((s) => RUNNING.has(s.status))) {
    stage(stages, s.track === 'production' ? 'review' : 'waiting').cards.push(buildCard(s.build, s.version, `uploading to ${s.track === 'production' ? 'production' : 'internal testing'}`, 'busy', s.at));
  }
  if (subs[0]?.status === 'ERRORED') {
    stage(stages, subs[0].track === 'production' ? 'review' : 'waiting').cards.push(buildCard(subs[0].build, subs[0].version, 'upload to Google Play failed', 'bad', subs[0].doneAt ?? subs[0].at));
  }
  // The internal track keeps one release; the newest waits, with nothing between it and review.
  stage(stages, 'waiting').cards.sort((a, b) => num(b.build) - num(a.build));
  return { id: 'android', title: 'Android store builds', stages, notes };
}

/** What an update's message says it carries. */
export type Named = Pick<UpdateCard, 'title' | 'copy' | 'also' | 'more'> & { pr: number };

/** A merge's line, "Merge pull request #332 from …" (a squash's list starts it with "* "), and the title on the line after. */
const MERGE_LINE = /^(?:\* )?Merge pull request #(\d+) from \S+[^\n]*(?=(?:\r?\n\s*([^\n]+))?)/gm;
/** What follows a merge's line when it has no title: the next commit of a squash, or what git and GitHub add. */
const NOT_A_TITLE = /^(?:\* |\(cherry picked from commit |Co-authored-by:|Merge pull request #)/i;

/**
 * The pull request a merge commit's message names: "Merge pull request #332
 * from …", its title on the line after. A copy onto a release branch
 * (scripts/release-branches.mjs) is a squash, whose first line ends with the
 * copy pull request, "(#335)", and which carries the merges it copied: one,
 * or for a catch-up ("… up on 33 merges from main (#350)") a list of them.
 */
export function prFromMessage(message: string | null): Named | null {
  const text = message ?? '';
  const first = text.split(/\r?\n/, 1)[0]!;
  const merges = [...text.matchAll(MERGE_LINE)];
  if (!merges.length) return null;
  const squash = /\(#(\d+)\)\s*$/.exec(first);
  const copy = squash && Number(squash[1]) !== Number(merges[0]![1]) ? Number(squash[1]) : null;
  const named = (m: RegExpExecArray) => { const t = m[2]?.trim(); return { pr: Number(m[1]), title: t && !NOT_A_TITLE.test(t) ? t : null }; };
  // A merge from main names one pull request; only a copy lists several.
  const prs = (copy === null ? merges.slice(0, 1) : merges).map(named).filter((m, k, all) => all.findIndex((x) => x.pr === m.pr) === k);
  const count = Number(/ up on (\d+) merges from main\b/.exec(first)?.[1] ?? prs.length);
  return { pr: prs[0]!.pr, title: prs[0]!.title, copy, also: prs.slice(1), more: Math.max(0, count - prs.length) };
}

/** An open pull request onto a release branch, as GitHub lists it; `failed` when its guardrails gate failed. */
export interface OpenCopy { number: number; title: string; body: string | null; created_at: string; labels?: { name: string }[]; head?: { sha: string }; failed?: boolean }

/** How long a copy may stay open before it needs a person: Claude's step has an hour, the checks under one. */
export const COPY_HOURS = 3;

/**
 * What a copy waits for, from its labels (scripts/release-branches.mjs):
 * copy-claude while Claude examines it, finishes it or fixes its failed
 * checks (with copy-conflict when it stopped at a conflict); copy-conflict
 * alone when Claude's run ended before the copy was finished, until the
 * hourly run starts Claude again; copy-needs-person once Claude's tries are
 * used up. The workflow takes the labels off when Claude finished, and turns
 * on auto-merge; between a failure and the hourly run that starts Claude
 * again, a copy has none.
 */
function copyWaits(o: OpenCopy, slow: boolean): { waiting: string; needsPerson: boolean } {
  const labels = (o.labels ?? []).map((l) => l.name);
  if (labels.includes('copy-needs-person')) {
    return { waiting: o.failed ? 'failed its tests after 3 tries by Claude, so it needs a person' : 'is not finished after 3 tries by Claude, so it needs a person', needsPerson: true };
  }
  const conflict = labels.includes('copy-conflict');
  const waiting = labels.includes('copy-claude')
    ? o.failed ? (slow ? 'failed its tests, and Claude has not fixed them' : 'failed its tests, and Claude is fixing them')
      : conflict ? (slow ? 'has a conflict that Claude has not finished' : 'has a conflict that Claude is fixing')
        : slow ? 'has waited for hours for Claude to examine it' : 'waits for Claude to examine it'
    : conflict ? (slow ? 'has been open for hours, and Claude has not finished it' : 'is not finished, and Claude tries again within the hour')
      : o.failed ? 'failed its tests, and Claude starts fixing them within the hour'
        : slow ? 'has been open for hours without merging' : 'merges itself when its tests pass';
  return { waiting, needsPerson: slow };
}

/**
 * Copies onto a platform's release branch that are not merged yet, as cards
 * on its public build: the change it should get, and why it has not. Each
 * names the pull requests on main it carries, from its body's list
 * ("- <commit> #317 Title"), or from its title for a copy made before that
 * list named them ("release/android: Merge pull request #340 from …").
 */
export function pendingCopies(lane: StoreLane, open: OpenCopy[], now = Date.now()): void {
  const card = stage(lane.stages, 'live').cards[0];
  if (!card) return;
  const pending = open.flatMap((o): UpdateCard[] => {
    const listed = [...(o.body ?? '').matchAll(/^- [0-9a-f]{40} #(\d+)(?:[ \t]+([^\n]+))?$/gm)].map((m) => ({ pr: Number(m[1]), title: m[2]?.trim() || null }));
    // A copy made before its body listed pull requests names one in its title.
    const old = Number(/Merge pull request #(\d+)|\(#(\d+)\)\s*$/.exec(o.title)?.slice(1).find(Boolean) ?? NaN);
    const prs = listed.length ? listed : Number.isFinite(old) ? [{ pr: old, title: null }] : [];
    if (!prs.length) return [];
    const slow = (hoursAgo(o.created_at, now) ?? 0) >= COPY_HOURS;
    return [{
      id: `copy-${o.number}`, pr: prs[0]!.pr, title: prs[0]!.title, copy: o.number, also: prs.slice(1), more: 0, at: o.created_at, rollBack: false, phones: null,
      ...copyWaits(o, slow)
    }];
  });
  card.updates = [...pending, ...card.updates];
}

/** How many updates a card lists; older ones are on EAS. */
export const UPDATES_PER_BUILD = 3;

/**
 * Each built card's updates: those published on the production branch for
 * its platform and runtime after EAS made it, newest first, with the phones
 * of that platform that run each. A card whose build EAS does not list (an
 * older live one) shows none.
 */
export function attachUpdates(i: PipelineInputs, lanes: StoreLane[]): void {
  const all = (platform: string) => (i.installs ?? []).filter((c) => c.channel === 'production' && c.platform === platform);
  for (const lane of lanes) {
    const phones = all(lane.id);
    const of = phones.reduce((a, c) => a + (Number(c.n) || 0), 0);
    for (const s of lane.stages) {
      if (s.id === 'building') continue;
      for (const card of s.cards) {
        const built = i.builds.find((b) => b.platform === lane.id && b.build === card.build && b.build !== null && b.status === 'FINISHED');
        if (!built?.runtime) continue;
        card.updates = i.updates
          .filter((u) => u.platform === lane.id && u.runtime === built.runtime && Date.parse(u.at) > Date.parse(built.at))
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
          .slice(0, UPDATES_PER_BUILD)
          .map((u) => {
            const named = prFromMessage(u.message);
            const on = phones.filter((c) => (u.rollBack ? c.embedded && c.runtime === u.runtime : c.updateId === u.id)).reduce((a, c) => a + (Number(c.n) || 0), 0);
            return {
              id: u.id, pr: named?.pr ?? null, title: named?.title ?? null, copy: named?.copy ?? null, also: named?.also ?? [], more: named?.more ?? 0,
              at: u.at, rollBack: u.rollBack, phones: i.installs ? { on, of } : null
            };
          });
      }
    }
  }
}

/** How long a build may wait with nothing ahead of it before it is worth a look. */
export const STUCK_HOURS = 3;

/**
 * A build that waits in TestFlight or internal testing while nothing of its
 * platform is in review or approved: the step that sends it is not working
 * (no key, or a failure), or it waits for a person.
 */
export function pipelineAlerts(p: Pipeline, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const lane of p.lanes) {
    // A review that cannot be seen (its store not connected) may well be open, so it is never called stuck.
    const ahead = lane.stages.filter((s) => s.id === 'review' || s.id === 'approved').some((s) => s.cards.length > 0 || s.unseen);
    const waiting = stage(lane.stages, 'waiting').cards.find((c) => c.tone === 'wait');
    const hours = hoursAgo(waiting?.at, now);
    if (!waiting || ahead || hours === null || hours < STUCK_HOURS) continue;
    const where = lane.id === 'ios' ? 'TestFlight' : 'internal testing';
    const fix = lane.id === 'ios'
      ? 'Check the hourly App Store step (app-store-review.yml) on EAS.'
      : 'Check the Play step (play-review.mjs) on EAS: without PLAY_REVIEW_KEY, promote it in Play Console (docs/environments.md, The Play key).';
    out.push({ level: 'watch', text: `${lane.id === 'ios' ? 'iPhone' : 'Android'} ${waiting.title} has waited in ${where} for ${Math.floor(hours)} h with nothing in review. ${fix}` });
  }
  // A copy for a public build that needs a person: Claude could not fix its failed tests, or it has been open for hours.
  for (const lane of p.lanes) {
    const live = stage(lane.stages, 'live').cards[0];
    for (const u of live?.updates ?? []) {
      if (!u.waiting || !u.needsPerson || u.copy === null) continue;
      const prs = [u.pr, ...u.also.map((a) => a.pr)].filter((n): n is number => n !== null).map((n) => `PR ${n}`);
      const named = prs.length > 3 ? `${prs.slice(0, 2).join(', ')} and ${prs.length - 2} more` : prs.join(' and ');
      out.push({
        level: 'problem',
        text: `${lane.id === 'ios' ? 'iPhone' : 'Android'} ${live!.title} does not have ${named} yet: copy PR ${u.copy} ${u.waiting}. Open it to finish it (decisions.md 155).`,
        link: `https://github.com/${p.repo}/pull/${u.copy}`
      });
    }
  }
  return out;
}

export function pipelineFrom(i: PipelineInputs, repo = 'genesis-ai-dev/langquest-next'): Pipeline {
  const lanes = [iosLane(i), androidLane(i)];
  attachUpdates(i, lanes);
  return { lanes, activeDays: ACTIVE_DAYS, repo };
}

/** The commits of shown updates whose message did not name their pull request and title. */
export const unnamed = (p: Pipeline, commitOf: Map<string, string>): string[] =>
  [...new Set(p.lanes.flatMap((l) => l.stages.flatMap((s) => s.cards.flatMap((c) => c.updates)))
    .filter((u) => (u.pr === null || u.title === null) && u.copy === null && !u.also.length).map((u) => commitOf.get(u.id)).filter((c): c is string => !!c))];

/** Pull requests by merge commit, kept per isolate: a merged pull request's number and title do not change. */
const prsByCommit = new Map<string, { pr: number; title: string } | null>();

// ---- reading the sources -------------------------------------------------------------------

export const PIPELINE_QUERY = `query ($id: String!) {
  app { byId(appId: $id) {
    builds(offset: 0, limit: 40, filter: { buildProfile: "production" }) { status platform createdAt completedAt appVersion appBuildVersion runtime { version } }
    submissions(filter: {}, offset: 0, limit: 12) { status platform createdAt completedAt androidConfig { track } submittedBuild { appVersion appBuildVersion } }
    updateBranchByName(name: "production") { updateGroups(offset: 0, limit: 30) { id platform createdAt message gitCommitHash isRollBackToEmbedded runtime { version } } }
  } }
}`;

interface ExpoAnswer {
  data?: { app?: { byId?: {
    builds?: { status: string; platform: string; createdAt: string; completedAt?: string | null; appVersion?: string | null; appBuildVersion?: string | null; runtime?: { version?: string | null } | null }[];
    submissions?: { status: string; platform: string; createdAt: string; completedAt?: string | null; androidConfig?: { track?: string | null } | null; submittedBuild?: { appVersion?: string | null; appBuildVersion?: string | null } | null }[];
    updateBranchByName?: { updateGroups?: { id: string; platform: string; createdAt: string; message?: string | null; gitCommitHash?: string | null; isRollBackToEmbedded?: boolean | null; runtime?: { version?: string | null } | null }[][] } | null;
  } } };
  errors?: { message: string }[];
}

const platformOf = (p: string): 'ios' | 'android' | null => (p.toLowerCase() === 'ios' ? 'ios' : p.toLowerCase() === 'android' ? 'android' : null);
const byNewest = <T extends { at: string }>(list: T[]) => list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

export function expoInputs(answer: ExpoAnswer): Pick<PipelineInputs, 'builds' | 'submissions' | 'updates'> {
  const app = answer.data?.app?.byId;
  const builds = byNewest((app?.builds ?? []).flatMap((b) => {
    const platform = platformOf(b.platform);
    return platform ? [{ platform, status: b.status, at: b.createdAt, doneAt: b.completedAt ?? null, version: b.appVersion ?? null, build: b.appBuildVersion ?? null, runtime: b.runtime?.version ?? null }] : [];
  }));
  const submissions = byNewest((app?.submissions ?? []).flatMap((s) => {
    const platform = platformOf(s.platform);
    return platform ? [{ platform, status: s.status, at: s.createdAt, doneAt: s.completedAt ?? null, track: s.androidConfig?.track ?? null, version: s.submittedBuild?.appVersion ?? null, build: s.submittedBuild?.appBuildVersion ?? null }] : [];
  }));
  const updates = byNewest((app?.updateBranchByName?.updateGroups ?? []).flat().flatMap((u) => {
    const platform = platformOf(u.platform);
    return platform ? [{ id: u.id, platform, at: u.createdAt, runtime: u.runtime?.version ?? null, commit: u.gitCommitHash ?? null, message: u.message ?? null, rollBack: u.isRollBackToEmbedded === true }] : [];
  }));
  return { builds, submissions, updates };
}

interface Resource<A> { id: string; type?: string; attributes?: A; relationships?: Record<string, { data?: { id: string; type: string } | null }> }

export function appleInputs(
  versions: { data: Resource<{ versionString?: string; appVersionState?: string; appStoreState?: string; createdDate?: string }>[]; included?: Resource<{ version?: string }>[] },
  builds: { data: Resource<{ version?: string; uploadedDate?: string; processingState?: string }>[]; included?: Resource<{ version?: string }>[] }
): { versions: AppleVersion[]; builds: AppleBuild[] } {
  const buildNumber = new Map((versions.included ?? []).filter((r) => !r.type || r.type === 'builds').map((r) => [r.id, r.attributes?.version ?? null]));
  const marketing = new Map((builds.included ?? []).map((r) => [r.id, r.attributes?.version ?? null]));
  return {
    versions: versions.data.map((v) => ({
      version: v.attributes?.versionString ?? '?',
      // appVersionState replaced appStoreState; older answers have only the latter.
      state: v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? 'UNKNOWN',
      at: v.attributes?.createdDate ?? null,
      build: buildNumber.get(v.relationships?.build?.data?.id ?? '') ?? null
    })).sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0')),
    builds: builds.data.map((b) => ({
      version: marketing.get(b.relationships?.preReleaseVersion?.data?.id ?? '') ?? null,
      build: b.attributes?.version ?? null,
      state: b.attributes?.processingState ?? 'UNKNOWN',
      uploadedAt: b.attributes?.uploadedDate ?? null
    }))
  };
}

const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

/** Play's internal and production tracks, read in an edit that is then deleted, so nothing changes. */
export async function playTracks(key: string, pkg: string, fetcher: typeof fetch, now = Date.now()): Promise<PlayTracks> {
  const account = jsonSecret<{ client_email: string; private_key: string }>(key, 'ADMIN_GOOGLE_PLAY_KEY', ['client_email', 'private_key']);
  const headers = { authorization: `Bearer ${await googleToken(account, fetcher, now)}` };
  const base = `${PLAY_API}/${encodeURIComponent(pkg)}/edits`;
  const edit = await getJson<{ id: string }>(fetcher, base, { method: 'POST', headers }, 'Play edit');
  try {
    const { tracks = [] } = await getJson<{ tracks?: { track: string; releases?: { name?: string; status?: string; versionCodes?: (string | number)[] }[] }[] }>(
      fetcher, `${base}/${encodeURIComponent(edit.id)}/tracks`, { headers }, 'Play tracks');
    const of = (name: string) => (tracks.find((t) => t.track === name)?.releases ?? []).map((r) => ({ name: r.name ?? null, status: r.status ?? 'unknown', versionCodes: (r.versionCodes ?? []).map(String) }));
    return { internal: of('internal'), production: of('production') };
  } finally {
    await fetcher(`${base}/${encodeURIComponent(edit.id)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  }
}

/**
 * The request a browser in the US makes for the app's Play page; the
 * consent cookies keep Google from sending a request from elsewhere to its
 * consent page (apps/web/worker/storeReleases.ts, PLAY_REQUEST).
 */
const PLAY_PAGE_REQUEST: RequestInit = {
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
    accept: 'text/html',
    cookie: 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=PENDING+987'
  },
  redirect: 'follow'
};

/** The version people can download from Google Play, from its public page; null when the page shows none. */
export async function playLiveVersion(pkg: string, fetcher: typeof fetch): Promise<string | null> {
  const res = await fetcher(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`, { ...PLAY_PAGE_REQUEST, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Google Play's page answered ${res.status}`);
  // The page carries its data as JSON; the current version is the only string in a [[["…"]] of its own.
  return /\[\[\["(\d+(?:\.\d+){0,2})"\]\]/.exec(await res.text())?.[1] ?? null;
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function pipelineSection(
  env: { ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string; ADMIN_APP_STORE_KEY?: string; APP_STORE_APP_ID: string; ADMIN_GOOGLE_PLAY_KEY?: string; GOOGLE_PLAY_PACKAGE: string; DIAG?: Hyperdrive; GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string },
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  diag: (<T>(fn: (q: Query) => Promise<T>) => Promise<T>) | null = env.DIAG ? (fn) => withDiag(diagConnection(env), fn) : null
): Promise<Section<Pipeline>> {
  if (!env.ADMIN_EXPO_TOKEN) return off('Add ADMIN_EXPO_TOKEN: what EAS built, sent and published is read with it (docs/admin.md).') as Section<Pipeline>;
  const notes: PipelineInputs['notes'] = { ios: [], android: [] };
  const appleRead = async () => {
    if (!env.ADMIN_APP_STORE_KEY) { notes.ios.push('App Store Connect is not connected (ADMIN_APP_STORE_KEY), so this shows only what EAS sent to TestFlight.'); return null; }
    try {
      const headers = { authorization: `Bearer ${await appStoreToken(appStoreKey(env.ADMIN_APP_STORE_KEY), now)}` };
      const id = encodeURIComponent(env.APP_STORE_APP_ID);
      const api = 'https://api.appstoreconnect.apple.com/v1';
      const [versions, builds] = await Promise.all([
        getJson<Parameters<typeof appleInputs>[0]>(fetcher, `${api}/apps/${id}/appStoreVersions?limit=8&include=build&fields[builds]=version`, { headers }, 'App Store versions'),
        getJson<Parameters<typeof appleInputs>[1]>(fetcher, `${api}/builds?filter[app]=${id}&sort=-uploadedDate&limit=8&include=preReleaseVersion`, { headers }, 'App Store builds')
      ]);
      return appleInputs(versions, builds);
    } catch (e) {
      notes.ios.push(`App Store Connect could not be read (${why(e)}), so this shows only what EAS sent to TestFlight.`);
      return null;
    }
  };
  const playRead = async () => {
    if (!env.ADMIN_GOOGLE_PLAY_KEY) { notes.android.push("Play's tracks are not connected (ADMIN_GOOGLE_PLAY_KEY), so this shows where EAS sent each build; one moved in Play Console is not seen."); return null; }
    try { return await playTracks(env.ADMIN_GOOGLE_PLAY_KEY, env.GOOGLE_PLAY_PACKAGE, fetcher, now); }
    catch (e) {
      notes.android.push(`Play's tracks could not be read (${why(e)}), so this shows where EAS sent each build; one moved in Play Console is not seen.`);
      return null;
    }
  };
  const [answer, apple, play, playLive, installs] = await Promise.all([
    getJson<ExpoAnswer>(fetcher, 'https://api.expo.dev/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.ADMIN_EXPO_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: PIPELINE_QUERY, variables: { id: env.EXPO_PROJECT_ID } })
    }, 'Expo'),
    appleRead(),
    playRead(),
    playLiveVersion(env.GOOGLE_PLAY_PACKAGE, fetcher).catch((e) => { notes.android.push(why(e)); return null; }),
    diag
      ? diag((q) => q<InstallCount[]>(INSTALLS_SQL, [ACTIVE_DAYS])).catch((e) => {
        for (const n of [notes.ios, notes.android]) n.push(`Phones on each update could not be counted (${why(e)}).`);
        return null;
      })
      : Promise.resolve(null)
  ]);
  if (answer.errors?.length) throw new Error(`Expo: ${answer.errors[0]!.message.slice(0, 200)}`);
  const inputs = { ...expoInputs(answer), apple, play, playLive, installs, notes };
  const p = pipelineFrom(inputs, env.GITHUB_REPO);
  // An update whose message does not name its pull request: GitHub's pull request for its merge commit, a few at most.
  const commitOf = new Map(inputs.updates.filter((u) => u.commit).map((u) => [u.id, u.commit!]));
  const gh = githubApi(env, fetcher);
  await Promise.all(unnamed(p, commitOf).filter((c) => !prsByCommit.has(c)).slice(0, 8).map((c) =>
    gh<{ number: number; title: string; merged_at?: string | null }[]>(`/commits/${encodeURIComponent(c)}/pulls`, 'GitHub pull requests')
      .then((prs) => { const m = prs.find((x) => x.merged_at) ?? prs[0]; prsByCommit.set(c, m ? { pr: m.number, title: m.title } : null); })
      .catch(() => {})));
  for (const u of p.lanes.flatMap((l) => l.stages.flatMap((s) => s.cards.flatMap((c) => c.updates)))) {
    const found = prsByCommit.get(commitOf.get(u.id) ?? '');
    if (!found) continue;
    // A copy's own pull request ("release/android: …") is the copy, not the change.
    if (/^release\/[a-z]+: /.test(found.title)) { u.copy ??= found.pr; u.title ??= found.title.replace(/^release\/[a-z]+: /, ''); }
    else { u.pr ??= found.pr; u.title ??= found.title; }
  }
  // Copies onto each release branch that are not merged yet, on the public build they are for, with whether their tests failed.
  const open = await Promise.all(p.lanes.map(async (l) => {
    const copies = await gh<OpenCopy[]>(`/pulls?state=open&base=${encodeURIComponent(`release/${l.id}`)}&per_page=30`, 'GitHub copies').catch(() => null);
    await Promise.all((copies ?? []).filter((o) => o.head?.sha).slice(0, 8).map((o) =>
      gh<{ check_runs: { conclusion: string | null }[] }>(`/commits/${encodeURIComponent(o.head!.sha)}/check-runs?check_name=gate`, 'GitHub checks')
        .then((r) => { o.failed = r.check_runs.some((c) => c.conclusion === 'failure'); })
        .catch(() => {})));
    return copies;
  }));
  p.lanes.forEach((l, k) => { if (open[k]?.length) pendingCopies(l, open[k]!, now); });
  return ok(p, pipelineAlerts(p, now));
}
