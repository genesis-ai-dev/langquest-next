// Avatar U, extended offline use: the app has synced once, then the server
// becomes unreachable. The translator records; the app restarts while still
// offline; the server comes back. The take must survive every step and then
// sync completely. Only the server is cut off: the app shell keeps loading,
// as an installed app does on a phone with no signal.
import { expect, test, type BrowserContext } from '@playwright/test';
import { runJev } from '../driver';
import { deviceBlobs, deviceLog, serverEvents, settle } from '../evidence';
import { recordPassage } from '../goals';
import { accountForDriver, judgeOfflineRecording, judgeRecording, type RecordingEvidence } from '../outcome';
import { openAs, seedTranslatorWorld, waitForLog } from '../world';

const SERVER = new URL(process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');

async function cutServer(context: BrowserContext): Promise<() => Promise<void>> {
  const http = `${SERVER.origin}/**`;
  await context.route(http, (route) => route.abort('internetdisconnected'));
  await context.routeWebSocket((url) => url.host === SERVER.host, (ws) => ws.close());
  return async () => {
    await context.unroute(http);
    // Sockets opened while offline stay closed; the app reconnects on its own.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  };
}

test('translator records offline, restarts offline, and the take syncs on reconnect', async ({ page, context }) => {
  const world = await seedTranslatorWorld();
  const passage = world.passages[0]!;
  const contract = { actorId: world.translator.id, unitIds: [passage.unitId], laneId: world.laneId };
  await openAs(page, world, world.translator);
  // Local-first starts with one sync: wait until the project is on the device.
  await settle(() => deviceLog(page, world.orgId, world.projectId),
    (rows) => rows.some((r) => r.event.type === 'v1.AssignmentMade'), 30_000);
  const blobsBefore = await deviceBlobs(page);

  const reconnect = await cutServer(context);
  const read = async (): Promise<RecordingEvidence> => ({
    device: await deviceLog(page, world.orgId, world.projectId), blobsBefore,
    blobsAfter: await deviceBlobs(page), server: await serverEvents(world.projectId)
  });

  const run = await runJev(page, recordPassage(passage.label), { timeoutMs: 60_000, maxDecisions: 25 });
  const offline = await read();

  await page.reload();
  await waitForLog(page);
  // Let the restarted app try (and fail) to sync before reading.
  await page.waitForTimeout(3_000);
  const afterRestart = await read();

  await reconnect();
  const online = await settle(read, (e) => judgeRecording(contract, e).verdict === 'passed', 60_000);
  const outcome = accountForDriver(judgeOfflineRecording(contract, { offline, afterRestart, online }), run.status);

  await test.info().attach('outcome.json', { contentType: 'application/json', body: JSON.stringify({
    jev: { status: run.status, actions: run.actions, elapsedMs: run.elapsedMs, modelCalls: run.modelCalls.length },
    outcome
  }, null, 2) });
  console.log(`[outcome] ${outcome.verdict} (jev: ${run.status}, ${run.actions.length} actions)`);
  for (const c of outcome.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  console.log(`[jev actions] ${run.actions.map((a) => `${a.kind}:${a.label}`).join(' → ')}`);
  for (const step of run.steps.filter((x) => x['operation'] === 'ERROR')) console.log(`[jev error] ${step['error']}: ${step['reason']}`);
  expect(outcome.verdict, 'inconclusive means Jev never recorded offline; see the action log').not.toBe('inconclusive');
  expect(outcome.verdict).toBe('passed');
});
