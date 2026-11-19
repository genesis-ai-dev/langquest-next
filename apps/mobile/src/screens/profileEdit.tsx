// Edit Profile (demo AUTH-7; LAN-304): your name, your email and your
// password, the one place for all three. A screen of its own module so it
// loads the first time it is opened, not with Me (src/shell/lazyScreens.tsx,
// scripts/export-web.mjs): most people never change their account. Its rules
// are src/account/profileModel.ts.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { signInName } from '../auth/accounts';
import { queueAccountAction } from '../account/accountData';
import { rememberPassword, setAccountEmail, setAccountPassword } from '../account/accountAuth';
import { authErrorText, outboxErrorText } from '../account/accountText';
import { emailEdit, emailErrorText, ownEmail, passwordRequired, saveProblem, savedText, signInLine, type EmailEdit } from '../account/profileModel';
import { useAccountActions, useDisplayNames } from '../account/useAccount';
import { useHasPassword } from '../account/useHasPassword';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import type { Ctx } from '../shell/ctx';
import { contractsFor } from '../shell/screenContracts';
import { Banner, Field, Header, PrimaryBtn, Screen } from '../ui/kit';
import { personLook } from '../ui/people';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { space } from '../ui/theme';
import { PersonAvatar } from '../ui/UserChip';

/**
 * Your name, saved on this phone and sent when connected, and your email and
 * password, which need a connection. A looked-after account adds its first
 * email or password here, and an own-email account changes either. Nothing
 * proves the address, as Create Account proves none; a password is typed
 * twice, and one is required with the first email of an account that has
 * none, since helpers' codes stop then
 * (docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md).
 * Someone let in offline has no account yet, so only their name (14.1, 5 "Me").
 */
export function ProfileEdit(ctx: Ctx) {
  const names = useDisplayNames(ctx.session.actorId);
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [hasPassword, recheck] = useHasPassword();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actions = useAccountActions(ctx.session.actorId);
  const pending = actions.filter((a) => a.kind === 'profile' && a.status !== 'sent').at(-1);
  const value = name ?? String(pending?.payload.displayName ?? names[ctx.session.actorId] ?? '');
  const current = ctx.session.email;
  const account = !ctx.session.isLocal;
  const typedEmail = email ?? ownEmail(current);
  const edit: EmailEdit = account ? emailEdit(typedEmail, current) : { kind: 'same' };
  const newPassword = account ? password : '';
  const required = passwordRequired(edit, hasPassword);
  // Saving stays off while the name is empty, except for something it must refuse:
  // that has to be tappable so this screen can say why (ACCT-019).
  const problem = saveProblem({ edit, password: newPassword, confirm, hasPassword });
  const handle = signInName(current);
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (problem) { setError(problem); return; }
      const toServer = edit.kind === 'change' || newPassword.length > 0;
      // The name syncs whenever it can, so it is kept first: an email or a password that needs a
      // connection never takes the name down with it (UI audit, finding 117).
      const saved = String(pending?.payload.displayName ?? names[ctx.session.actorId] ?? '').trim();
      const renamed = value.trim() !== saved;
      if (renamed || !toServer) await queueAccountAction(ctx.session.actorId, 'profile', { displayName: value.trim() });
      const kept = renamed ? [t('account.profile.nameSaved')] : [];
      // The password goes first, through this session (Auth keeps it): an email that fails after it leaves
      // a way in still, and the server takes no email from an account without a password.
      if (newPassword) {
        const { error } = await setAccountPassword(newPassword);
        if (error) {
          noteExpected('set password', error);
          setError([...kept, authErrorText(error, t('account.profile.passwordFailed'), t('account.profile.passwordNeedsConnection'))].join(' '));
          return;
        }
        // The new password also signs them back in here offline (decisions.md 168); a new email moves it below.
        if (current) await rememberPassword(ctx.session.actorId, current, newPassword);
        recheck();
        setPassword('');
        setConfirm('');
        kept.push(t('account.profile.passwordSaved'));
      }
      if (edit.kind === 'change') {
        const refused = await setAccountEmail(ctx.session.actorId, edit.address);
        if (refused) {
          noteExpected('change email', refused, refused.code);
          setError([...kept, emailErrorText(refused.code)].join(' '));
          return;
        }
      }
      ctx.toast(savedText({ current, edit, password: newPassword.length > 0 }));
      ctx.back();
    } catch (e) { setError(failureMessage('save profile', e)); }
    finally { setBusy(false); }
  }
  return (
    <Screen
      header={<Header title={t('account.profile.title')} onBack={ctx.back} />}
      footer={<PrimaryBtn label={t('account.profile.save')} onPress={() => void save()} disabled={!value.trim() && !problem} busy={busy} />}
    >
      <View style={styles.avatarBlock}>
        <PersonAvatar look={personLook(ctx.session.actorId, value)} size={72} />
      </View>
      <Field label={t('account.profile.nameLabel')} value={value} onChangeText={setName} placeholder={t('entry.fields.yourName')} autoCapitalize="words"
        help={t('account.profile.nameHelp')} />
      {account ? (
        <View style={{ gap: space.xs }}>
          {/* A looked-after account's address is not an email anyone can use (accounts.ts): its field starts empty. */}
          <Field label={t('entry.fields.email')} value={typedEmail} onChangeText={setEmail} placeholder={t('account.more.noEmail')}
            keyboardType="email-address" autoCapitalize="none" help={t('account.profile.emailHelp')} />
          {handle ? <Text style={txt.xs}>{t('account.profile.addEmail', { name: handle })}</Text> : null}
        </View>
      ) : null}
      {account ? (
        <View style={{ gap: space.xs }}>
          <Field label={required ? t('entry.fields.password') : hasPassword ? t('account.profile.newPassword') : t('account.profile.password')}
            value={password} onChangeText={setPassword} placeholder={t('account.profile.passwordPlaceholder')} secure autoCapitalize="none"
            help={t('account.profile.passwordHelp')} />
          {/* Typed twice, as on Create Account and New password; the second field comes once the first has something. */}
          {password ? (
            <Field label={t('entry.createAccount.confirmLabel')} value={confirm} onChangeText={setConfirm} placeholder={t('entry.createAccount.confirmPlaceholder')}
              secure autoCapitalize="none" help={t('entry.createAccount.confirmHelp')} />
          ) : null}
          {password && confirm && confirm !== password ? <Text style={txt.error}>{t('entry.createAccount.mismatch')}</Text> : null}
          <Text style={txt.xs}>
            {required && !password ? t('account.profile.passwordWithEmail') : password || hasPassword ? signInLine(current, edit) : t('account.profile.setOne')}
          </Text>
        </View>
      ) : null}
      {pending?.status === 'failed' ? <Banner icon="flag" tone="amber" title={t('account.profile.lastChangeRefused')} body={outboxErrorText(pending.error)} /> : null}
      {pending?.status === 'queued' ? <Banner icon="cloud" title={t('entry.shared.savedOnDevice')} body={t('account.profile.savedBody')} /> : null}
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatarBlock: { alignItems: 'center', paddingVertical: space.md }
});

export const contracts = contractsFor('profile_edit');
