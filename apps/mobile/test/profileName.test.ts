import { profileNameToSave } from '../src/accounts';

describe('a profile name for an account that has none', () => {
  it('takes the email local part when the profile has no name', () => {
    expect(profileNameToSave(null, 'caleb.koster@gmail.com')).toBe('caleb.koster');
    expect(profileNameToSave(undefined, 'caleb.koster@gmail.com')).toBe('caleb.koster');
    expect(profileNameToSave('   ', 'caleb.koster@gmail.com')).toBe('caleb.koster');
  });

  it('never replaces a name the person has', () => {
    expect(profileNameToSave('Caleb', 'caleb.koster@gmail.com')).toBeNull();
  });

  it('saves nothing without an email', () => {
    expect(profileNameToSave(null, null)).toBeNull();
    expect(profileNameToSave(null, '@example.org')).toBeNull();
  });

  it('stays within what save_profile accepts (1 to 100 characters)', () => {
    expect(profileNameToSave(null, `${'a'.repeat(150)}@example.org`)).toHaveLength(100);
  });
});
