#!/usr/bin/env node
// How much of this week's Frontier Claude plan is used
// (docs/decisions/2026-11-21-the-overview-shows-the-frontier-claude-plan.md).
// .github/workflows/claude-plan.yml runs this every hour with the agent
// team's token (AGENT_TEAM_CLAUDE_TOKEN, the Frontier account's
// `claude setup-token`) in CLAUDE_CODE_OAUTH_TOKEN: never as an argument.
//
// Claude's plans give no usage page that this token may read, but Claude Code
// reports the plan's windows with every answer, as a `rate_limit_event` in
// its stream-json output: the share of the week used and when the week
// starts again. So this asks Claude Code one tiny question (Haiku, no tools,
// a one-line system prompt: a few dozen tokens) and keeps only that event.
// It leaves one annotation titled "Claude plan" on the run, which the ops
// dashboard reads (apps/admin/src/sources/claudePlan.ts):
//   {"week":{"used":0.35,"resetsAt":"…"},"fiveHour":null,"status":"allowed","readAt":"…"}
// or, when there is no reading, a message that starts "No reading:".
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Pinned, as claude-code-action pins its own: a new release cannot change what this reads without a pull request. */
export const CLAUDE_CODE = '@anthropic-ai/claude-code@2.1.325';
export const TITLE = 'Claude plan';
const ASK = 'Reply with the one word ok.';

/** The first object under `value` that has a `rate_limit_info`, at any depth. */
function infoIn(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.rate_limit_info && typeof value.rate_limit_info === 'object') return value.rate_limit_info;
  for (const v of Object.values(value)) {
    const found = infoIn(v);
    if (found) return found;
  }
  return null;
}

/** One window as the dashboard takes it, or null when the event has no number for it. */
function windowOf(w) {
  const used = Number(w && w.utilization);
  const at = Number(w && w.resetsAt);
  if (!w || !Number.isFinite(used) || !Number.isFinite(at) || at <= 0) return null;
  return { used, resetsAt: new Date(at * 1000).toISOString() };
}

/**
 * Pure: the newest plan reading in Claude Code's stream-json lines, or null.
 * The event names each window under `unifiedWindows`; an older shape gives
 * only the window that binds now, under `rateLimitType`.
 */
export function readingOf(lines, now = new Date()) {
  let info = null;
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    info = infoIn(m) ?? info;
  }
  if (!info) return null;
  const windows = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : {};
  const binding = { utilization: info.utilization, resetsAt: info.resetsAt };
  const week = windowOf(windows.seven_day) ?? (info.rateLimitType === 'seven_day' ? windowOf(binding) : null);
  const fiveHour = windowOf(windows.five_hour) ?? (info.rateLimitType === 'five_hour' ? windowOf(binding) : null);
  if (!week && !fiveHour) return null;
  return { week, fiveHour, status: typeof info.status === 'string' ? info.status : null, readAt: now.toISOString() };
}

/** Pure: the errors Claude Code's result line gives, joined, or ''. */
export function errorsOf(lines) {
  let said = '';
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (m && m.type === 'result' && Array.isArray(m.errors) && m.errors.length) said = m.errors.map(String).join(' ');
    } catch { /* not a JSON line */ }
  }
  return said;
}

/** The workflow command that leaves the annotation; the message is one line of JSON, or "No reading: …". */
export function annotation(reading, why) {
  if (reading) return `::notice title=${TITLE}::${JSON.stringify(reading)}`;
  return `::warning title=${TITLE}::No reading: ${String(why).replace(/[\r\n%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`;
}

function runClaude() {
  return new Promise((resolve) => {
    const args = ['-y', CLAUDE_CODE, '-p', ASK, '--model', 'haiku', '--output-format', 'stream-json', '--verbose',
      '--max-turns', '1', '--tools', '', '--system-prompt', ASK, '--strict-mcp-config'];
    const child = spawn('npx', args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function main() {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log(annotation(null, 'the workflow has no AGENT_TEAM_CLAUDE_TOKEN.'));
    return;
  }
  const { code, out, err } = await runClaude();
  const reading = readingOf(out.split('\n'));
  if (reading) {
    console.log(`week: ${reading.week ? Math.round(reading.week.used * 100) + '% used, starts again ' + reading.week.resetsAt : 'no number'}`);
    console.log(annotation(reading));
    return;
  }
  // Claude Code's own error, without the token: it never prints the token, and the runner masks secrets too.
  const said = (errorsOf(out.split('\n')) || err.trim().split('\n').pop() || 'no error given').slice(0, 200);
  console.log(annotation(null, code === 0 ? 'Claude Code answered without the plan\'s numbers.' : `Claude Code stopped (exit ${code}): ${said}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
