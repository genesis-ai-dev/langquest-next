import { joinUri, parseJoinCode, parseKey, type JoinCode } from '../src/invites/inviteCode';
import { heldJoinCode, holdJoinCode, onJoinCode, takeJoinCode } from '../src/invites/heldJoinCode';

/**
 * A teammate's Let someone in code (src/invites/inviteCode.ts; docs/nearby-sync-plan.md 14.1, 3):
 * how to reach the inviter's phone, a one-time secret and a pin on its opening, and nothing else,
 * in the app's own scheme only. The one scanner reads it before anything else, so it is never
 * taken for an invite.
 */

const code: Omit<JoinCode, 'kind'> = {
  network: 'wifi-direct', ssid: 'DIRECT-xy-LangQuest', passphrase: 'aB3dE6gH9k', port: 41234, secret: 'q83vEjZbC1dXmnH_kL-0aw', pin: 'AAECAwQFBgcICQoLDA0ODw'
};

describe('a Let someone in code', () => {
  it('reads back what was made, about 120 characters, and the scanner says it is one', () => {
    const uri = joinUri(code);
    expect(uri.startsWith('langquestnext://join?v=1&t=wifi-direct&')).toBe(true);
    expect(uri.length).toBeLessThan(160);
    expect(parseJoinCode(uri)).toEqual({ kind: 'join', ...code });
    expect(parseKey(uri)).toEqual({ kind: 'join', ...code });
    // A network name or passphrase with characters a query would break on.
    const odd = { ...code, network: 'hotspot' as const, ssid: 'AndroidShare & co=1', passphrase: 'p#ss w0rd%&=?' };
    expect(parseJoinCode(joinUri(odd))).toEqual({ kind: 'join', ...odd });
  });

  it('holds no pass, chain or key: a field it does not know is no part of it', () => {
    const read = parseJoinCode(`${joinUri(code)}&pass=eyJ`);
    expect(read).toEqual({ kind: 'join', ...code });
    expect(Object.keys(read!).sort()).toEqual(['kind', 'network', 'passphrase', 'pin', 'port', 'secret', 'ssid']);
  });

  it('refuses anything else: another version, kind, scheme, a bad port, secret or pin, a repeated field', () => {
    const uri = joinUri(code);
    for (const bad of [
      uri.replace('v=1', 'v=2'), uri.replace('t=wifi-direct', 't=bluetooth'), uri.replace('langquestnext://', 'https://next.langquest.org/'),
      uri.replace('h=41234', 'h=0'), uri.replace('h=41234', 'h=70000'), uri.replace('h=41234', 'h=12a'), uri.replace(code.secret, 'short'),
      uri.replace(code.pin, `${code.pin.slice(0, 21)}B`), uri.replace(`p=${code.passphrase}`, 'p=short'), uri.replace(`s=${code.ssid}`, 's='),
      `${uri}&v=1`, uri.replace('&k=', '&k'), `${uri}#x`, 'langquestnext://join?', ''
    ]) {
      expect(parseJoinCode(bad)).toBeNull();
    }
  });

  it('is held once for the screen that joins, in memory only', () => {
    const heard: number[] = [];
    const off = onJoinCode(() => heard.push(1));
    expect(takeJoinCode()).toBeNull();
    holdJoinCode({ kind: 'join', ...code }, 5);
    expect(heldJoinCode()).toEqual({ code: { kind: 'join', ...code }, at: 5 });
    expect(takeJoinCode()?.at).toBe(5);
    expect(takeJoinCode()).toBeNull();
    off();
    holdJoinCode({ kind: 'join', ...code });
    expect(heard).toEqual([1]);
    takeJoinCode();
  });
});
