import { createHash, createHmac, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import fc from 'fast-check';
import type { InviteLink, JoinPass, WorkerLink } from '../src/nearbyChain';
import {
  NEARBY_OPENING_BYTES, NEARBY_PREFIXES, PASS_WINDOW_MS, attestationText, base64urlDecode, base64urlEncode, bytesToHex, certRequestText, concatBytes, eventDigest, eventText, firstContactText, holdingsFilesHash,
  holdingsText, isBase64url, linkText, manifestText, nearbyBytes, newcomerIdBytes, openingMaskInput, openingTagInputI, openingTagInputR, passIdOf, passIdText, passText, passWindowAt, proofText, revocationText,
  sameEventBytes, summaryOf, transcriptInput
} from '../src/nearbySigning';
import type { AnyEvent } from '../src/events';
import * as v from './nearbyVectors';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

describe('the texts phones sign, as golden vectors', () => {
  it('an event digest leaves out serverSeq, and an absent parent stays absent', async () => {
    expect(eventText(v.EVENT_NO_PARENT)).toBe(v.EVENT_NO_PARENT_TEXT);
    expect(await eventDigest(v.EVENT_NO_PARENT, sha256)).toBe(v.EVENT_NO_PARENT_DIGEST);
    expect(eventText(v.EVENT_PULLED)).toBe(v.EVENT_PULLED_TEXT);
    expect(await eventDigest(v.EVENT_PULLED, sha256)).toBe(v.EVENT_PULLED_DIGEST);
  });

  it('a row as a phone pulls it and as the Worker reads it give one digest', async () => {
    // Why: the attestation holds a digest the Worker worked out, and a phone checks it against its own row.
    const pulled = { ...v.EVENT_NO_PARENT, serverSeq: 77 } as AnyEvent;
    const withNull = { ...v.EVENT_NO_PARENT, parentEventId: null } as unknown as AnyEvent;
    const withUndefined = { ...v.EVENT_NO_PARENT, parentEventId: undefined } as unknown as AnyEvent;
    const withEmpty = { ...v.EVENT_NO_PARENT, parentEventId: '' } as AnyEvent;
    for (const row of [pulled, withNull, withUndefined, withEmpty]) expect(await eventDigest(row, sha256)).toBe(v.EVENT_NO_PARENT_DIGEST);
  });

  it('a manifest is signed as text with plain Ed25519, and a signature for one purpose fails for another', () => {
    expect(manifestText(v.MANIFEST)).toBe(v.MANIFEST_TEXT);
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(v.SEED_HEX, 'hex')]);
    const secret = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const pub = createPublicKey(secret);
    expect(base64urlEncode(new Uint8Array(pub.export({ format: 'der', type: 'spki' }).subarray(-32)))).toBe(v.PUBLIC_KEY);
    expect(base64urlEncode(new Uint8Array(sign(null, nearbyBytes('batch', v.MANIFEST_TEXT), secret)))).toBe(v.MANIFEST_SIG);
    const sig = base64urlDecode(v.MANIFEST_SIG)!;
    expect(verify(null, nearbyBytes('batch', v.MANIFEST_TEXT), pub, sig)).toBe(true);
    expect(verify(null, nearbyBytes('attest', v.MANIFEST_TEXT), pub, sig)).toBe(false);
  });

  it('every purpose has its own prefix', () => {
    const prefixes = Object.values(NEARBY_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(text(nearbyBytes('summary', 'x'))).toBe('lq-nearby-summary-v1\nx');
  });

  it('an attestation and a revocation list', () => {
    const [first, second] = v.MANIFEST.events;
    expect(attestationText({ v: 1, kid: 'k1', orgId: 'org1', streamId: 'lang1', rows: [[first![0], first![1], 77], [second![0], second![1], 78]] })).toBe(v.ATTESTATION_TEXT);
    expect(revocationText({ v: 1, kid: 'k1', orgId: 'org1', seq: 4, keys: [[v.PUBLIC_KEY, v.PROFILE, 1700000000000]] })).toBe(v.REVOCATION_TEXT);
  });

  it('a holdings entry signs the hash of its files', async () => {
    expect(await holdingsFilesHash(v.HOLDINGS_FILES, sha256)).toBe(v.HOLDINGS_FILES_HASH);
    expect(holdingsText({ orgId: 'org1', streamId: 'lang1', key: v.PUBLIC_KEY, counter: 5, filesHash: v.HOLDINGS_FILES_HASH })).toBe(v.HOLDINGS_TEXT);
  });

  it('a newcomer\'s id starts from the decoded key and salt, not their text', () => {
    const bytes = newcomerIdBytes(base64urlDecode(v.PUBLIC_KEY)!, base64urlDecode(v.NEWCOMER_SALT)!);
    expect(bytes.length).toBe('lq-nearby-newcomer-v1\n'.length + 32 + 16);
    expect(hex(sha256(bytes))).toBe(v.NEWCOMER_HASH);
  });

  it('a session proof names the role', () => {
    expect(text(nearbyBytes('proof', proofText('i', v.OPENING.th)))).toBe(`lq-nearby-proof-v1\ni\n${v.OPENING.th}`);
    expect(proofText('r', 'ab')).toBe('r\nab');
  });

  it('a chain link: a worker link has its kid, an invite link has none, and each holds what came before', () => {
    const body = { installKey: v.PUBLIC_KEY, profileId: v.PROFILE, deviceId: 'dev-a', expiresAt: 5, org: { orgId: 'org1', orgSeq: 2, scopes: [{ level: 'org', privileges: ['translate'] }] } };
    const worker = { kind: 'worker@1', kid: 'k1', body, sig: 'ignored' } as WorkerLink;
    expect(linkText(worker, '')).toBe(`{"body":{"deviceId":"dev-a","expiresAt":5,"installKey":"${v.PUBLIC_KEY}","org":{"orgId":"org1","orgSeq":2,"scopes":[{"level":"org","privileges":["translate"]}]},"profileId":"${v.PROFILE}"},"kid":"k1","kind":"worker@1","prev":""}`);
    const pass: JoinPass = { kind: 'pass@1', kid: 'k1', body: { passId: v.PASS_ID, orgId: 'org1', languageId: 'lang1', inviter: v.PROFILE, inviterKey: v.PUBLIC_KEY, roles: [{ roleId: 'translator', privileges: ['translate'] }], maxUses: 3, expiresAt: v.PASS_EXPIRES_AT }, sig: 'S' };
    expect(passText(pass)).toBe(`{"body":{"expiresAt":${v.PASS_EXPIRES_AT},"inviter":"${v.PROFILE}","inviterKey":"${v.PUBLIC_KEY}","languageId":"lang1","maxUses":3,"orgId":"org1","passId":"${v.PASS_ID}","roles":[{"privileges":["translate"],"roleId":"translator"}]},"kid":"k1","kind":"pass@1"}`);
    const invite = { kind: 'invite@1', body: { name: 'N' }, sig: 'ignored' } as unknown as InviteLink;
    expect(linkText(invite, 'PREV')).toBe('{"body":{"name":"N"},"kind":"invite@1","prev":"PREV"}');
  });

  it('a pass\'s id and expiry follow from its window, on the Worker\'s own clock', async () => {
    expect(passWindowAt(v.PASS_NOW_MS)).toEqual({ window: v.PASS_WINDOW, expiresAt: v.PASS_EXPIRES_AT });
    expect(passWindowAt(PASS_WINDOW_MS * 3)).toEqual({ window: 3, expiresAt: PASS_WINDOW_MS * 4 });
    expect(passWindowAt(PASS_WINDOW_MS * 3 - 1).window).toBe(2);
    const fields = { orgId: 'org1', languageId: 'lang1', inviter: v.PROFILE, inviterKey: v.PUBLIC_KEY, window: v.PASS_WINDOW };
    expect(passIdText(fields)).toBe(v.PASS_ID_TEXT);
    expect(await passIdOf(fields, sha256)).toBe(v.PASS_ID);
    expect(await passIdOf({ ...fields, window: v.PASS_WINDOW + 1 }, sha256)).not.toBe(v.PASS_ID);
  });

  it('a certificate request and first contact', () => {
    const who = { profileId: v.PROFILE, deviceId: 'dev-a', publicKey: v.PUBLIC_KEY };
    expect(certRequestText(who)).toBe(`{"deviceId":"dev-a","profileId":"${v.PROFILE}","publicKey":"${v.PUBLIC_KEY}"}`);
    expect(firstContactText({ ...who, requestId: 'r1' })).toBe(`{"deviceId":"dev-a","profileId":"${v.PROFILE}","publicKey":"${v.PUBLIC_KEY}","requestId":"r1"}`);
  });

  it('a summary is four bytes of hash with the top two bits clear', async () => {
    expect(await summaryOf(v.SUMMARY_TEXT, sha256)).toBe(v.SUMMARY);
    await fc.assert(fc.asyncProperty(fc.string(), async (s) => {
      const out = await summaryOf(s, sha256);
      expect(out).toMatch(/^[0-9a-f]{8}$/);
      expect(parseInt(out.slice(0, 2), 16)).toBeLessThan(0x40);
    }), { numRuns: 50 });
  });

  it('sha256 may answer with a promise, as crypto.subtle does on the Worker', async () => {
    expect(await eventDigest(v.EVENT_NO_PARENT, (b) => Promise.resolve(sha256(b)))).toBe(v.EVENT_NO_PARENT_DIGEST);
  });

  it('the opening: exactly 80 bytes each way, bound to the salt and to what came before', () => {
    const { kOpen, salt, nonceI, ephI, nonceR, ephR, i, r, th } = v.OPENING;
    const hmac = (m: Uint8Array) => new Uint8Array(createHmac('sha256', fromHex(kOpen)).update(m).digest());
    const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, k) => x ^ b[k]!);
    const s = fromHex(salt);
    const maskedI = xor(fromHex(ephI), hmac(openingMaskInput('i', s, fromHex(nonceI))));
    const openingI = concatBytes(fromHex(nonceI), maskedI, hmac(openingTagInputI(s, fromHex(nonceI), maskedI)).slice(0, 16));
    expect(hex(openingI)).toBe(i);
    expect(openingI.length).toBe(NEARBY_OPENING_BYTES);
    const maskedR = xor(fromHex(ephR), hmac(openingMaskInput('r', s, fromHex(nonceI), fromHex(nonceR))));
    const openingR = concatBytes(fromHex(nonceR), maskedR, hmac(openingTagInputR(s, openingI, fromHex(nonceR), maskedR)).slice(0, 16));
    expect(hex(openingR)).toBe(r);
    expect(openingR.length).toBe(NEARBY_OPENING_BYTES);
    expect(hex(sha256(transcriptInput(fromHex(ephI), fromHex(ephR), fromHex(nonceI), fromHex(nonceR))))).toBe(th);
  });
});

describe('an event no digest can stand for', () => {
  const nested = (depth: number) => {
    let x: unknown = 1;
    for (let i = 0; i < depth; i++) x = { x };
    return x;
  };

  it('gets an empty digest and no throw, however deep or strange, so it takes the mismatch path', async () => {
    // Why: receiving a batch hashes each event before the door runs, and canonicalJson recurses and throws.
    const base = v.EVENT_NO_PARENT;
    const bad = [
      { ...base, payload: nested(100_000) }, { ...base, payload: { a: Infinity } }, { ...base, payload: { a: 'x\u0000' } }, { ...base, id: 'x\ud800' },
      null, undefined, 'text', 7
    ];
    for (const e of bad) expect(await eventDigest(e as AnyEvent, sha256)).toBe('');
  });
});

describe('sameEventBytes', () => {
  const a = v.EVENT_NO_PARENT;
  const carrying = (payload: unknown) => ({ ...a, payload }) as unknown as AnyEvent;

  it('leaves out serverSeq, an absent parent and key order', () => {
    const reordered = { payload: { anchor: { kind: 'passage' }, noteId: (a.payload as { noteId: string }).noteId, unitId: 'u1', text: 'Yé 👋 "q"\n' }, hlc: a.hlc, deviceId: a.deviceId, actorId: a.actorId, streamId: a.streamId, orgId: a.orgId, type: a.type, id: a.id };
    expect(sameEventBytes(a, reordered as AnyEvent)).toBe(true);
    expect(sameEventBytes(a, { ...a, serverSeq: 9 } as AnyEvent)).toBe(true);
    expect(sameEventBytes(a, { ...a, parentEventId: null } as unknown as AnyEvent)).toBe(true);
    expect(sameEventBytes(a, carrying({ ...a.payload, extra: undefined }))).toBe(true);
  });

  it('tells a copy that matches in hlc and differs anywhere else', () => {
    for (const k of ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc'] as const) expect(sameEventBytes(a, { ...a, [k]: 'other' } as AnyEvent)).toBe(false);
    expect(sameEventBytes(a, { ...a, parentEventId: 'p' } as AnyEvent)).toBe(false);
    for (const payload of [{}, { ...a.payload, text: 'other' }, { ...a.payload, extra: 1 }, { ...a.payload, anchor: { kind: 'other' } }, { ...a.payload, anchor: [] }, { ...a.payload, anchor: null }]) {
      expect(sameEventBytes(a, carrying(payload))).toBe(false);
    }
    const lists = (x: unknown, y: unknown) => sameEventBytes(carrying({ l: x }), carrying({ l: y }));
    expect(lists([1, 2], [1, 2])).toBe(true);
    expect(lists([1, 2], [2, 1])).toBe(false);
    expect(lists([1, 2], [1, 2, 3])).toBe(false);
    expect(sameEventBytes(carrying({ y: 1 }), carrying({ z: 1 }))).toBe(false);
  });

  it('never overflows the stack, whatever the server holds', () => {
    // Why: a pull page compares whatever it is sent, and a throw there would stop every phone's pull.
    const deep = (end: number) => {
      let x: unknown = end;
      for (let i = 0; i < 100_000; i++) x = { x };
      return x;
    };
    expect(sameEventBytes(carrying(deep(1)), carrying(deep(1)))).toBe(true);
    expect(sameEventBytes(carrying(deep(1)), carrying(deep(2)))).toBe(false);
  });
});

describe('plain bytes', () => {
  it('base64url with no padding, as Node writes it', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 70 }), (bytes) => {
      const out = base64urlEncode(bytes);
      expect(out).toBe(Buffer.from(bytes).toString('base64url'));
      expect(base64urlDecode(out)).toEqual(bytes);
    }));
  });

  it('only one text stands for any bytes', () => {
    expect(base64urlDecode('AA')).toEqual(new Uint8Array([0]));
    for (const bad of ['AB', 'A', 'A=', 'AA==', 'A+', 'A/', ' AA', 'é']) expect(base64urlDecode(bad)).toBeNull();
    expect(isBase64url(v.PUBLIC_KEY, 32)).toBe(true);
    expect(isBase64url(v.MANIFEST_SIG, 64)).toBe(true);
    for (const bad of [v.PUBLIC_KEY.slice(0, -1), `${v.PUBLIC_KEY.slice(0, -1)}x`, `${v.PUBLIC_KEY}A`, '__proto__', '', 5, null, undefined, {}]) expect(isBase64url(bad, 32)).toBe(false);
    expect(isBase64url(v.PUBLIC_KEY, 64)).toBe(false);
  });

  it('hex and joining', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(concatBytes(new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });
});
