// The script only builds SQL; what staff and admins may do is held by server/publisherImportSmoke.sql.
import { importerOf, IMPORTERS, parseArgs } from './publisher-import';

describe('npm run publisher-import (decisions.md 174)', () => {
  it('reads the command, the organization, the importer and where to work', () => {
    expect(parseArgs(['grant', 'org-wc', 'fia', '--source', 'WordCollective', '--hosted'])).toEqual({
      command: 'grant', org: 'org-wc', importer: 'fia', source: 'WordCollective', hosted: true, json: false, workdir: undefined
    });
    expect(parseArgs(['list', '--workdir', '/tmp/stack', '--json'])).toMatchObject({ command: 'list', hosted: false, json: true, workdir: '/tmp/stack' });
    expect(parseArgs([]).command).toBe('list');
  });

  it('takes only an importer it knows, each with where it reads from', () => {
    expect(importerOf('fia')).toBe('fia');
    expect(IMPORTERS['fia']!.source).toBe('BibleAquifer');
    for (const bad of [undefined, 'door43', "fia'; drop table x; --"]) expect(() => importerOf(bad)).toThrow();
  });
});
