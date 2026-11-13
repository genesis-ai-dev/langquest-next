import { base64urlDecode, checkChain } from '@langquest-next/core/nearby';
import { CERTIFICATE_PATH, handleNearby } from '../../worker/nearby';
import { nearbySigner, subtleSha256, subtleVerify } from '../../worker/nearbyKeys';

/**
 * A Worker for nearbyWorkerd.test.ts: the Worker's own nearby signer, verify
 * and certificate route, run under workerd, since the root of trust depends on
 * `crypto.subtle` there and Node's is not the same code.
 */
interface Asked {
  jwk: string;
  certKeys: string;
  sign: string;
  verify: { key: string; message: string; sig: string };
  certificate: { body: unknown; facts: unknown; profileId: string; now: number };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const asked = await request.json() as Asked;
    const signer = nearbySigner(asked.jwk, asked.certKeys);
    const ready = await signer;
    if (!ready) return Response.json({ error: 'no signer' }, { status: 500 });
    const signature = await ready.sign(base64urlDecode(asked.sign)!);
    const verified = await subtleVerify(asked.verify.key, base64urlDecode(asked.verify.message)!, asked.verify.sig);
    const res = await handleNearby(new Request(`https://x${CERTIFICATE_PATH}`, {
      method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(asked.certificate.body)
    }), {
      signer: () => signer,
      certificateCaller: async () => asked.certificate.profileId,
      profileOf: async () => asked.certificate.profileId,
      allowed: async () => true,
      facts: async () => ({ data: asked.certificate.facts, error: null }),
      nearbyOn: async () => ({ data: false, error: null }),
      pullAs: async () => [],
      now: () => asked.certificate.now,
      verify: subtleVerify,
      sha256: subtleSha256
    });
    const certificate = await res.json() as { chains: { orgId: string; chain: unknown[] }[] };
    const chain = certificate.chains[0]?.chain ?? [];
    const verdict = await checkChain(chain, {
      rootKeys: new Map([[ready.kid, ready.publicKey]]), orgId: certificate.chains[0]?.orgId ?? '', now: asked.certificate.now, verify: subtleVerify, sha256: subtleSha256
    });
    return Response.json({ runtime: navigator.userAgent, signature, verified, status: res.status, certificate, chainOk: verdict.ok });
  }
};
