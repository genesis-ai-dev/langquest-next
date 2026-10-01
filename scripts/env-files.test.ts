import { projectRef } from './env-files.mjs';

describe('env files', () => {
  it('reads a hosted project ref from its [remotes.<env>] block only', () => {
    const toml = [
      'project_id = "local-name"',
      '[remotes.production]',
      'project_id = "prodref"',
      '',
      '[remotes.preview]',
      '# the develop branch',
      'project_id = "previewref"',
      '[auth]',
      'project_id = "nope"'
    ].join('\n');
    expect(projectRef(toml, 'production')).toBe('prodref');
    expect(projectRef(toml, 'preview')).toBe('previewref');
    expect(projectRef(toml, 'staging')).toBeNull();
  });
});
