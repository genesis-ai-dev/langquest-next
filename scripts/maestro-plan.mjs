/**
 * Which phone flows a run can hold (scripts/maestro-ui.mjs, decision 102).
 *
 * Some flows cannot pass unattended: they need a microphone signal (tag
 * `voice`), Android's airplane mode (tag `android-only`), or a step from
 * outside mid-run (tag `wrapped`). Running them anyway reports failures that
 * are not findings, and hides the ones that are. So the runner skips them,
 * says so, and runs them only when the run says it can: `--voice` or
 * `--mic`, `--platform android`, `--wrapped`. Flows named with `--flow` are
 * run as asked.
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
    why: 'turn on airplane mode, which the iOS simulator cannot: run with --platform android'
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
