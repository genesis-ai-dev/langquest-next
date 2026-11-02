import { describe, expect, it } from 'vitest';
import { GITHUB_ISSUER, githubOidc } from '../worker/githubOidc';
import { FILMED_RULE, handleTutorialFilmed } from '../worker/tutorialFilmed';
import { REVIEW_RULE } from '../worker/tutorialReview';

/** The filming saying its films are in (decisions.md 192): who gets in, and what it starts. */

const NOW = Date.parse('2026-10-30T05:20:00Z');

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));
const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;
const github = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', github.publicKey)), kid: 'k1' };

async function token(claims: Record<string, unknown> = {}) {
  const head = part({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = part({
    iss: GITHUB_ISSUER, aud: FILMED_RULE.audience, exp: NOW / 1000 + 300, nbf: NOW / 1000 - 10,
    repository: 'genesis-ai-dev/langquest-next', workflow_ref: FILMED_RULE.workflowRef, ref: 'refs/heads/main',
    run_id: '40982316800', run_attempt: '1', event_name: 'push', ...claims
  });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', github.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(sig)}`;
}

function door(answer: 'started' | 'running' | 'disabled' = 'started') {
  let intakes = 0;
  const deps = {
    verify: githubOidc(async () => Response.json({ keys: [jwk] }), () => NOW),
    intake: async () => {
      intakes += 1;
      return answer;
    }
  };
  const knock = (headers: Record<string, string> = {}, method = 'POST') =>
    handleTutorialFilmed(new Request('https://next.langquest.org/api/tutorial-filmed', { method, headers }), deps);
  return { knock, intakes: () => intakes };
}

describe('the filming saying its films are in', () => {
  it('lets in the filming workflow run from main, and starts the intake', async () => {
    const d = door();
    const response = await d.knock({ authorization: `Bearer ${await token()}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ intake: 'started' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(d.intakes()).toBe(1);
  });

  it('says when the intake was already going: it takes the films in once more when it ends', async () => {
    const d = door('running');
    expect(await (await d.knock({ authorization: `Bearer ${await token()}` })).json()).toEqual({ intake: 'running' });
  });

  it('refuses no token, the review workflow, a branch and another audience, and starts nothing', async () => {
    const d = door();
    const refused = [
      {},
      { authorization: `Bearer ${await token({ workflow_ref: REVIEW_RULE.workflowRef })}` },
      { authorization: `Bearer ${await token({ ref: 'refs/heads/try-it', workflow_ref: 'genesis-ai-dev/langquest-next/.github/workflows/tutorials.yml@refs/heads/try-it' })}` },
      { authorization: `Bearer ${await token({ aud: REVIEW_RULE.audience })}` },
      { authorization: 'Bearer not-a-token' }
    ];
    for (const headers of refused) expect((await d.knock(headers)).status).toBe(401);
    expect((await d.knock({ authorization: `Bearer ${await token()}` }, 'GET')).status).toBe(405);
    expect(d.intakes()).toBe(0);
  });
});
