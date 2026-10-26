import { t } from '../src/i18n';
import { adoptError } from '../src/library/failureModel';

describe('why library_adopt refused, in words', () => {
  it('its known reasons by their message', () => {
    expect(adoptError({ message: 'not a member', code: '42501' }).message).toBe(t('library.errors.notMember'));
    expect(adoptError({ message: 'that item is not shared', code: '22023' }).message).toBe(t('library.errors.notShared'));
    expect(adoptError({ message: 'not allowed to manage the library', code: '42501' }).message).toBe(t('library.errors.notAllowed'));
    expect(adoptError({ message: 'that is not a version of the item', code: '22023' }).message).toBe(t('library.errors.notAVersion'));
    expect(adoptError({ message: 'that version v3 has not been published yet', code: '22023' }).message).toBe(t('library.errors.notPublishedYet'));
  });
  it('not allowed by code, no connection by no code, else a general message', () => {
    expect(adoptError({ message: 'x', code: '42501' }).message).toBe(t('library.errors.notAllowed'));
    expect(adoptError({ message: 'Failed to fetch' }).message).toBe(t('common.notConnected'));
    expect(adoptError({ message: 'x', code: '23505' }).message).toBe(t('library.errors.couldNotGet'));
  });
});
