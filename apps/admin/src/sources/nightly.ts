import { hoursAgo, ok, type Alert, type Section } from '../section';
import { githubApi, type GitHubEnv } from './githubApi';

/**
 * Last night's tests, every suite together (decisions.md 209): the latest
 * scheduled run on main of each nightly workflow, and the line each of its
 * reporting jobs left on it, an annotation titled "Nightly: <suite>"
 * (scripts/nightly-report.mjs `nightNotice`): how many passed, or that the
 * suite broke, and the Linear issue of each failure. Linear holds each
 * failure with its error and screen; this says only how the night went.
 * A failed test is a watch. A suite that broke, a reporting job that failed
 * and left no line, or a nightly that stopped running is a problem.
 */

/**
 * The nightly workflows, the jobs in each that leave a line, and the jobs
 * whose failure those lines say (each phone job's, in the Report's line;
 * the mutation shards', in nightly-mutation's). apps/admin/test/nightly.test.ts
 * holds the names to the workflows.
 */
export const NIGHTLIES = [
  { workflow: 'guardrails.yml', title: 'Guardrails nightly', jobs: ['nightly-ui-web', 'nightly-fleet', 'nightly-mutation'], covers: /^nightly-(ui-web|fleet|mutation)\b/ },
  { workflow: 'phone-tests.yml', title: 'Phone tests', jobs: ['Report'], covers: /^/ }
] as const;

/** Each runs once a day: a latest run older than this means its schedule stopped. */
export const STALE_H = 36;

export interface SuiteNight {
  suite: string;
  /** Counts, or null for a suite without them (fleet, mutation) or one that broke. */
  ran: number | null;
  passed: number | null;
  failed: boolean;
  /** Why the suite broke as a whole, or null. */
  broke: string | null;
  issues: { id: string; url: string | null }[];
}

export interface NightRun {
  workflow: string;
  title: string;
  run: { number: number; url: string; at: string; sha: string; conclusion: string | null } | null;
  suites: SuiteNight[];
}

export interface Nightly { repo: string; runs: NightRun[] }

interface Runs { workflow_runs: { id: number; head_sha: string; created_at: string; html_url: string; run_number: number; conclusion: string | null }[] }
interface Jobs { jobs: { id: number; name: string; conclusion: string | null; status: string }[] }
interface Annotation { title: string | null; message: string }

const LINEAR_URL = /^https:\/\/linear\.app\/\S+$/;

/** One line as nightly-report.mjs `nightLine` writes it, or null when the annotation is not one. */
export function parseLine(title: string | null, message: string): SuiteNight | null {
  const suite = /^Nightly:\s*(.+)$/.exec(title ?? '')?.[1]?.trim();
  if (!suite) return null;
  const [head = '', ...rest] = message.split('\n').map((l) => l.trim());
  const issues = rest.flatMap((l) => {
    const m = /^([A-Z][A-Z0-9]*-\d+)(?:\s+(\S+))?$/.exec(l);
    return m ? [{ id: m[1]!, url: m[2] && LINEAR_URL.test(m[2]) ? m[2] : null }] : [];
  });
  const broke = /^Broke:\s*(.*)$/.exec(head);
  if (broke) return { suite, ran: null, passed: null, failed: true, broke: broke[1] || 'it broke', issues };
  const counts = /^(\d+) of (\d+) passed$/.exec(head);
  if (counts) {
    const passed = Number(counts[1]);
    const ran = Number(counts[2]);
    return { suite, ran, passed, failed: passed < ran, broke: null, issues };
  }
  if (head === 'Passed' || head === 'Failed') return { suite, ran: null, passed: null, failed: head === 'Failed', broke: null, issues };
  return null;
}

const ENDED: Record<string, string> = { failure: 'failed', cancelled: 'was cancelled', timed_out: 'timed out', skipped: 'did not run' };

/** A reporting job that left no line: as its job ended, and broke when it did not pass. */
function noLine(job: string, conclusion: string | null): SuiteNight {
  const passed = conclusion === 'success';
  const ended = conclusion ? ENDED[conclusion] ?? `ended ${conclusion}` : 'ended without a result';
  return { suite: `${job} job`, ran: null, passed: null, failed: !passed, broke: passed ? null : `the job ${ended} and left no line for this page.`, issues: [] };
}

export function nightlyAlerts(n: Nightly, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  for (const r of n.runs) {
    if (!r.run) continue;
    const age = hoursAgo(r.run.at, now);
    if (age !== null && age > STALE_H) {
      out.push({ level: 'problem', text: `The ${r.title} last ran on its schedule ${Math.round(age)} h ago: the schedule may have stopped.`, link: `https://github.com/${n.repo}/actions/workflows/${r.workflow}` });
    }
    for (const s of r.suites) {
      const ids = s.issues.length ? ` (${s.issues.map((i) => i.id).join(', ')})` : '';
      const link = s.issues.find((i) => i.url)?.url ?? r.run.url;
      if (s.broke) out.push({ level: 'problem', text: `Nightly ${s.suite} broke: ${s.broke}${ids}`, link });
      else if (s.failed) {
        const what = s.ran !== null && s.passed !== null ? `: ${s.ran - s.passed} of ${s.ran} failed` : ' failed';
        out.push({ level: 'watch', text: `Nightly ${s.suite}${what}${ids}.`, link });
      }
    }
  }
  return out;
}

export async function nightlySection(env: GitHubEnv, fetcher: typeof fetch = fetch): Promise<Section<Nightly>> {
  const gh = githubApi(env, fetcher);
  const runs = await Promise.all(NIGHTLIES.map(async (n): Promise<NightRun> => {
    const latest = (await gh<Runs>(`/actions/workflows/${n.workflow}/runs?branch=main&event=schedule&status=completed&per_page=1`, 'GitHub nightly runs')).workflow_runs[0];
    if (!latest) return { workflow: n.workflow, title: n.title, run: null, suites: [] };
    const jobs = (await gh<Jobs>(`/actions/runs/${latest.id}/jobs?filter=latest&per_page=100`, 'GitHub jobs')).jobs;
    const suites = (await Promise.all(n.jobs.map(async (name): Promise<SuiteNight[]> => {
      const job = jobs.find((j) => j.name === name);
      if (!job) return [{ ...noLine(name, null), broke: 'the run has no job of that name.' }];
      const lines = (await gh<Annotation[]>(`/check-runs/${job.id}/annotations`, 'GitHub annotations'))
        .map((a) => parseLine(a.title, a.message)).filter((l): l is SuiteNight => l !== null);
      return lines.length ? lines : [noLine(name, job.conclusion)];
    }))).flat();
    return {
      workflow: n.workflow, title: n.title,
      run: { number: latest.run_number, url: latest.html_url, at: latest.created_at, sha: latest.head_sha.slice(0, 8), conclusion: latest.conclusion },
      suites
    };
  }));
  const data: Nightly = { repo: env.GITHUB_REPO, runs };
  return ok(data, nightlyAlerts(data));
}
