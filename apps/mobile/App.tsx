import { StudyPrefetch } from './src/study/StudyPrefetch';
import { HelpModeProvider } from './src/helpMode/helpMode';
import { useKeepHelpAudio } from './src/helpMode/useKeepHelpAudio';
import { usePrefetchLazyScreens } from './src/shell/usePrefetchLazyScreens';
import { languageReady, onLanguageReady } from './src/i18n/start';
import { HelpScopeContext } from './src/helpMode/useHelpMode';
import { stopAudioPlayback } from './src/audio/audioSession';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, NavigationContext, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './src/ui/text';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from './src/shell/ctx';
import { DevMenu } from './src/shell/DevMenu';
import { UpdateBanner } from './src/shell/UpdateBanner';
import { useFirstLaunchUpdate } from './src/shell/useFirstLaunchUpdate';
import { AppVersionPrompt } from './src/appVersion/AppVersionPrompt';
import { useAppVersion } from './src/appVersion/useAppVersion';
import { maySwitchPersona } from './src/session/dev';
import { MAP_SCREENS, PASSAGE_READING, SCREEN_IDS, TAB_SCREENS, type ScreenId } from './src/shell/flow';
import { frame, layoutKind } from './src/ui/layout';
import { chromeVisible, showsGlobalViewerLink } from './src/shell/chromeModel';
import { NavChrome } from './src/shell/NavChrome';
import { lockPhonesToPortrait } from './src/shell/orientation';
import { paneFor, type SplitSpec } from './src/shell/panes';
import { LayoutContext, PaneSelectionContext, type Layout, type OpenDetail, FooterHeightContext } from './src/ui/useLayout';
import { EmptyState, GhostBtn, ToastView, type ToastSpec } from './src/ui/kit';
import { readToastTime, toastTime } from './src/ui/toastTime';
import { FeedbackHost } from './src/feedback/FeedbackSheet';
import { txt } from './src/ui/textStyles';
import { installGlobalHandlers, reportError } from './src/diagnostics/report';
import { t } from './src/i18n';
import { personLook } from './src/ui/people';
import { navRef, type StackParams } from './src/shell/nav';
import { useNav } from './src/shell/useNav';
import * as Account from './src/screens/account';
import * as Entry from './src/screens/entry';
import * as MapScreens from './src/screens/map';
import * as Onboarding from './src/screens/onboarding';
import * as Passage from './src/screens/passage';
import * as Review from './src/screens/review';
import * as Ready from './src/screens/getReady';
import * as Study from './src/screens/study';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { lazyScreen } from './src/shell/lazyScreens';
import { StorageGate } from './src/web/storageGate';
import { SyncEffects } from './src/sync/SyncEffects';
import { UploadBar } from './src/sync/uploads';
import { SyncStatusContext } from './src/sync/useSyncStatus';
import { deriveSession, foldsSettled, homeScreenFor, tabsFor, type TabId } from './src/shell/session';
import { onAuthChange, savedSignIn, serverConfigError } from './src/server/auth';
import { onUnlocked, signedInHere } from './src/server/lock';
import { afterAuthEvent, savedSession } from './src/session/authState';
import { noteAuthEvent } from './src/diagnostics/authDiag';
import { watchRenewals } from './src/server/renewalWatch';
import { C, space } from './src/ui/theme';
import { recordUserEvent } from './src/account/accountData';
import { useAccountSync, useDisplayNames, useProfileName } from './src/account/useAccount';
import { useGlobalViewer, useGlobalViewerNames } from './src/account/useGlobalViewer';
import { GlobalViewerLink } from './src/account/GlobalViewerLink';
import { HeaderExtraContext } from './src/ui/headerExtra';
import { useBlocks } from './src/moderation/useModeration';
import { PeopleContext } from './src/ui/usePerson';
import { titleFor } from './src/web/webPaths';
import { useHeldInvite, type InviteHandle } from './src/invites/useHeldInvite';
import { useOrg, type OrgHandle } from './src/sync/useOrg';
import { useLibraryFollow, useTranslatorReview } from './src/library/useLibraryFollow';
import { useSourceOffline } from './src/sources/useSourceOffline';
import { useLanguage } from './src/sync/useLanguage';
import { useHandOvers } from './src/sync/useHandOvers';
import { LostFilesAlert } from './src/sync/lostFiles';
import { hasWelcome, isFromV2 } from './src/account/welcomeBack';
import { useWelcomeBack } from './src/account/useWelcomeBack';
import { useActions } from './src/shell/useActions';
import { useDetails } from './src/shell/useDetails';
import { useIncoming } from './src/shell/useIncoming';
import { useInbox } from './src/shell/useInbox';
import { useNavActions } from './src/shell/useNavActions';
import { useOnboarding } from './src/shell/useOnboarding';
import { useOpenOrganization, type Arrival } from './src/shell/useOpenOrganization';
import { useRecentPassages } from './src/shell/useRecentPassages';
import { usePassagesInMemory } from './src/shell/usePassagesInMemory';
import { usePassageReady } from './src/shell/usePassageReady';
import { PassageNotHere } from './src/sync/offline';
import { useRouting } from './src/shell/useRouting';
import { useRootBack } from './src/shell/useRootBack';
import { useTestProbes } from './src/shell/useTestProbes';
import { useWorkingLanguage } from './src/shell/useWorkingLanguage';
import { useReadOnlyHandles } from './src/shell/useReadOnlyHandles';
import { ReadOnlyContext } from './src/session/useReadOnly';
import { wireBase } from './src/shell/wiring';

// What the base folders need from folders above them (decisions.md 105), once, before anything draws.
wireBase();
const IS_DEV = __DEV__;
/** Screens that record: the upload bar shows there, but tapping it does not leave mid-take. */
const RECORDING_SCREENS: readonly ScreenId[] = ['workspace', 'review_capture', 'back_translation'];

// Screens that load the first time they are opened (src/shell/lazyScreens.tsx): one loader per module.
const loadChecks = () => import('./src/screens/checks');
const loadConfig = () => import('./src/screens/config');
const loadContent = () => import('./src/screens/content');
const loadOrg = () => import('./src/screens/org');
const loadReference = () => import('./src/screens/reference');
const loadReports = () => import('./src/screens/reports');
const loadSources = () => import('./src/screens/sources');
const loadGlobalViewer = () => import('./src/screens/globalViewer');

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element | null> = {
  sign_in: Entry.SignIn, terms_privacy: Entry.TermsPrivacy, explore_home: Entry.ExploreHome, create_account: Entry.CreateAccount,
  scan_qr: Entry.ScanQr, vision: Entry.Vision, intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg,
  request_access: Entry.RequestAccess, welcome: Onboarding.Welcome, welcome_back: Onboarding.WelcomeBack,
  my_work: Work.MyWork,
  status_home: MapScreens.StatusHome, map_home: MapScreens.MapHome, book_map: MapScreens.BookMap,
  passage_record: Passage.PassageRecord, version_detail: Passage.VersionDetail, review_detail: Passage.ReviewDetail,
  ask_someone: Passage.AskSomeone,
  guest_review: Review.GuestReview, add_record: Review.AddRecord, review_capture: Review.ReviewCapture,
  study_guide: Study.StudyGuide, study_step: Study.StudyStep, guide_editor: Study.GuideEditor,
  workspace: Translate.Workspace, back_translation: Translate.BackTranslation,
  key_terms: lazyScreen(loadConfig, 'KeyTerms'), key_term_detail: lazyScreen(loadConfig, 'KeyTermDetail'),
  inbox_home: Account.InboxHome, settings_home: Account.SettingsHome, profile_edit: Account.ProfileEdit,
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, delete_account: Account.DeleteAccount, sync_status: Account.SyncStatus,
  org_home: lazyScreen(loadOrg, 'OrgHome'), cluster_home: lazyScreen(loadOrg, 'ClusterHome'), language_home: lazyScreen(loadOrg, 'LanguageHome'),
  new_language: lazyScreen(loadOrg, 'NewLanguage'), members_list: lazyScreen(loadOrg, 'MembersList'), invite_member: lazyScreen(loadOrg, 'InviteMember'), invite_qr: lazyScreen(loadOrg, 'InviteQr'),
  edit_member: lazyScreen(loadOrg, 'EditMember'), check_editor: lazyScreen(loadChecks, 'CheckEditor'),
  roles_home: lazyScreen(loadConfig, 'RolesHome'), role_editor: lazyScreen(loadConfig, 'RoleEditor'), reference_home: lazyScreen(loadConfig, 'ReferenceHome'), material_editor: lazyScreen(loadConfig, 'MaterialEditor'),
  flows_home: lazyScreen(loadConfig, 'FlowsHome'), flow_editor: lazyScreen(loadConfig, 'FlowEditor'),
  templates_home: lazyScreen(loadContent, 'TemplatesHome'), template_editor: lazyScreen(loadContent, 'TemplateEditor'),
  book_structure: lazyScreen(loadContent, 'BookStructure'),
  reports_home: lazyScreen(loadReports, 'ReportsHome'), reports_language: lazyScreen(loadReports, 'ReportsLanguage'),
  reference_bibles: lazyScreen(loadReference, 'ReferenceBibles'), reference_source: lazyScreen(loadReference, 'ReferenceSource'), reference_guides: lazyScreen(loadReference, 'ReferenceGuides'),
  reference_coverage: lazyScreen(loadReference, 'ReferenceCoverage'), passage_reference: lazyScreen(loadReference, 'PassageReference'),
  bible_explore: lazyScreen(loadSources, 'BibleExplore'),
  get_ready: Ready.GetReady,
  settings_more: Account.SettingsMore,
  global_viewer: lazyScreen(loadGlobalViewer, 'GlobalViewer')
};

/**
 * Screens read the shared context through React context rather than props,
 * so the navigator can own the component tree (and its transitions) while
 * the Shell still owns state. `params` comes from the route, so a screen
 * below the top keeps its own params while another is pushed over it.
 */
const CtxContext = createContext<Ctx | null>(null);
const NO_PARAMS: Record<string, string> = {};
const markJoined: Ctx['markJoined'] = (actorId) => AsyncStorage.setItem(`joined:${actorId}`, '1');
const Stack = createNativeStackNavigator<StackParams>();

/**
 * The stack entry whose screen is drawn in the list pane of a split
 * (panes.ts). Its own place in the stack shows the split's empty state
 * instead, so a list is never mounted twice.
 */
const PaneKeyContext = createContext<{ key: string; empty?: SplitSpec['empty'] } | null>(null);

/**
 * Wide windows: each stack screen reports its footer's height under its
 * route key, so the toast clears the buttons of whichever screen is on top.
 */
const FooterReportContext = createContext<((key: string, height: number) => void) | null>(null);

type HostProps = { route: RouteProp<StackParams, ScreenId> };
/** Whether this stack screen is focused; outside the navigator (a split's list pane) it always shows. */
function useFocusedSafe(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? false);
  useEffect(() => {
    if (!navigation) return;
    const on = navigation.addListener('focus', () => setFocused(true));
    const off = navigation.addListener('blur', () => setFocused(false));
    return () => { on(); off(); };
  }, [navigation]);
  return navigation ? focused : true;
}

function hostFor(id: ScreenId) {
  const Screen = SCREENS[id];
  function Host(props: HostProps) {
    const ctx = useContext(CtxContext);
    const focused = useFocusedSafe();
    // Playback belongs to the screen it started on: leaving it (another screen pushed over it, or a tab
    // switched away) stops whatever was playing. Popping back unmounts the screen, and its players with it.
    // Heard from the navigation event, not from a render: a screen being frozen may never draw its blur.
    const navigation = useContext(NavigationContext);
    useEffect(() => navigation?.addListener('blur', stopAudioPlayback), [navigation]);
    const pane = useContext(PaneKeyContext);
    const report = useContext(FooterReportContext);
    const key = props.route.key;
    const onFooter = useMemo(() => (report ? (height: number) => report(key, height) : null), [report, key]);
    const ready = usePassageReady(ctx, props.route.params);
    if (!ctx) return null;
    if (pane && props.route.key === pane.key) return <PaneEmpty spec={pane.empty} />;
    // A passage's screen waits the moment it takes to bring the passage in from the phone's disk.
    if (ready === 'waiting') return <View style={styles.root} accessibilityLabel={t('common.loading')} />;
    // Offline, a passage the first download has not reached yet shows what its line knows (decisions.md 147).
    if (ready === 'notHere') return <PassageNotHere ctx={ctx} unitId={props.route.params?.['unitId'] ?? ''} />;
    // One boundary per screen (error-tracking): a crash in a study guide
    // never takes the recorder, or the rest of the app, down with it.
    return (
      <FooterHeightContext.Provider value={onFooter}>
        <ScreenBoundary screen={id} onBack={ctx.back} onHome={ctx.home}
          homeLabel={homeScreenFor(ctx.session) === 'my_work' ? t('shell.errors.goToMyWork') : t('shell.errors.goHome')}>
          {/* Help mode numbers only the showing screen's parts. */}
          <HelpScopeContext.Provider value={focused}>
            <Screen {...ctx} params={props.route.params ?? {}} />
          </HelpScopeContext.Provider>
        </ScreenBoundary>
      </FooterHeightContext.Provider>
    );
  }
  Host.displayName = `Host(${id})`;
  return Host;
}
const HOSTS = {} as Record<ScreenId, (props: HostProps) => React.JSX.Element | null>;
for (const id of SCREEN_IDS) HOSTS[id] = hostFor(id);

/** Beside a list with nothing open: what tapping a row will show here. */
function PaneEmpty(props: { spec: SplitSpec['empty'] | undefined }) {
  return (
    <View style={styles.paneEmpty}>
      {props.spec ? <EmptyState icon={props.spec.icon} title={props.spec.title} sub={props.spec.sub} /> : null}
    </View>
  );
}

/**
 * The list of a split, drawn left of the stack on a desktop-wide window
 * (decisions.md 55). Outside the navigator: the screen gets its route's
 * params as it would on the stack, and a ctx whose moves start from it.
 */
function PaneSlot(props: { route: { screen: ScreenId; key: string; params?: Record<string, string> }; ctx: Ctx; layout: Layout; open: OpenDetail | null }) {
  const Host = HOSTS[props.route.screen];
  const route = { key: props.route.key, name: props.route.screen, params: props.route.params } as HostProps['route'];
  return (
    <LayoutContext.Provider value={props.layout}>
      <PaneSelectionContext.Provider value={props.open}>
        <CtxContext.Provider value={props.ctx}>
          <View style={[styles.pane, { width: props.layout.contentWidth }]}>
            {/* The toast sits over the stack, so the list's footer does not move it. */}
            <FooterReportContext.Provider value={null}>
              <Host route={route} />
            </FooterReportContext.Provider>
          </View>
        </CtxContext.Provider>
      </PaneSelectionContext.Provider>
    </LayoutContext.Provider>
  );
}

/**
 * Whatever is wrong, the app says so. A release build has no redbox: an
 * uncaught error there is a white screen, which tells a tester on TestFlight
 * nothing and a developer less. Two backstops, because they catch different
 * moments: `serverConfigError` for a build that was assembled without its
 * configuration, and this boundary for anything thrown while rendering.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; id: string }> {
  override state: { error: Error | null; id: string } = { error: null, id: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ id: reportError('app render', error) });
    void info;
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <Fatal title={t('shell.errors.somethingWentWrong')} id={this.state.id} detail={this.state.error.stack ?? this.state.error.name} />;
  }
}

/**
 * A screen that failed to draw. Says what was kept before what went wrong,
 * gives an id to read to support, and offers a way out (error-tracking §3).
 */
class ScreenBoundary extends Component<{ screen: ScreenId; onBack: () => void; onHome: () => void; homeLabel: string; children: ReactNode }, { error: Error | null; id: string }> {
  override state: { error: Error | null; id: string } = { error: null, id: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    this.setState({ id: reportError(`screen ${this.props.screen}`, error) });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const reset = (then: () => void) => () => { this.setState({ error: null, id: '' }); then(); };
    return (
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md, backgroundColor: C.bg, flexGrow: 1 }}>
        <Text style={txt.h2} accessibilityRole="header">{t('shell.errors.screenTitle')}</Text>
        <Text style={txt.body}>{t('shell.errors.safe')}</Text>
        <Text style={txt.smMuted} selectable>{t('shell.errors.tellCode', { code: this.state.id })}</Text>
        {/* help-ignore: the crash screen has no ? to turn help on */}
        <GhostBtn label={t('shell.errors.goBack')} icon="left" onPress={reset(this.props.onBack)} />
        {/* A viewer's home is Progress, not My Work (NAV-070). help-ignore: the crash screen has no ? to turn help on */}
        <GhostBtn label={this.props.homeLabel} icon="home" onPress={reset(this.props.onHome)} />
      </ScrollView>
    );
  }
}

/** A message a tester can read out over a call, and a developer can act on. */
function Fatal(props: { title: string; detail: string; id?: string }) {
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
      <Text style={txt.h3}>{props.title}</Text>
      <Text style={txt.body}>{t('shell.errors.safe')}</Text>
      {props.id ? <Text style={txt.smMuted} selectable>{t('shell.errors.codeForTeam', { code: props.id })}</Text> : null}
      <Text style={txt.xs} selectable>{props.detail}</Text>
    </ScrollView>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  // In a browser the chosen language's words arrive as a file; draw nothing until they have (src/i18n/start.ts).
  const [wordsReady, setWordsReady] = useState(languageReady);
  useEffect(() => onLanguageReady(() => setWordsReady(true)), []);
  useEffect(() => { installGlobalHandlers(); lockPhonesToPortrait(); }, []);
  // The first launch after install waits up to 5 s for the latest OTA update (decisions.md 153).
  const updateLooked = useFirstLaunchUpdate();
  // Work people left unsent when they signed out of this phone goes as them (decisions.md 60).
  useHandOvers(auth === undefined ? undefined : auth?.user.id ?? null);
  // Who was signed in when supabase-js next speaks, for diagnostics of a sign-out the person did not choose.
  const authNow = useRef<AuthSession | null | undefined>(undefined);
  useEffect(() => { authNow.current = auth; }, [auth]);
  useEffect(() => {
    if (serverConfigError) return;
    let active = true;
    // Whoever this phone holds a sign-in for, renewable right now or not
    // (authState.ts, decision 87): offline, supabase-js reports no one once
    // the token is an hour old, and took half a minute to say so.
    const fromStorage = (s: AuthSession | null) => { if (active) setAuth((now) => (now === undefined ? s : now)); };
    savedSignIn().then((raw) => fromStorage(savedSession(raw)), () => fromStorage(null));
    const unsubscribe = onAuthChange((event, s) => {
      noteAuthEvent(event, authNow.current, s);
      setAuth((now) => afterAuthEvent(now, event, s));
      // In by a password, a code or an invite: an older lock of theirs here is not theirs to come back to (decisions.md 168).
      if (event === 'SIGNED_IN' && s) void signedInHere(s.user.id);
    });
    // Back in from the lock on this phone: supabase-js has no event for that (decisions.md 168).
    const offUnlocked = onUnlocked((s) => setAuth(s));
    const unwatch = watchRenewals();
    return () => { active = false; unsubscribe(); offUnlocked(); unwatch(); };
  }, []);
  // "New version available", and below the minimum version "Please update the app" with sync stopped (decisions.md 154).
  const appVersion = useAppVersion(!!auth);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <UpdateBanner />
        <AppVersionPrompt offer={appVersion.offer} onUpdate={appVersion.openStore} onDismiss={appVersion.dismiss} />
        {serverConfigError ? (
          <Fatal title={t('shell.errors.notConfigured')} detail={serverConfigError} />
        ) : !updateLooked || auth === undefined || !wordsReady ? (
          // Looking for an update, reading the saved sign-in or the words: the same spinner, not a blank screen.
          <View style={styles.waiting}><ActivityIndicator size="large" color={C.muted} /></View>
        ) : (
          <ErrorBoundary>
            {/* Help mode: a ? on every screen's header; while on, taps explain (demo ADR-038). */}
            <HelpModeProvider>
            <StorageGate>
              <Shell key={auth?.user.id ?? 'guest'} actorId={auth?.user.id ?? 'guest'} email={auth?.user.email ?? null} signedIn={!!auth} fromV2={isFromV2(auth?.user)} />
            </StorageGate>
            </HelpModeProvider>
          </ErrorBoundary>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/**
 * Which organization is open. An organization is the unit people switch
 * between: its own stream plus the open language's (decision 63).
 */
function Shell(props: { actorId: string; email: string | null; signedIn: boolean; fromV2: boolean }) {
  const { orgId, decided, selectionRevision, noOrganizations, arrival, openOrganization } = useOpenOrganization(props.actorId, props.signedIn);
  // The held invite is used here, above the organization, so opening the
  // organization it joined cannot interrupt it.
  const invite = useHeldInvite(props.signedIn ? props.actorId : null, openOrganization);
  if (!decided) return <View style={styles.root} accessibilityLabel={t('shell.openingOrganization')} />;
  return <Workspace key={`${orgId}:${selectionRevision}`} {...props} orgId={orgId} noOrganizations={noOrganizations} openOrganization={openOrganization} invite={invite}
    arrival={arrival?.orgId === orgId ? arrival : null} />;
}

/**
 * One organization: its stream, and the languages it lists there. Until
 * the org fold is read (and, on a device that has never seen this org, until
 * the first sync has had its chance), which languages it has is unknown, so
 * nothing is opened yet.
 */
function Workspace(props: { actorId: string; email: string | null; signedIn: boolean; fromV2: boolean; orgId: string | null; noOrganizations: boolean; openOrganization: Ctx['openOrganization']; invite: InviteHandle; arrival: Arrival | null }) {
  const org = useOrg(props.orgId, props.actorId);
  // Help audio waits for this organization's first sync (src/helpMode/useKeepHelpAudio.ts).
  useKeepHelpAudio(org.settled);
  // So is fetching the screens that load when opened, on the web (src/shell/lazyScreens.tsx).
  usePrefetchLazyScreens(org.settled);
  const known = org.state !== null && (org.state.org !== null || org.settled);
  if (!known) return <View style={styles.root} accessibilityLabel={t('shell.openingOrganization')} />;
  // No organization: the screens still need an id for their keys; '' names none.
  return <OrgWork {...props} orgId={props.orgId ?? ''} org={org} />;
}

/**
 * The organization with one language open (decision 63). Each language is
 * its own stream: this phone syncs the organization's and the open
 * language's, and a screen about another language opens that one, in
 * place, without leaving the screen.
 */
function OrgWork(props: { actorId: string; email: string | null; signedIn: boolean; fromV2: boolean;
  orgId: string; noOrganizations: boolean; org: OrgHandle; openOrganization: Ctx['openOrganization']; invite: InviteHandle; arrival: Arrival | null }) {
  const liveOrg = props.org;
  const nav = useNav({ screen: 'sign_in' });
  // A Global Viewer whose access is on reads every organization, as a Viewer (decisions.md 158).
  const globalViewer = useGlobalViewer(props.actorId, props.signedIn).access;
  const { languageId, setLanguage, languages } = useWorkingLanguage(liveOrg.state, props.actorId, props.orgId, nav.current.params?.['languageId'],
    globalViewer === 'on');
  const liveLanguage = useLanguage(props.orgId, languageId, props.actorId, liveOrg.membershipEpoch);
  usePassagesInMemory(liveLanguage, nav.current.params?.['unitId']);
  useAccountSync(props.actorId);
  useProfileName(props.actorId, props.email);
  const blocks = useBlocks(props.actorId);
  // Read names again when someone joins, or a new member shows as a placeholder until restart.
  // Keyed on the state, not its members: the fold adds members in place (OrgHandle.state).
  const memberIds = useMemo(() => Object.keys(liveOrg.state?.members ?? {}).sort().join(','), [liveOrg.state]);
  const people = useDisplayNames(props.actorId, memberIds);
  const [devOpen, setDevOpen] = useState(false);
  const onboarding = useOnboarding(props.actorId, props.signedIn);
  // Someone from v2 is welcomed back to their work instead (demo ADR-043).
  const welcomeBack = useWelcomeBack(props.actorId, props.fromV2 && props.signedIn && onboarding.loaded && !onboarding.welcomed);
  const session = useMemo(
    () => deriveSession(props.actorId, props.email, onboarding.welcomed, liveOrg.state, languageId, hasWelcome(welcomeBack.data), globalViewer),
    [props.actorId, props.email, onboarding.welcomed, liveOrg.state, languageId, welcomeBack.data, globalViewer]
  );
  // A read-only session (a Global Viewer looking in) writes nothing, from any screen or hook (readOnly.ts).
  const { readOnly } = session;
  const { org, language } = useReadOnlyHandles(readOnly, liveOrg, liveLanguage);
  // Members' names, which a Global Viewer's own directory does not hold.
  const viewedNames = useGlobalViewerNames(props.orgId, session.viewingAsGlobalViewer);
  // Languages follow the library versions their template and flow are at (docs/library.md).
  useLibraryFollow(language, org, session);
  useTranslatorReview(org, session);
  // Sources phones may keep follow the offline scope (docs/reference-material.md).
  useSourceOffline(language, org, session);

  const { recent, remember } = useRecentPassages(props.actorId, props.orgId);
  const details = useDetails();
  const { toast, act, registerToast } = useActions(language);
  // Names: the signed-in person is always "you" (CORE-6).
  const name = useCallback((id: string, lower = false) => {
    if (id === props.actorId) return lower ? t('shell.youInSentence') : t('common.you');
    return people[id] ?? viewedNames[id] ?? personLook(id).name;
  }, [people, viewedNames, props.actorId]);
  const inbox = useInbox({ language, actorId: props.actorId, orgId: props.orgId, session, blocks, signedIn: props.signedIn });

  const { goFrom, go, openPassage, openTask } = useNavActions({ nav, session, toast, remember });
  useRouting({
    nav, session, signedIn: props.signedIn, actorId: props.actorId, orgId: props.orgId, noOrganizations: props.noOrganizations, arrival: props.arrival, openTask, setLanguage,
    loaded: foldsSettled(org.state !== null && org.settled, language.state !== null, props.noOrganizations),
    ready: onboarding.loaded && welcomeBack.loaded
  });
  const homeIsWork = homeScreenFor(session) === 'my_work';
  const { invite } = props;
  useIncoming({
    nav, invite, signedIn: props.signedIn, onboardingLoaded: onboarding.loaded, actorId: props.actorId, orgId: props.orgId,
    homeIsWork, toast, openTask, openOrganization: props.openOrganization
  });
  useTestProbes({ org, language, languageId, orgId: props.orgId, go, openTask });
  const canSwitchPersona = maySwitchPersona(props.email, IS_DEV);

  const home = useCallback(() => nav.reset({ screen: homeScreenFor(session) }), [nav, session]);
  // Android's Back for the whole app, and a Back arrow with nothing under it: to the first screen (useRootBack.ts).
  // Here, not in a child: this component's effects run after the navigator's, so its listener is asked first.
  const backFromRoot = useRootBack(nav, session, toast);
  const navBack = nav.back;
  const back = useCallback(() => { if (navRef.isReady() && navRef.canGoBack()) navBack(); else backFromRoot(); }, [navBack, backFromRoot]);
  const acceptTerms = useCallback((actorId = props.actorId) => recordUserEvent(actorId, 'v1.TermsAccepted'), [props.actorId]);
  const openDev = useCallback(() => setDevOpen(true), []);
  const inboxView = useMemo(
    () => ({ updates: inbox.updates, unread: inbox.unread, isRead: inbox.isRead, markRead: inbox.markRead }),
    [inbox.updates, inbox.unread, inbox.isRead, inbox.markRead]
  );
  const { data: welcomeData, refresh: refreshWelcome } = welcomeBack;
  const welcomeView = useMemo(() => (hasWelcome(welcomeData) ? { data: welcomeData, refresh: refreshWelcome } : null), [welcomeData, refreshWelcome]);
  const { markWelcomed } = onboarding;
  const { openOrganization } = props;
  const params = nav.current.params ?? NO_PARAMS;
  // One object until something a screen reads changes: the sync's ticking status is not in it (useSyncStatus.ts),
  // and the native stack keeps every screen below the top mounted, so each new `ctx` redraws all of them.
  const ctx: Ctx = useMemo(() => ({
    language,
    org,
    session,
    params,
    go,
    back,
    home,
    languageId,
    setLanguage,
    languages,
    act,
    toast,
    details,
    recent,
    openPassage,
    name,
    blocks,
    inbox: inboxView,
    ...(welcomeView ? { welcomeBack: welcomeView } : {}),
    markWelcomed,
    acceptTerms,
    markJoined,
    invite,
    openOrganization,
    openDev,
    isDev: IS_DEV,
    canSwitchPersona
  }), [language, org, session, params, go, back, home, languageId, setLanguage, languages, act, toast, details, recent, openPassage,
    name, blocks, inboxView, welcomeView, markWelcomed, acceptTerms, invite, openOrganization, openDev, canSwitchPersona]);
  const syncSources = useMemo(() => ({ language: language.syncStatus, org: org.syncStatus }), [language.syncStatus, org.syncStatus]);

  const screen = nav.current.screen;
  // A Global Viewer looking in has a link in every header: where they are, and the way to another
  // organization. It opens the Global Viewer screen as the tabs open theirs, as chrome (decision 71 amended).
  // In an organization of their own too, and before the code is entered: it is also where the code goes.
  const showLink = showsGlobalViewerLink(globalViewer, !!org.state?.org);
  const viewingName = session.viewingAsGlobalViewer ? org.state?.org?.value.name ?? '' : '';
  const navPush = nav.push;
  // The upload bar opens Sync from wherever it is shown, as chrome, like a tab (decisions.md 166).
  const openChrome = useCallback((screen: ScreenId) => { if (navRef.isReady() && navRef.getCurrentRoute()?.name !== screen) navPush({ screen }); }, [navPush]);
  const openSync = useCallback(() => openChrome('sync_status'), [openChrome]);
  const headerExtra = useMemo(() => (!showLink ? null : (
    <GlobalViewerLink orgName={viewingName} onPress={() => openChrome('global_viewer')} />
  )), [showLink, viewingName, openChrome]);
  // Phone, tablet or desktop by the window's width alone (decisions.md 55).
  const { width } = useWindowDimensions();
  const kind = layoutKind(width);
  const wide = kind !== 'phone';
  const showTabs = props.signedIn && homeScreenFor(session) !== 'intent_chooser' && chromeVisible(kind, screen);
  // Reports is a wide window's section (decisions.md 57): a window made narrow while
  // on it has no tab to leave by, so it goes home (RPT-002).
  useEffect(() => {
    if (kind === 'phone' && (screen === 'reports_home' || screen === 'reports_language')) nav.reset({ screen: homeScreenFor(session) });
  }, [kind, screen, nav, session]);
  const tabs = tabsFor(session, { forYou: inbox.forYou, unread: inbox.unread }, { wide });
  // The lit tab is the one you came from (the bottom of the stack), so a
  // passage opened from My Work stays under My Work.
  const bottom = nav.stack[0]?.screen;
  const activeTab: TabId = tabs.find((t) => t.screen === screen)?.id
    ?? tabs.find((t) => t.screen === bottom)?.id
    ?? ([...MAP_SCREENS, ...PASSAGE_READING].includes(screen) ? 'map' : 'manage');
  const navChrome = (variant: 'bar' | 'rail' | 'sidebar') => (
    <NavChrome variant={variant} tabs={tabs} active={activeTab} onSelect={(t) => { if (screen !== t.screen) nav.reset({ screen: t.screen }); }}
      {...(org.state?.org?.value.name ? { orgName: org.state.org.value.name } : {})} actorId={props.actorId} />
  );

  // A list and what it opened, side by side on a desktop-wide window (panes.ts).
  const found = kind === 'desktop' ? paneFor(nav.stack) : null;
  const listKey = found?.list.key;
  const split = found && listKey ? { ...found, list: { ...found.list, key: listKey } } : null;
  const box = frame(width, { chrome: wide && showTabs, split: !!split });
  const isSplit = !!split;
  // A desktop's sidebar names the organization at its top, so headers beside it leave the name out.
  const orgInChrome = kind === 'desktop' && showTabs;
  const stackLayout = useMemo((): Layout => ({ kind, contentWidth: box.detailWidth, role: isSplit ? 'detail' : 'single', orgInChrome }),
    [kind, box.detailWidth, isSplit, orgInChrome]);
  const paneLayout = useMemo((): Layout => ({ kind, contentWidth: box.paneWidth, role: 'list', orgInChrome }), [kind, box.paneWidth, orgInChrome]);
  const splitKey = split?.list.key;
  const splitEmpty = split?.empty;
  const paneKey = useMemo(() => (splitKey !== undefined ? { key: splitKey, ...(splitEmpty ? { empty: splitEmpty } : {}) } : null),
    [splitKey, splitEmpty]);
  const paneCtx: Ctx | null = split ? {
    ...ctx,
    params: split.list.params ?? {},
    go: (to, params) => goFrom(split.list.screen, split.list.key, to, params),
    back: () => nav.fromRoute(split.list.key, 'back', split.list),
    openPassage: (unitId, inLanguage, extra) => {
      remember(unitId, inLanguage);
      goFrom(split.list.screen, split.list.key, 'passage_record', { unitId, languageId: inLanguage, ...extra });
    }
  } : null;
  // The toast sits over the content, just above the top screen's footer, so it never covers its buttons.
  const [footers, setFooters] = useState<Record<string, number>>({});
  const reportFooter = useCallback((key: string, height: number) => {
    setFooters((f) => (f[key] === height ? f : { ...f, [key]: height }));
  }, []);
  const topKey = nav.stack[nav.stack.length - 1]?.key;
  const toastAbove = (topKey ? footers[topKey] ?? 0 : 0) + space.lg;
  const toastHost = (bottom: number) => <ToastHost register={registerToast} bottom={bottom} />;
  const openDetail: OpenDetail | null = split?.detail ? { screen: split.detail.screen, params: split.detail.params ?? {} } : null;

  return (
    <View style={{ flex: 1 }}>
      <ReadOnlyContext.Provider value={readOnly}>
      <SyncStatusContext.Provider value={syncSources}>
      <SyncEffects orgId={props.orgId} orgPulled={org.pulled} refused={language.refused} />
      <PeopleContext.Provider value={people}>
      <HeaderExtraContext.Provider value={headerExtra}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {wide && showTabs ? navChrome(kind === 'tablet' ? 'rail' : 'sidebar') : null}
          {split && paneCtx ? <PaneSlot key={split.list.key} route={split.list} ctx={paneCtx} layout={paneLayout} open={openDetail} /> : null}
          <LayoutContext.Provider value={stackLayout}>
          <PaneKeyContext.Provider value={paneKey}>
          <FooterReportContext.Provider value={reportFooter}>
          <CtxContext.Provider value={ctx}>
            <StudyPrefetch ctx={ctx} />
            {/* Its own box, so the native stack ends where the tab bar begins
                rather than drawing screens underneath it. */}
            <View style={{ flex: 1, overflow: 'hidden' }}>
            {/* What waits on this device to upload, over every screen but Sync itself (decisions.md 166). */}
            {screen === 'sync_status' ? null : <UploadBar ctx={ctx} onOpen={RECORDING_SCREENS.includes(screen) ? null : openSync} />}
            <NavigationContainer ref={navRef} onReady={nav.onReady} onStateChange={nav.onStateChange}
              documentTitle={{ formatter: (_options, route) => (route ? titleFor(route.name as ScreenId) : 'LangQuest') }}>
              <Stack.Navigator
                initialRouteName={nav.initial.screen}
                // Screens under the top one are frozen: they keep their state but skip renders until shown again (react-native-screens).
                screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, freezeOnBlur: true, contentStyle: { backgroundColor: C.bg } }}
              >
                {SCREEN_IDS.map((id) => (
                  // Tab-level screens are only ever reached by reset, so they
                  // crossfade like a tab switch; everything else slides like a
                  // push. On a wide window everything crossfades: the stack's
                  // box moves as a pane comes and goes, and a slide across it reads as a jump.
                  <Stack.Screen key={id} name={id} component={HOSTS[id]} options={{ animation: wide || TAB_SCREENS.includes(id) ? 'fade' : 'default' }} />
                ))}
              </Stack.Navigator>
            </NavigationContainer>
            {toastHost(toastAbove)}
            {/* Feedback from help mode, in the strip a screen leaves at its foot (decisions.md 145). */}
            <FeedbackHost ctx={ctx} screen={screen} signedIn={props.signedIn} />
            </View>
          </CtxContext.Provider>
          </FooterReportContext.Provider>
          </PaneKeyContext.Provider>
          </LayoutContext.Provider>
        </View>
        {!wide && showTabs ? navChrome('bar') : null}
      </HeaderExtraContext.Provider>
      </PeopleContext.Provider>
      </SyncStatusContext.Provider>
      </ReadOnlyContext.Provider>
      {/* Files this device deleted behind the app's back (decisions.md 92): over every screen until seen. */}
      <LostFilesAlert state={language.state} whatWere={language.blobs.lost} />
      {canSwitchPersona ? (
        <DevMenu open={devOpen} onClose={() => setDevOpen(false)} language={language} org={org} currentEmail={props.email} isOwner={session.role === 'owner'} isDev={IS_DEV} jump={(s) => nav.reset({ screen: s })} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.card },
  pane: { borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.bg },
  paneEmpty: { flex: 1, backgroundColor: C.bg, justifyContent: 'center' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' }
});

/**
 * The toast showing now, kept outside any component: signing in or opening an
 * organization remounts the shell, and with it the host, right after the
 * screen that said what happened ("Signed in", "… is ready to grow"). The new
 * host shows it for the rest of its time (AUTH-049, NOORG-009).
 */
let showing: { message: string; until: number } | null = null;

/**
 * Shows one toast at a time for 3.5 s, or as long as Android's "Time to take
 * action" asks (decision 159), twice as long while a screen reader is on. A
 * toast only says what happened: it never offers Undo (decision 134).
 */
function ToastHost(props: { register: (show: (spec: ToastSpec) => void) => void; bottom: number }) {
  const [spec, setSpec] = useState<ToastSpec | null>(() => {
    const left = showing ? showing.until - Date.now() : 0;
    return showing && left > 1000
      ? { id: Date.now(), message: showing.message, ms: left }
      : null;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reader = useRef(false);
  useEffect(() => {
    // react-native-web cannot tell and always answers yes, which doubled every toast on web.
    if (Platform.OS === 'web') return;
    readToastTime();
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => { reader.current = on; }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { reader.current = on; });
    return () => sub.remove();
  }, []);
  const { register } = props;
  useEffect(() => {
    register((next) => {
      if (timer.current) clearTimeout(timer.current);
      const ms = toastTime() * (reader.current ? 2 : 1);
      showing = { message: next.message, until: Date.now() + ms };
      setSpec({ ...next, ms });
      timer.current = setTimeout(() => setSpec((t) => (t?.id === next.id ? null : t)), ms);
    });
  }, [register]);
  // A toast carried over from the host before goes when its time is up.
  useEffect(() => {
    if (!spec?.ms || timer.current) return;
    const id = spec.id;
    const t = setTimeout(() => setSpec((cur) => (cur?.id === id ? null : cur)), spec.ms);
    return () => clearTimeout(t);
  }, [spec]);
  return <ToastView toast={spec} onDismiss={() => { showing = null; setSpec(null); }} bottom={props.bottom} />;
}

