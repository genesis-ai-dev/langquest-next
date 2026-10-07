// @ts-expect-error plain .mjs script, no types
import { localPort } from '../scripts/with-adb-reverse.mjs';

describe('with-adb-reverse', () => {
  it('forwards the port of a server on this machine', () => {
    expect(localPort('http://127.0.0.1:54421')).toBe(54421);
    expect(localPort('http://localhost:54421/')).toBe(54421);
    expect(localPort('http://[::1]:54421')).toBe(54421);
  });

  it('leaves hosted and missing servers alone', () => {
    expect(localPort('https://abc.supabase.co')).toBeNull();
    expect(localPort('http://10.0.2.2:54421')).toBeNull();
    expect(localPort(undefined)).toBeNull();
    expect(localPort('not a url')).toBeNull();
  });
});
