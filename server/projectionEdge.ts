import { createClient } from '@supabase/supabase-js';
import { runProjections, deliverPushes, ProjectionFailed, type ProjectionCounts, type PushCounts } from './projectionWorker';
import { errorClassOf, jobRunSink } from './jobRuns';

/** The failure most sends of a pass ended in, as its error class. */
function commonest(p: PushCounts): string {
  const codes = { http_4xx: p.failHttp4xx, http_5xx: p.failHttp5xx, timeout: p.failTimeout, unreachable: p.failUnreachable, ticket_error: p.failTicket };
  return Object.entries(codes).sort((a, b) => b[1] - a[1])[0]![0];
}

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
/** Compared by digest, so the time taken says nothing about the secret (as apps/web/worker/index.ts does). */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('PROJECTION_WORKER_SECRET');
  if (!secret || !(await sameSecret(request.headers.get('x-worker-secret') ?? '', secret))) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const service = createClient(url, key, { auth: { persistSession: false } });
  // Each pass leaves a job run (diag.jobs, docs/diagnostics.md): what it did,
  // and when it fails, what failed and at which language. The write is
  // awaited, so it is not cut off when the function answers, and gives up
  // after a few seconds.
  const record = jobRunSink(url, key);
  const startedAt = Date.now();
  // Two cron jobs call this (20261007200001_schedule_push_delivery.sql): the
  // projection pass every five minutes, and push delivery every minute, so a
  // phone hears of a join request without waiting for a pass (decisions.md 68).
  const body = await request.json().catch(() => ({})) as { task?: string };
  const counts: ProjectionCounts = { orgs: 0, projected: 0 };
  try {
    if (body.task === 'pushes') {
      const pushes = await deliverPushes(service);
      // Every send failed: Expo is down or refusing us, which is the job failing.
      const allFailed = pushes.failed > 0 && pushes.sent === 0;
      await record({
        job: 'push_delivery', startedAt, ms: Date.now() - startedAt,
        outcome: allFailed ? 'error' : pushes.failed || pushes.receiptsError ? 'partial' : 'ok', n: { ...pushes },
        ...(allFailed ? { errorClass: commonest(pushes) } : {})
      });
    } else {
      // Large languages are projected by the scheduled job instead (decisions.md 103).
      const done = await runProjections(service, 'small', counts);
      await record({
        job: 'projection', startedAt, ms: Date.now() - startedAt, outcome: 'ok',
        n: { ...counts, languages: done.languages, snapshots: done.snapshots, failed: 0 }
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const stoppedAt = error instanceof ProjectionFailed ? error : null;
    await record({
      job: body.task === 'pushes' ? 'push_delivery' : 'projection', startedAt, ms: Date.now() - startedAt, outcome: 'error',
      errorClass: errorClassOf(error),
      ...(body.task === 'pushes' ? {} : { n: { ...counts, failed: 1 } }),
      ...(stoppedAt ? { orgId: stoppedAt.orgId, streamId: stoppedAt.streamId } : {})
    });
    console.error('Projection worker failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Projection pass failed. Retry after checking worker logs.' }, { status: 500 });
  }
});
