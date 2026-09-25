// Ported from aquilla/smart-tests/driver.ts (same Jev pin, same bridge).
// Playwright owns the browser; Jev owns observation and decisions over CDP.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const directory = path.dirname(fileURLToPath(import.meta.url));

export interface AgentAction { kind: string; label: string; text: string | null }

export interface AgentRun {
  status: string;
  steps: Record<string, unknown>[];
  actions: AgentAction[];
  modelCalls: { kind: string; model: string; elapsedMs: number; usage: Record<string, number> }[];
  elapsedMs: number;
}

/** Jev chooses observed actions on this page; the test supplies no selectors or code. */
export async function runJev(page: Page, goal: string, options: {
  timeoutMs?: number;
  maxDecisions?: number;
  /** Called after each action, before Jev observes again. Return true to stop. */
  onAction?: (action: AgentAction) => Promise<boolean>;
} = {}): Promise<AgentRun> {
  if (!process.env['TYPESAFE_API_KEY'] || !process.env['TEXT_MODEL_API_KEY']) {
    throw new Error('Set TYPESAFE_API_KEY and TEXT_MODEL_API_KEY (smart-tests/run.sh loads them).');
  }
  const timeoutMs = options.timeoutMs ?? 90_000;
  const session = await page.context().newCDPSession(page);
  const child = spawn(path.join(directory, '.venv/bin/python'), ['-u', path.join(directory, 'jev_bridge.py')],
    { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const started = Date.now();
  const run: AgentRun = { status: 'incomplete', steps: [], actions: [], modelCalls: [], elapsedMs: 0 };
  const lines = createInterface({ input: child.stdout });
  // Private subprocess output never reaches evidence.
  child.stderr.resume();
  child.stdin.on('error', () => { /* the exit handler records the broken bridge */ });
  let timedOut = false;
  let processError = false;
  const exited = new Promise<number | null>((resolve) => {
    child.on('error', () => { processError = true; resolve(null); });
    child.on('exit', resolve);
  });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const reply = (result: unknown) => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ result }) + '\n');
  };
  const refuse = (error: string) => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ error }) + '\n');
  };
  child.stdin.write(JSON.stringify({
    url: page.url(), goal, max_decisions: options.maxDecisions ?? 60, timeout_seconds: timeoutMs / 1000
  }) + '\n');
  try {
    for await (const line of lines) {
      const message = JSON.parse(line);
      if (message.type === 'cdp') {
        try { reply(await session.send(message.method, message.params)); }
        catch { refuse('Browser command failed'); }
      } else if (message.type === 'ready') {
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
          await page.waitForFunction(() => !Array.from(document.querySelectorAll('[aria-busy="true"]'))
            .some((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight
                && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
            }),
          undefined, { timeout: 15_000 });
          reply({});
        } catch { refuse('Loading state did not settle'); }
      } else if (message.type === 'action') {
        run.actions.push(message.action);
        reply({ stop: await options.onAction?.(message.action) ?? false });
      } else if (message.type === 'step') {
        run.steps.push(message.step);
        console.log(`[Jev] ${message.step.actions} actions · ${message.step.operation} · ${message.step.elapsed_ms} ms`);
      } else if (message.type === 'model_call') {
        run.modelCalls.push(message.call);
      } else if (message.type === 'result') {
        run.status = message.status;
      } else if (message.type === 'error') {
        run.status = 'driver_error';
        run.steps.push({ operation: 'ERROR', error: message.error, reason: message.reason });
      }
    }
    const code = await exited;
    if (timedOut) run.status = 'timed_out';
    else if (processError || code !== 0) run.status = 'driver_error';
    return run;
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    lines.close();
    await session.detach().catch(() => {});
    run.elapsedMs = Date.now() - started;
  }
}
