import { refusalKind } from '../src/diagnostics/refusalModel';

describe('what a failed server call means, from its code and status', () => {
  it.each([
    [{ code: '42501', message: 'x' }, 'not_allowed'],
    [{ code: '22023', message: 'x' }, 'invalid'],
    [{ code: '23514', message: 'x' }, 'invalid'],
    [{ code: '23505', message: 'x' }, 'conflict'],
    [{ code: 'PGRST301', message: 'x' }, 'other'],
    [{ code: 'PGRST002', message: 'x' }, 'server'],
    [{ code: '57014', message: 'x' }, 'server'],
    [{ code: '53300', message: 'x' }, 'server'],
    [{ code: '', message: 'Failed to fetch' }, 'offline'],
    [{ message: 'x' }, 'offline'],
    [{ name: 'OfflineError', message: 'x' }, 'offline'],
    [{ status: 503, message: 'x' }, 'server'],
    [{ status: 401, message: 'x' }, 'other'],
    [{ code: 'invalid_credentials', status: 400, message: 'x' }, 'other'],
    [null, 'offline']
  ])('%j is %s', (error, kind) => {
    expect(refusalKind(error)).toBe(kind);
  });
});
