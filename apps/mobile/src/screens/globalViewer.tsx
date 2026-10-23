// Global Viewer (app only, no demo screen): LangQuest support set up an
// authenticator, enter its code each sign-in, and then find any organization
// and open it to read, as a Viewer (decisions.md 158, docs/global-viewers.md).
// Inside an organization, the link in every header opens it (decision 71
// amended): the organization they are in and how, first, then every other one.
// The server decides who is one and refuses every write; this screen only
// sets up the code and lists organizations.
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { codeOf, keyInGroups } from '../account/globalViewerModel';
import { useGlobalViewer } from '../account/useGlobalViewer';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import {
  globalViewerOrganizations, startAuthenticator, verifiedAuthenticator, verifyAuthenticator, type ViewableOrganization
} from '../server/globalViewer';
import type { Ctx } from '../shell/ctx';
import { contractsFor } from '../shell/screenContracts';
import { Banner, Card, EmptyState, Field, GhostBtn, Header, Ico, PrimaryBtn, Screen, SearchField, SectionLabel } from '../ui/kit';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';
import { C, space } from '../ui/theme';

const PAGE = 50;

export function GlobalViewer(ctx: Ctx) {
  const { access, refresh } = useGlobalViewer(ctx.session.actorId, true);
  return (
    <Screen header={<Header title={t('globalViewer.title')} onBack={ctx.back} />}>
      {access === 'needs_setup' ? <SetUp refresh={refresh} /> : null}
      {access === 'needs_code' ? <EnterCode refresh={refresh} /> : null}
      {access === 'on' ? <Organizations ctx={ctx} /> : null}
      {access === 'revoked' ? <Banner icon="lock" tone="amber" title={t('globalViewer.revokedTitle')} body={t('globalViewer.revokedBody')} /> : null}
      {access === null ? <EmptyState icon="lock" title={t('globalViewer.notOne')} /> : null}
    </Screen>
  );
}

/** A code from the authenticator, checked by the server; the sign-in is then verified (aal2). */
function CodeField(props: { factorId: () => Promise<string | null>; refresh: () => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const code = codeOf(typed);
  async function check() {
    if (!code) return;
    setBusy(true);
    setError('');
    try {
      const factorId = await props.factorId();
      if (!factorId) { setError(t('globalViewer.noAuthenticator')); return; }
      const { error: refused } = await verifyAuthenticator(factorId, code);
      if (refused) {
        noteExpected('global viewer code', refused);
        setError(refused.code === 'mfa_verification_failed' || refused.status === 422 ? t('globalViewer.codeWrong') : failureMessage('global viewer code', refused));
        return;
      }
      await props.refresh();
    } catch (e) {
      setError(failureMessage('global viewer code', e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: space.md }}>
      <Field label={t('globalViewer.codeLabel')} value={typed} onChangeText={setTyped} placeholder="123 456" keyboardType="number-pad"
        autoCapitalize="none" onSubmit={() => void check()} testID="global-viewer-code" help={t('globalViewer.codeHelp')} />
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryBtn label={t('globalViewer.check')} onPress={() => void check()} disabled={!code} busy={busy} full help={t('globalViewer.checkHelp')} />
    </View>
  );
}

function EnterCode(props: { refresh: () => Promise<void> }) {
  return (
    <View style={{ gap: space.md }}>
      <Text style={txt.body}>{t('globalViewer.enterCode')}</Text>
      <CodeField factorId={verifiedAuthenticator} refresh={props.refresh} />
    </View>
  );
}

/** Setting up the authenticator, done on a call with whoever granted this (docs/global-viewers.md). */
function SetUp(props: { refresh: () => Promise<void> }) {
  const [started, setStarted] = useState<{ factorId: string; uri: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true);
    setError('');
    try {
      // i18n-ignore: the factor's name, kept on the server
      setStarted(await startAuthenticator('LangQuest'));
    } catch (e) {
      setError(failureMessage('global viewer setup', e));
    } finally {
      setBusy(false);
    }
  }
  if (!started) {
    return (
      <View style={{ gap: space.md }}>
        <Text style={txt.body}>{t('globalViewer.setUpIntro')}</Text>
        {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
        <PrimaryBtn label={t('globalViewer.setUp')} icon="key" onPress={() => void start()} busy={busy} full help={t('globalViewer.setUpHelp')} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.md }}>
      <SectionLabel label={t('globalViewer.stepAdd')} />
      <Text style={txt.body}>{t('globalViewer.scan')}</Text>
      <View style={styles.qr} accessibilityLabel={t('globalViewer.qrLabel')}>
        <QRCode value={started.uri} size={196} backgroundColor={C.white} color={C.dark} />
      </View>
      {Platform.OS !== 'web' ? (
        <GhostBtn label={t('globalViewer.openApp')} icon="phone" full help={t('globalViewer.openAppHelp')}
          onPress={() => { Linking.openURL(started.uri).catch(() => setError(t('globalViewer.noApp'))); }} />
      ) : null}
      <Text style={txt.smMuted}>{t('globalViewer.typeKey')}</Text>
      <Text style={[txt.body, styles.key]} selectable testID="global-viewer-key">{keyInGroups(started.secret)}</Text>
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
      <SectionLabel label={t('globalViewer.stepCode')} />
      <CodeField factorId={() => Promise.resolve(started.factorId)} refresh={props.refresh} />
    </View>
  );
}

/** Every organization, found by its name or a language's, and opened to read. */
function Organizations(props: { ctx: Ctx }) {
  const { ctx } = props;
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ViewableOrganization[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const asked = useRef(0);
  async function load(q: string, after?: ViewableOrganization) {
    const mine = ++asked.current;
    const { data, error: refused } = await globalViewerOrganizations(q, after ? { name: after.name, orgId: after.org_id } : undefined);
    if (mine !== asked.current) return;
    if (refused) { setError(failureMessage('global viewer organizations', refused)); return; }
    setError('');
    const page = data ?? [];
    setRows((before) => (after ? [...(before ?? []), ...page] : page));
    setMore(page.length === PAGE);
  }
  useEffect(() => {
    const timer = setTimeout(() => { void load(query.trim()); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  const here = ctx.session.viewingAsGlobalViewer ? ctx.org.state?.org?.value.name ?? '' : '';
  return (
    <View style={{ gap: space.md }}>
      {here ? (
        <>
          <SectionLabel label={t('globalViewer.hereLabel')} />
          <Card accessibilityLabel={t('globalViewer.viewingOrg', { org: here })}>
            <View style={styles.row}>
              <Ico name="eye" size={22} color={C.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[txt.body, { fontWeight: '700' }]} testID="global-viewer-here">{here}</Text>
                <Text style={txt.smMuted}>{t('globalViewer.onBody')}</Text>
              </View>
            </View>
          </Card>
          <SectionLabel label={t('globalViewer.otherLabel')} />
        </>
      ) : <Banner icon="eye" title={t('globalViewer.onTitle')} body={t('globalViewer.onBody')} />}
      <SearchField value={query} onChangeText={setQuery} placeholder={t('globalViewer.search')} testID="global-viewer-search" />
      {error ? <Banner icon="cloud" tone="amber" title={error} /> : null}
      {rows?.map((r) => {
        const open = r.org_id === ctx.language.orgId;
        return (
          <HelpRow key={r.org_id} of="globalViewer.organization">
            <Card accessibilityLabel={open ? t('globalViewer.openNowLabel', { name: r.name }) : r.name} current={open}
              help={t('globalViewer.openHelp')}
              onPress={() => void ctx.openOrganization(r.org_id).catch((e: unknown) => setError(failureMessage('global viewer open', e)))}>
              <View style={styles.row}>
                <Ico name="building" size={22} color={open ? C.primary : C.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[txt.body, { fontWeight: '600' }]}>{r.name}</Text>
                  {r.languages.length ? <Text style={txt.xs} numberOfLines={2}>{r.languages.join(', ')}</Text> : null}
                </View>
              </View>
            </Card>
          </HelpRow>
        );
      })}
      {rows && !rows.length ? <EmptyState icon="search" title={t('globalViewer.noneFound')} /> : null}
      {more && rows ? <GhostBtn label={t('globalViewer.more')} full help={t('help.details.showMore')} onPress={() => void load(query.trim(), rows[rows.length - 1])} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  qr: { alignSelf: 'center', padding: space.md, backgroundColor: C.white, borderRadius: 12 },
  // i18n-ignore: font names
  key: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md }
});

export const contracts = contractsFor('global_viewer');
