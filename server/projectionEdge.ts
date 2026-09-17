import { createClient } from '@supabase/supabase-js';
import { runProjections, deliverPushes } from './projectionWorker';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
Deno.serve(async (request) => {
  const secret = Deno.env.get('PROJECTION_WORKER_SECRET');
  if (!secret || request.headers.get('x-worker-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const service = createClient(Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    await runProjections(service);
    await deliverPushes(service);
    return Response.json({ ok: true });
  } catch (error) {
    console.error('Projection worker failed', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Projection pass failed. Retry after checking worker logs.' }, { status: 500 });
  }
});
