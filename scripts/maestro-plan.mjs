/**
 * Which phone flows a run can hold (scripts/maestro-ui.mjs, decision 102).
 *
 * Some flows cannot pass unattended: they need a microphone signal (tag
 * `voice`), Android (tag `android-only`: its airplane mode, or the disguise,
 * which an iPhone build has none of), or a step from
 * outside mid-run (tag `wrapped`). Running them anyway reports failures that
 * are not findings, and hides the ones that are. So the runner skips them,
 * says so, and runs them only when the run says it can: `--voice` or
 * `--mic`, `--platform android`, `--wrapped`. Flows named with `--flow` are
 * run as asked.
 *
 * And which flows a run holds again, when Maestro's driver on the phone
 * stopped and left them without a result (the last part of this file,
 * decision 208).
 */

/** @typedef {{ platform: string; voice?: boolean; mic?: boolean; wrapped?: boolean; flows?: string[] }} RunOptions */

/** A skip rule: the tag, when it applies, and what the run lacks. */
export const SKIPS = [
  {
    tag: 'voice',
    when: (/** @type {RunOptions} */ o) => !o.voice && !o.mic,
    why: 'need a microphone signal: run with --voice (loops e2e/fixtures/voice.wav into the host input) or --mic (the input already carries voice)'
  },
  {
    tag: 'android-only',
    when: (/** @type {RunOptions} */ o) => o.platform !== 'android',
    why: 'need Android (its airplane mode, which the iOS simulator lacks, or the disguise, which an iPhone build lacks): run with --platform android'
  },
  {
    tag: 'wrapped',
    when: (/** @type {RunOptions} */ o) => !o.wrapped,
    why: 'need a step from outside mid-run (their headers say which): run with --wrapped and do it'
  }
];

/** The skip rules that apply to a run. Named flows are run as asked, whatever their tags. */
export function plannedSkips(/** @type {RunOptions} */ options) {
  if (options.flows?.length) return [];
  return SKIPS.filter((s) => s.when(options));
}

/** The tags a flow file declares (its `tags:` block, before the `---`). */
export function flowTags(/** @type {string} */ yaml) {
  const head = yaml.split(/^---\s*$/m)[0] ?? '';
  const block = /^tags:\s*\n((?:[ \t]+-[^\n]*\n?)*)/m.exec(head)?.[1] ?? '';
  return [...block.matchAll(/^[ \t]+-\s*"?([^"\s]+)"?/gm)].map((m) => m[1]);
}

/**
 * What to tell the person: one line per rule that skips at least one flow,
 * naming the flows. `flows` is each flow file's name and tags.
 */
export function skipReport(/** @type {{ tag: string; why: string }[]} */ skips, /** @type {{ name: string; tags: string[] }[]} */ flows) {
  const lines = [];
  for (const s of skips) {
    const hit = flows.filter((f) => f.tags.includes(s.tag)).map((f) => f.name);
    if (!hit.length) continue;
    lines.push(`Skipping ${hit.length} ${hit.length === 1 ? 'flow' : 'flows'} tagged ${s.tag} (${hit.join(', ')}): they ${s.why}.`);
  }
  return lines;
}

/** Each flow a run leaves out, with the tag and why: one entry per flow, the first rule that skips it. */
export function skippedFlows(/** @type {{ tag: string; why: string }[]} */ skips, /** @type {{ name: string; tags: string[] }[]} */ flows) {
  return flows.flatMap((f) => {
    const s = skips.find((rule) => f.tags.includes(rule.tag));
    return s ? [{ flow: f.name, tag: s.tag, why: s.why }] : [];
  });
}

// ---- When the driver stops (decision 208, amended 2026-11-18) ---------------------------
//
// Maestro drives a phone through a driver it installs there: on an iPhone,
// one XCTest case that answers its requests. When that driver stops (XCTest
// fails the case when a view it asked about has gone, as a keyboard closing),
// the `maestro test` that started it never starts another. The flow it
// stopped at and every flow after it end with "Device became unreachable",
// which says nothing of the app: seven flows on 2026-11-17, thirteen on
// 2026-11-15. Maestro has no setting for it (none up to 2.12).
//
// So the runner starts Maestro again, which starts a new driver, for the
// flows that got no result, and puts their results in the run's report. A
// flow that got a result, pass or fail, is never run again: this gives a
// flow its one run, not a second chance (docs/testing.md, "Zero retries").

/** What Maestro says of a flow it could not run, or finish, because its driver on the phone was gone. */
const NO_DRIVER = /DeviceUnreachableException|Device became unreachable/;
/** Whether a flow's error says the driver was gone, and so nothing about the app. */
export const noDriver = (/** @type {string | null | undefined} */ error) => NO_DRIVER.test(error ?? '');

/** How many times one run starts a new driver. A phone that is gone for good fails each start in seconds. */
export const NEW_DRIVERS = 3;

const CASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const unescapeXml = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const attr = (/** @type {string} */ attrs, /** @type {string} */ name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeXml(m[1]) : null;
};

/**
 * Each flow in a Maestro junit report, in the order it ran: its name, its
 * file as Maestro names it, whether it failed, and whether it failed for want
 * of a driver.
 */
export function reportCases(/** @type {string} */ xml) {
  return [...xml.matchAll(CASE)].map((m) => {
    const failure = /<(failure|error)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/.exec(m[2] ?? '');
    const failed = Boolean(failure) || ['ERROR', 'FAILURE', 'FAILED'].includes((attr(m[1], 'status') ?? '').toUpperCase());
    return { name: attr(m[1], 'name') ?? '', file: attr(m[1], 'file'), failed, noDriver: failed && noDriver(failure?.[0]) };
  });
}

/**
 * What a run does once a start of Maestro has ended. `last` is that start's
 * own report, `report` the run's report so far (the same, after the first
 * start), `earlier` the flows the driver stopped at in the starts before.
 *
 * Null when the driver did not stop. Else `at`, the flow it stopped at (the
 * first without a result: those after it never started), and `again`, the
 * flows for a new driver, in the order they first ran: every flow still
 * without a result, less a flow the driver has now stopped at twice. That one
 * keeps "no result", so that the flows after it get theirs.
 * @returns {{ at: string; again: string[] } | null}
 */
export function driverStop(/** @type {string} */ report, /** @type {string} */ last, /** @type {string[]} */ earlier = []) {
  const at = reportCases(last).find((c) => c.noDriver)?.name;
  if (at === undefined) return null;
  const twice = new Set([...earlier, at].filter((name, i, all) => all.indexOf(name) !== i));
  return { at, again: reportCases(report).filter((c) => c.noDriver && !twice.has(c.name)).map((c) => c.name) };
}

/**
 * A run's report once new drivers have run what a stopped one left. `first`
 * is the first start's report. `start(stop, n)` starts Maestro a new time (the
 * nth) for the flows `stop.again`, and returns that start's report, or null
 * when it left none. Returns the run's report and `stops`: each time the
 * driver stopped, the flow it stopped at and the flows a new driver then ran
 * (none after the last of NEW_DRIVERS, or when the new start left no report).
 * @param {string} first
 * @param {(stop: { at: string; again: string[] }, n: number) => string | null} start
 */
export function withNewDrivers(first, start) {
  /** @type {{ at: string; again: string[] }[]} */
  const stops = [];
  let report = first;
  let last = first;
  for (;;) {
    const stop = driverStop(report, last, stops.map((s) => s.at));
    if (!stop) break;
    if (stops.length === NEW_DRIVERS || !stop.again.length) {
      stops.push({ at: stop.at, again: [] });
      break;
    }
    const next = start(stop, stops.length + 1);
    stops.push({ at: stop.at, again: next === null ? [] : stop.again });
    if (next === null) break;
    last = next;
    report = mergeReports(report, next);
  }
  return { report, stops };
}

/**
 * The run's report with the flows a new driver ran: each takes the place of
 * the entry it had, in the order of the first start, and the count of
 * failures is made true again.
 */
export function mergeReports(/** @type {string} */ report, /** @type {string} */ again) {
  const newer = new Map([...again.matchAll(CASE)].map((m) => [attr(m[1], 'name'), m[0]]));
  const merged = report.replace(CASE, (whole, attrs) => newer.get(attr(attrs, 'name')) ?? whole);
  const failed = reportCases(merged).filter((c) => c.failed).length;
  return merged.replace(/(<testsuite\b[^>]*?\sfailures=")\d+(")/, (_, before, after) => `${before}${failed}${after}`);
}
