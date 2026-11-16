import type { AnyEvent } from '../src/events';
import type { BatchManifest } from '../src/nearbySigning';

/**
 * The golden vectors for nearby sync (docs/nearby-sync-plan.md 5.12). The expected
 * texts are written out by hand, and the digests and signatures came from Python's
 * hashlib and Node's Ed25519, not from the code they check. The Worker's tests read
 * these same ones. A change here means phones in the field can no longer read what
 * they signed, so a new form gets a new prefix instead.
 */
export const PROFILE = '11111111-1111-4111-8111-111111111111';
const COMMAND = `by:${PROFILE}:22222222-2222-4222-8222-222222222222`;

/** Ed25519, from a seed of 32 bytes of 0x01. */
export const SEED_HEX = '01'.repeat(32);
export const PUBLIC_KEY = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w';

/** No parent; a string that needs escaping and characters of two, three and four bytes. */
export const EVENT_NO_PARENT = {
  id: `${COMMAND}:0`, type: 'v1.NoteAdded', orgId: 'org1', streamId: 'lang1', actorId: PROFILE, deviceId: 'dev-a', hlc: '001700000000000:000000:dev-a',
  payload: { unitId: 'u1', text: 'Yé 👋 "q"\n', noteId: `note:${COMMAND}`, anchor: { kind: 'passage' } }
} as unknown as AnyEvent;
export const EVENT_NO_PARENT_TEXT = `{"actorId":"${PROFILE}","deviceId":"dev-a","hlc":"001700000000000:000000:dev-a","id":"${COMMAND}:0","orgId":"org1","payload":{"anchor":{"kind":"passage"},"noteId":"note:${COMMAND}","text":"Yé 👋 \\"q\\"\\n","unitId":"u1"},"streamId":"lang1","type":"v1.NoteAdded"}`;
export const EVENT_NO_PARENT_DIGEST = '428ca570e5696f8fb6c2549a0cfde39bcbef941594b536139306f494c7017d60';

/** A parent, and a `serverSeq` that the digest leaves out. */
export const EVENT_PULLED = {
  id: 'e2', type: 'v1.TakeArchived', orgId: 'org1', streamId: 'lang1', actorId: PROFILE, deviceId: 'dev-a', hlc: '001700000001000:000000:dev-a',
  parentEventId: 'e1', payload: { takeId: 't1' }, serverSeq: 78
} as unknown as AnyEvent;
export const EVENT_PULLED_TEXT = `{"actorId":"${PROFILE}","deviceId":"dev-a","hlc":"001700000001000:000000:dev-a","id":"e2","orgId":"org1","parentEventId":"e1","payload":{"takeId":"t1"},"streamId":"lang1","type":"v1.TakeArchived"}`;
export const EVENT_PULLED_DIGEST = '58a62d3f256b3201b4c94e0dca208e2fe788fd7978bd5d7450f0c1e21b01364e';

export const MANIFEST: BatchManifest = {
  v: 1, orgId: 'org1', streamId: 'lang1', key: PUBLIC_KEY, deviceId: 'dev-a', actorId: PROFILE, n: 3, floor: 1,
  events: [[`${COMMAND}:0`, EVENT_NO_PARENT_DIGEST], ['e2', EVENT_PULLED_DIGEST]]
};
export const MANIFEST_TEXT = `{"actorId":"${PROFILE}","deviceId":"dev-a","events":[["${COMMAND}:0","${EVENT_NO_PARENT_DIGEST}"],["e2","${EVENT_PULLED_DIGEST}"]],"floor":1,"key":"${PUBLIC_KEY}","n":3,"orgId":"org1","streamId":"lang1","v":1}`;
/** Over `lq-nearby-batch-v1\n` and `MANIFEST_TEXT`. */
export const MANIFEST_SIG = 'uC19xKV5b8o--AyBWMUzle9PTpJe_KY1YNV5Vgo6NmEYNLJapltB6nqVUJh7CLPgSKWLC9Aj50gHZIaoOjHaCQ';

export const ATTESTATION_TEXT = `{"kid":"k1","orgId":"org1","rows":[["${COMMAND}:0","${EVENT_NO_PARENT_DIGEST}",77],["e2","${EVENT_PULLED_DIGEST}",78]],"streamId":"lang1","v":1}`;
export const REVOCATION_TEXT = `{"keys":[["${PUBLIC_KEY}","${PROFILE}",1700000000000]],"kid":"k1","orgId":"org1","seq":4,"v":1}`;

export const HOLDINGS_FILES = ['a'.repeat(64), 'b'.repeat(64)];
export const HOLDINGS_FILES_HASH = '2ba3056e95d23c0c154eca683e330401c46e441d5074523e16349e29d7597a64';
/** Version 2 says whether the owner's "Hold teammates' recordings" row is on; version 1 never reached a store build. */
export const HOLDINGS_TEXT = `{"counter":5,"filesHash":"${HOLDINGS_FILES_HASH}","hold":true,"key":"${PUBLIC_KEY}","orgId":"org1","streamId":"lang1","v":2}`;

/** The hash of `lq-nearby-newcomer-v1\n`, the decoded key, then the 16 salt bytes 0 to 15. */
export const NEWCOMER_SALT = 'AAECAwQFBgcICQoLDA0ODw';
export const NEWCOMER_HASH = '0ce1daeec982e3f32357aa12ac36414dba232083b8f9ce840d377075b33d2a8f';
/** Its first 16 bytes, with version 4 and variant bits set: 0xe3 becomes 0x43, and 0x23 becomes 0xa3. */
export const NEWCOMER_ID = '0ce1daee-c982-43f3-a357-aa12ac36414d';

/** 2023-11-14 falls in window 218. */
export const PASS_NOW_MS = 1700000000000;
export const PASS_WINDOW = 218;
export const PASS_EXPIRES_AT = 1702944000000;
export const PASS_ID_TEXT = `{"inviter":"${PROFILE}","inviterKey":"${PUBLIC_KEY}","languageId":"lang1","orgId":"org1","window":218}`;
export const PASS_ID = 'eab02b990e75aeef3c161424ee218e55';

/** Its hash starts 5f, so the summary shows the two top bits cleared. */
export const SUMMARY_TEXT = `{"h":{"${PUBLIC_KEY}":3},"k":9,"r":1,"v":{"${PUBLIC_KEY}":{"ahead":[[5,6]],"mark":2}}}`;
export const SUMMARY = '1f1d85db';

/** Bytes for the opening: `kOpen` of 0x09, salt 0 to 5, then each nonce and ephemeral key a repeated byte. */
export const OPENING = {
  kOpen: '09'.repeat(32), salt: '000102030405', nonceI: '11'.repeat(32), ephI: '22'.repeat(32), nonceR: '33'.repeat(32), ephR: '44'.repeat(32),
  i: '111111111111111111111111111111111111111111111111111111111111111146a993867de656374e989d5edcfe3b344c5cc6416b71d66a31c8e4b85c5c687a289930e269d1d9d93d5260d2a90c9316',
  r: '33333333333333333333333333333333333333333333333333333333333333332cb013794561667ebbddd5c105f21a463953a19eea9c8f9fc8b1dc4b4e2c6f830f642e70d7fdbabce205a348807d91cb',
  th: '10e57d5908136bd37a7c06de41530498c4e2408c1749ebf17556b568b846f6eb'
};

/**
 * A Wi-Fi attempt's keys (5.12, Session keys): `HKDF-SHA256(ikm = wifi i to r || wifi r to i,
 * salt = '', info = 'lq-nearby-attempt-v1\n' || the attempt's place in the plan, 64 bytes)`, i to r
 * then r to i, from Wi-Fi keys of 0x55 and 0x66. Made with Python's hmac.
 */
export const ATTEMPT_KEYS = {
  wifi: { iToR: '55'.repeat(32), rToI: '66'.repeat(32) },
  attempts: [
    { attempt: 0, iToR: '350ff6b8e917752bd51cfd719027720f7a803f514a2593b31e04cc915056c492', rToI: '700d57cd8afdaa5839cc08ed6acf3edf46814edf198c706d2718898ad19c8d05' },
    { attempt: 1, iToR: '686118a8949f7256c0f6495a1a8db348b327122bebe37333f617e87683ff37de', rToI: 'cf216b14b335447a20b2b0de05eaa8f1410314db27206733b0f64e45c6ee2aa0' }
  ]
};

/** A generation's key, then the three below it (`key(g - 1) = SHA-256('lq-nearby-gen-v1' || key(g))`). The migration's vector is the same. */
export const GENERATIONS = ['BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', 'ZKxHYBpq0T77wN5AfJJc7t_0qrA041KqcKWrV2JAl10', '8Fjjxvz7bHRokg2U6V91J8qKQ8oLNCHdzOQb2XZQVx8', '0-wAuKHDruwZMVUSkqDDdTTYHQBxTLaIbtwivjANPCI'];

/** The two pictures (phase 6) from `OPENING.th`, worked out with Python: the hash under the pictures prefix, its first nibble, then the next that differs. */
export const PICTURES_HASH = '70883f5387382d5599180c3cf6cdff92911a194346b860a7e1a463ee52d14860';
export const PICTURES = [7, 0] as const;
/** A `th` whose hash starts with two equal nibbles (eec5...), so the second picture is the third nibble. */
export const PICTURES_SAME_TH = '0000000000000000000000000000000000000000000000000000000000000001';
export const PICTURES_SAME = [14, 12] as const;

/** A worker link, then an invite link holding its pass. Signed with Node's Ed25519: the root from a seed of 0x03, the inviter from a seed of 0x02. The newcomer is `PUBLIC_KEY`. */
export const CHAIN_ROOT_KEY = '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E';
export const CHAIN_INVITER_KEY = 'gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q';
const CHAIN_WORKER_LINK = {
  kind: 'worker@1', kid: 'k1',
  body: {
    installKey: CHAIN_INVITER_KEY, profileId: PROFILE, deviceId: '33333333-3333-4333-8333-333333333333', expiresAt: 1730000000000,
    org: { orgId: 'org1', orgSeq: 40, scopes: [{ level: 'language', languageId: 'lang1', privileges: ['invite_members', 'translate', 'review'] }] }
  },
  sig: 'F81YdxgylOyjNXbm3gNwzHpM31FG_a2NarNEStOL1YMK9ZG60UP64bKN9Ibh0v1VsRhYryzu8vRlB1-Xc_mnBg'
} as const;
const CHAIN_PASS = {
  kind: 'pass@1', kid: 'k1',
  body: {
    passId: 'ab'.repeat(16), orgId: 'org1', languageId: 'lang1', inviter: PROFILE, inviterKey: CHAIN_INVITER_KEY,
    roles: [{ roleId: 'translator', privileges: ['translate'] }], maxUses: 3, expiresAt: PASS_EXPIRES_AT
  },
  sig: '4Dm8Fju36m_dHts0_jZrm1x9IG4wCkCessawDYad3_OxlLZzYw5BuEv2tAAi__FdHa-twkttm2ziToJHCKlxBg'
} as const;
const CHAIN_INVITE_LINK = {
  kind: 'invite@1',
  body: {
    pass: CHAIN_PASS, installKey: PUBLIC_KEY, idSalt: NEWCOMER_SALT, profileId: NEWCOMER_ID, deviceId: '44444444-4444-4444-8444-444444444444', name: 'Yé',
    roleId: 'translator', privileges: ['translate']
  },
  sig: '7QqkCvIjMKzzYIeA7S6bj_uvpoxHwYYJ3NeCztznHmXXsZzuhEg_Lq8DQ1OB5Cb1CejFKS1BwrVKT0SR_-s-DQ'
} as const;
export const CHAIN: readonly unknown[] = [CHAIN_WORKER_LINK, CHAIN_INVITE_LINK];
