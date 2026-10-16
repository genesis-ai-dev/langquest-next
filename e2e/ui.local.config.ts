// Local only (not committed): the UI suite against this worktree's release export served by its Worker on 8351, no web servers started.
process.env['UI_PORT'] = '8351';
process.env['PW_CHROME'] = '1';
const base = (await import('./ui.config')).default;
export default { ...base, webServer: undefined, workers: 1 };
