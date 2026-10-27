// The script only builds SQL; what staff may decide is held by server/orgVerificationSmoke.sql.
import { parseArgs, requestId } from './org-verification';

describe('npm run org-verification (decisions.md 173)', () => {
  it('reads the command, its target and where to work', () => {
    expect(parseArgs(['grant', '6f1c2d3e-0000-4000-8000-000000000001', '--hosted'])).toEqual({
      command: 'grant', target: '6f1c2d3e-0000-4000-8000-000000000001', hosted: true, json: false, workdir: undefined
    });
    expect(parseArgs(['list', 'waiting', '--workdir', '/tmp/stack', '--json'])).toEqual({ command: 'list', target: 'waiting', hosted: false, json: true, workdir: '/tmp/stack' });
    expect(parseArgs([]).command).toBe('list');
  });

  it('takes only a request id as a request, never SQL', () => {
    expect(requestId('6F1C2D3E-0000-4000-8000-000000000001')).toBe("'6f1c2d3e-0000-4000-8000-000000000001'");
    for (const bad of [undefined, 'x', "6f1c2d3e-0000-4000-8000-000000000001'; drop table x; --"]) expect(() => requestId(bad)).toThrow();
  });
});
