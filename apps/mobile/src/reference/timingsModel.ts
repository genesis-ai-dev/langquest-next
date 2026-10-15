// What a Bible's page says about asking for timings and about a timing job
// (screens/reference.tsx; docs/reference-material.md): whether asking is on
// offer and for how many books, a book's line, a job's state, badge and
// progress, and a failed chapter's reason in the language showing. Pure: no
// React, so it is tested.
import { testamentOf, type LibraryItemView } from '@langquest-next/core';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { list } from './biblesModel';
import { sourceFacts, timingsNeeded } from './model';
import type { TimingJob } from './useReference';
import type { TimingPublication } from '@langquest-next/core';

type Facts = ReturnType<typeof sourceFacts>;
type Need = ReturnType<typeof timingsNeeded>;

/** How far a timing job has got, as the badge and the card's state line say it. */
export type JobOutcome = TimingPublication | { error: string };

/**
 * Whether the page offers to generate timings and for how many books.
 * Following LangQuest's own source: the timings go to LangQuest's copy, for
 * everyone who follows it (`viaLangQuest`); following anyone else's, they
 * cannot be asked for here. Asking is off while a job is open.
 */
export function timingsOffer(it: Pick<LibraryItemView, 'source' | 'subscription'>, need: Need, canOrg: boolean, jobs: Pick<TimingJob, 'finished_at'>[]) {
  const followed = it.source === 'subscription';
  const viaLangQuest = followed && it.subscription?.sourceOrgId === 'langquest' ? { org: 'langquest', item: it.subscription.sourceItemId } : null;
  const booksToTime = need.requests.reduce((n, q) => n + q.books.length, 0);
  const open = jobs.filter((j) => !j.finished_at);
  const mayAsk = canOrg && need.allowed && need.requests.length > 0 && (!followed || !!viaLangQuest) && open.length === 0;
  return { followed, viaLangQuest, booksToTime, mayAsk };
}

/** How many of the source's books have any timing. */
export const timedBookCount = (facts: Facts): number => facts.books.filter((b) => b.timed > 0).length;

/** What one book of the source has: FCBH's timings live, why it has none, or how many chapters are timed and from where. */
export function bookTimingLine(facts: Facts, b: Facts['books'][number]): string {
  const testament = testamentOf(b.book);
  if (facts.timings[testament] === 'fcbh') return t('reference.source.bookFcbh');
  if (b.timed === 0) {
    return !facts.audio[testament] ? t('reference.source.bookNoAudio') : facts.timings[testament] === 'unknown' ? t('reference.source.bookUnknown') : t('reference.source.bookNoTimings');
  }
  return [
    b.chapters ? t('reference.source.chaptersTimedOf', { timed: b.timed, count: b.chapters }) : t('reference.source.chaptersTimed', { count: b.timed }),
    list(b.sources.map((s) => (s === 'generated' ? t('reference.source.timingGenerated') : s === 'fcbh' ? t('reference.source.timingFcbh') : t('reference.source.timingCorrected'))))
  ].join(' · ');
}

/** A job's words and badge: what it is for, where it stands, and the progress bar's percentage while it runs. */
export function jobView(j: TimingJob) {
  const what = t('reference.job.what', { count: j.books.length, fileset: j.audio_fileset });
  // The timing service writes its error and progress note itself, in English.
  const working = j.total ? t('reference.job.working', { done: j.done, count: j.total }) : t('reference.job.workingUnknown', { done: j.done });
  const state = j.error ? t('reference.job.stopped', { reason: j.error })
    : j.finished_at ? t('reference.job.finished', { passed: j.results - j.failed, count: j.results })
    : j.claimed_at ? (j.note ? [working, j.note].join(' · ') : working)
    : t('reference.job.waitingForService');
  const badge = j.error ? t('reference.job.badgeStopped') : j.finished_at ? t('reference.job.badgeDone') : j.claimed_at ? t('reference.job.badgeWorking') : t('reference.job.badgeWaiting');
  const tone: 'red' | 'green' | 'amber' = j.error ? 'red' : j.finished_at ? 'green' : 'amber';
  const percent = !j.finished_at && j.total > 0 ? Math.round((100 * j.done) / j.total) : null;
  return { what, state, badge, tone, percent };
}

/** What publishing a finished job did: chapters placed, kept as they were, left to FCBH's live timings. */
export function publicationLine(outcome: TimingPublication): string {
  return [
    outcome.placed.length ? t('reference.job.publishedChapters', { count: outcome.placed.length }) : t('reference.job.alreadyPublished'),
    outcome.kept.length ? t('reference.job.keptTimings', { count: outcome.kept.length }) : null,
    outcome.skipped.length ? t('reference.job.fcbhLive', { count: outcome.skipped.length }) : null
  ].filter(Boolean).join(' ');
}

/**
 * Why a chapter did not pass, in the language showing. Core's
 * `timingPublication` words these in English; the aligner's own reason
 * after "Verse 3:" is its own and stays as it wrote it.
 */
export function failReason(reason: string): string {
  switch (reason) {
    case 'Not a timing document': return t('reference.job.reason.notTiming');
    case 'This Bible does not have that book': return t('reference.job.reason.noSuchBook');
    case 'The result names another chapter': return t('reference.job.reason.otherChapter');
    case "This Bible's book is not loaded yet. Try again when connected.": return t('reference.job.reason.bookNotLoaded');
    case 'Did not pass the check': return t('reference.job.reason.failedCheck');
  }
  let m = /^Numbered in a versification this organization does not have \((.*)\)$/.exec(reason);
  if (m) return t('reference.job.reason.unknownVersification', { code: m[1] });
  m = /^Not a valid timing: (.*)$/.exec(reason);
  if (m) return t('reference.job.reason.invalid', { detail: m[1] });
  m = /^Did not pass the check \(off by up to (\d+) ms\)$/.exec(reason);
  if (m) return t('reference.job.reason.offBy', { ms: formatNumber(Number(m[1])) });
  m = /^Verse (.+?): (.*?)(?: \(and (\d+) more\))?$/.exec(reason);
  if (m) {
    const flag = m[2] === 'flagged' ? t('reference.job.reason.flagged') : m[2]!;
    return m[3] ? t('reference.job.reason.verseMore', { verse: m[1], reason: flag, count: Number(m[3]) }) : t('reference.job.reason.verse', { verse: m[1], reason: flag });
  }
  return reason;
}
