// Ported from aquilla/smart-tests/driver.ts (same Jev pin, same bridge).
// Playwright owns the browser; Jev owns observation and decisions over CDP.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const directory = path.dirname(fileURLToPath(import.meta.url));

interface AgentAction { kind: string; label: string; text: string | null }

interface AgentRun {
  status: string;
  steps: Record<string, unknown>[];
  actions: AgentAction[];
  modelCalls: { kind: string; model: string; elapsedMs: number; usage: Record<string, number> }[];
  elapsedMs: number;
}

/** Pages already logging console output under SMART_DEBUG. */
const debugged = new WeakSet<Page>();

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
  if (process.env['SMART_DEBUG'] && !debugged.has(page)) {
    debugged.add(page);
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text().slice(0, 500)}`); });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message.slice(0, 500)}`));
  }
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

/** Attach and print a journey's outcome with the driver's action log, as the first journeys do. */
export async function reportRun(page: Page, run: AgentRun, outcome: { verdict: string; checks: { name: string; ok: boolean; detail?: string }[] }): Promise<void> {
  const { test } = await import('@playwright/test');
  await test.info().attach('outcome.json', { contentType: 'application/json', body: JSON.stringify({
    jev: { status: run.status, actions: run.actions, elapsedMs: run.elapsedMs, modelCalls: run.modelCalls.length },
    outcome
  }, null, 2) });
  console.log(`[outcome] ${outcome.verdict} (jev: ${run.status}, ${run.actions.length} actions)`);
  for (const c of outcome.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`[jev actions] ${run.actions.map((a) => `${a.kind}:${a.label}${a.text ? `=${JSON.stringify(a.text)}` : ''}`).join(' → ')}`);
  for (const step of run.steps.filter((x) => x['operation'] === 'ERROR')) console.log(`[jev error] ${step['error']}: ${step['reason']}`);
  if (process.env['SMART_DEBUG']) {
    for (const step of run.steps.slice(-(Number(process.env['SMART_DEBUG']) || 3))) console.log(`[jev step] ${JSON.stringify(step).slice(0, 3000)}`);
    for (const step of run.steps) console.log(`[jev seen] ${String((step['observation'] as { text?: string } | undefined)?.text ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
    await page.waitForTimeout(3000);
    console.log(`[screen after 3s] ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
    // Controls Jev would refuse to press: centre off-screen or covered by another element.
    const covered = await page.evaluate(() => [...document.querySelectorAll('[role=button],button,input,textarea')].flatMap((e) => {
      const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (!r.width || !r.height) return [];
      const top = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? document.elementFromPoint(x, y) : null;
      return e.contains(top) ? [] : [`${e.getAttribute('aria-label') ?? e.tagName} @${Math.round(x)},${Math.round(y)} under ${top ? `${top.tagName}.${top.className}`.slice(0, 80) + ` "${top.getAttribute('aria-label') ?? ''}"` : 'off-screen'}`];
    }));
    console.log(`[unreachable] ${covered.join(' | ') || 'none'}`);
    const cover = await page.evaluate(() => {
      const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      const out: string[] = [];
      for (let e = top; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.opacity !== '1' || cs.visibility !== 'visible' || e.getAttribute('aria-hidden')) out.push(`${e.tagName} opacity=${cs.opacity} vis=${cs.visibility} aria-hidden=${e.getAttribute('aria-hidden')} aria-modal=${e.getAttribute('aria-modal')}`);
      }
      return `${top?.getAttribute('aria-label') ?? top?.tagName} visible=${top?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })}; ${out.join(' < ')}`;
    });
    console.log(`[centre] ${cover}`);
    console.log(`[stop] ${await page.evaluate(() => [...document.querySelectorAll('[aria-label="Stop recording and review take"]')].map((e) => {
      const r = e.getBoundingClientRect();
      return `rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} hiddenBy=${e.closest('[aria-hidden="true"],[inert]')?.outerHTML.slice(0, 120) ?? 'none'} visible=${e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })}`;
    }).join(' | ') || 'no stop button')}`);
    await page.screenshot({ path: test.info().outputPath('final.png') });
  }
  console.log(`[final screen] ${await page.title()} · ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`);
}
