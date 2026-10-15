import { createClient } from '@supabase/supabase-js';
import { runProjections, deliverPushes } from './projectionWorker';

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
  const service = createClient(Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  // Two cron jobs call this (20261007200001_schedule_push_delivery.sql): the
  // projection pass every five minutes, and push delivery every minute, so a
  // phone hears of a join request without waiting for a pass (decisions.md 68).
  const body = await request.json().catch(() => ({})) as { task?: string };
  try {
    if (body.task === 'pushes') await deliverPushes(service);
    // Large languages are projected by the scheduled job instead (decisions.md 103).
    else await runProjections(service, 'small');
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Projection worker failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Projection pass failed. Retry after checking worker logs.' }, { status: 500 });
  }
});
