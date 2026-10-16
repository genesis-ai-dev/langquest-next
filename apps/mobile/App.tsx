import { StudyPrefetch } from './src/study/StudyPrefetch';
import { HelpModeProvider } from './src/helpMode/helpMode';
import { keepHelpAudio } from './src/helpMode/helpAudio';
import { languageReady, onLanguageReady } from './src/i18n/start';
import { HelpScopeContext } from './src/helpMode/useHelpMode';
import { stopAudioPlayback } from './src/audio/audioSession';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, NavigationContext, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './src/ui/text';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from './src/shell/ctx';
import { DevMenu } from './src/shell/DevMenu';
import { UpdateBanner } from './src/shell/UpdateBanner';
import { maySwitchPersona } from './src/auth/dev';
import { MAP_SCREENS, PASSAGE_READING, SCREEN_IDS, TAB_SCREENS, type ScreenId } from './src/shell/flow';
import { chromeVisible, frame, layoutKind } from './src/ui/layout';
import { NavChrome } from './src/shell/NavChrome';
import { lockPhonesToPortrait } from './src/shell/orientation';
import { paneFor, type SplitSpec } from './src/shell/panes';
import { LayoutContext, PaneSelectionContext, type Layout, type OpenDetail, FooterHeightContext } from './src/ui/useLayout';
import { EmptyState, GhostBtn, ToastView, type ToastSpec } from './src/ui/kit';
import { txt } from './src/ui/textStyles';
import { installGlobalHandlers, reportError } from './src/diagnostics/report';
import { t } from './src/i18n';
import { personLook } from './src/ui/people';
import { navRef, type StackParams } from './src/shell/nav';
import { useNav } from './src/shell/useNav';
import * as Account from './src/screens/account';
import * as Checks from './src/screens/checks';
import * as Config from './src/screens/config';
import * as Content from './src/screens/content';
import * as Entry from './src/screens/entry';
import * as MapScreens from './src/screens/map';
import * as Onboarding from './src/screens/onboarding';
import * as Org from './src/screens/org';
import * as Passage from './src/screens/passage';
import * as Reference from './src/screens/reference';
import * as Reports from './src/screens/reports';
import * as Review from './src/screens/review';
import * as Sources from './src/screens/sources';
import * as Simple from './src/screens/simple';
import * as Ready from './src/screens/getReady';
import * as Study from './src/screens/study';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { StorageGate } from './src/web/storageGate';
import { useLeaveGuard } from './src/web/useLeaveGuard';
import { deriveSession, foldsSettled, homeScreenFor, tabsFor, type TabId } from './src/shell/session';
import { SESSION_KEY, onAuthChange, serverConfigError } from './src/server/auth';
import { afterAuthEvent, savedSession } from './src/auth/authState';
import { C, space } from './src/ui/theme';
import { recordUserEvent } from './src/account/accountData';
import { useAccountSync, useDisplayNames, useProfileName } from './src/account/useAccount';
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
import { useRouting } from './src/shell/useRouting';
import { useTestProbes } from './src/shell/useTestProbes';
import { useWorkingLanguage } from './src/shell/useWorkingLanguage';

const IS_DEV = __DEV__;

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element | null> = {
  sign_in: Entry.SignIn, terms_privacy: Entry.TermsPrivacy, explore_home: Entry.ExploreHome, create_account: Entry.CreateAccount,
  scan_qr: Entry.ScanQr, vision: Entry.Vision, intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg,
  request_access: Entry.RequestAccess, welcome: Onboarding.Welcome, welcome_back: Onboarding.WelcomeBack,
  my_work: Work.MyWork,
  status_home: MapScreens.StatusHome, map_home: MapScreens.MapHome, book_map: MapScreens.BookMap,
  passage_record: Passage.PassageRecord, version_detail: Passage.VersionDetail, review_detail: Passage.ReviewDetail, made_detail: Passage.MadeDetail,
  ask_someone: Passage.AskSomeone,
  guest_review: Review.GuestReview, add_record: Review.AddRecord, review_capture: Review.ReviewCapture,
  study_guide: Study.StudyGuide, study_step: Study.StudyStep, guide_editor: Study.GuideEditor,
  workspace: Translate.Workspace, back_translation: Translate.BackTranslation,
  key_terms: Config.KeyTerms, key_term_detail: Config.KeyTermDetail,
  inbox_home: Account.InboxHome, settings_home: Account.SettingsHome, profile_edit: Account.ProfileEdit,
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, delete_account: Account.DeleteAccount, sync_status: Account.SyncStatus,
  org_home: Org.OrgHome, cluster_home: Org.ClusterHome, language_home: Org.LanguageHome,
  new_language: Org.NewLanguage, members_list: Org.MembersList, invite_member: Org.InviteMember, invite_qr: Org.InviteQr,
  edit_member: Org.EditMember, check_editor: Checks.CheckEditor,
  roles_home: Config.RolesHome, role_editor: Config.RoleEditor, reference_home: Config.ReferenceHome, material_editor: Config.MaterialEditor,
  flows_home: Config.FlowsHome, flow_editor: Config.FlowEditor,
  templates_home: Content.TemplatesHome, template_picker: Content.TemplatePicker, template_editor: Content.TemplateEditor,
  book_structure: Content.BookStructure,
  reports_home: Reports.ReportsHome, reports_language: Reports.ReportsLanguage,
  reference_bibles: Reference.ReferenceBibles, reference_source: Reference.ReferenceSource, reference_guides: Reference.ReferenceGuides,
  reference_coverage: Reference.ReferenceCoverage, passage_reference: Reference.PassageReference,
  bible_explore: Sources.BibleExplore,
  mic_setup: Simple.MicSetup, get_ready: Ready.GetReady,
  settings_more: Account.SettingsMore
};

/**
 * Screens read the shared context through React context rather than props,
 * so the navigator can own the component tree (and its transitions) while
 * the Shell still owns state. `params` comes from the route, so a screen
 * below the top keeps its own params while another is pushed over it.
 */
const CtxContext = createContext<Ctx | null>(null);
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
    const wasFocused = useRef(focused);
    useEffect(() => {
      if (wasFocused.current && !focused) stopAudioPlayback();
      wasFocused.current = focused;
    }, [focused]);
    const pane = useContext(PaneKeyContext);
    const report = useContext(FooterReportContext);
    const key = props.route.key;
    const onFooter = useMemo(() => (report ? (height: number) => report(key, height) : null), [report, key]);
    if (!ctx) return null;
    if (pane && props.route.key === pane.key) return <PaneEmpty spec={pane.empty} />;
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
  // Help speaks offline too: keep the recorded help lines of the app's language (decision 81).
  useEffect(() => { void keepHelpAudio(); }, []);
  // Work people left unsent when they signed out of this phone goes as them (decisions.md 60).
  useHandOvers(auth === undefined ? undefined : auth?.user.id ?? null);
  useEffect(() => {
    if (serverConfigError) return;
    let active = true;
    // Whoever this phone holds a sign-in for, renewable right now or not
    // (authState.ts, decision 87): offline, supabase-js reports no one once
    // the token is an hour old, and took half a minute to say so.
    const fromStorage = (s: AuthSession | null) => { if (active) setAuth((now) => (now === undefined ? s : now)); };
    AsyncStorage.getItem(SESSION_KEY).then((raw) => fromStorage(savedSession(raw)), () => fromStorage(null));
    const unsubscribe = onAuthChange((event, s) => setAuth((now) => afterAuthEvent(now, event, s)));
    return () => { active = false; unsubscribe(); };
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <UpdateBanner />
        {serverConfigError ? (
          <Fatal title={t('shell.errors.notConfigured')} detail={serverConfigError} />
        ) : auth === undefined || !wordsReady ? null : (
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
  const org = props.org;
  const nav = useNav({ screen: 'sign_in' });
  const { languageId, setLanguage, languages } = useWorkingLanguage(org.state, props.actorId, props.orgId, nav.current.params?.['languageId']);
  const language = useLanguage(props.orgId, languageId, props.actorId, org.membershipEpoch);
  // Web: warn before the tab closes with work still to send (storageGate.tsx).
  useLeaveGuard(!language.refused && (language.pending > 0 || language.blobs.pendingUp > 0) || org.pending > 0);
  useAccountSync(props.actorId);
  useProfileName(props.actorId, props.email);
  const blocks = useBlocks(props.actorId);
  // Read names again when someone joins, or a new member shows as a placeholder until restart.
  // Keyed on the state, not its members: the fold adds members in place (OrgHandle.state).
  const memberIds = useMemo(() => Object.keys(org.state?.members ?? {}).sort().join(','), [org.state]);
  const people = useDisplayNames(props.actorId, memberIds);
  const [devOpen, setDevOpen] = useState(false);
  const onboarding = useOnboarding(props.actorId, props.signedIn);
  // Someone from v2 is welcomed back to their work instead (demo ADR-043).
  const welcomeBack = useWelcomeBack(props.actorId, props.fromV2 && props.signedIn && onboarding.loaded && !onboarding.welcomed);
  const session = useMemo(
    () => deriveSession(props.actorId, props.email, onboarding.welcomed, org.state, languageId, hasWelcome(welcomeBack.data)),
    [props.actorId, props.email, onboarding.welcomed, org.state, languageId, welcomeBack.data]
  );
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
    return people[id] ?? personLook(id).name;
  }, [people, props.actorId]);
  const inbox = useInbox({ state: language.state, actorId: props.actorId, orgId: props.orgId, session, blocks, signedIn: props.signedIn });

  const { goFrom, go, openPassage, openTask } = useNavActions({ nav, session, toast, remember });
  useRouting({
    nav, session, signedIn: props.signedIn, actorId: props.actorId, orgId: props.orgId, arrival: props.arrival, openTask, setLanguage,
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

  const ctx: Ctx = {
    language,
    org,
    session,
    params: nav.current.params ?? {},
    go,
    back: nav.back,
    home: () => nav.reset({ screen: homeScreenFor(session) }),
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
    inbox: { updates: inbox.updates, unread: inbox.unread, isRead: inbox.isRead, markRead: inbox.markRead },
    ...(hasWelcome(welcomeBack.data) ? { welcomeBack: { data: welcomeBack.data, refresh: welcomeBack.refresh } } : {}),
    markWelcomed: onboarding.markWelcomed,
    acceptTerms: (actorId = props.actorId) => recordUserEvent(actorId, 'v1.TermsAccepted'),
    markJoined: (actorId) => AsyncStorage.setItem(`joined:${actorId}`, '1'),
    invite,
    openOrganization: props.openOrganization,
    openDev: () => setDevOpen(true),
    isDev: IS_DEV,
    canSwitchPersona
  };

  const screen = nav.current.screen;
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
  const stackLayout = useMemo((): Layout => ({ kind, contentWidth: box.detailWidth, role: isSplit ? 'detail' : 'single' }),
    [kind, box.detailWidth, isSplit]);
  const paneLayout = useMemo((): Layout => ({ kind, contentWidth: box.paneWidth, role: 'list' }), [kind, box.paneWidth]);
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
      <PeopleContext.Provider value={people}>
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
            <NavigationContainer ref={navRef} onReady={nav.onReady} onStateChange={nav.onStateChange}
              documentTitle={{ formatter: (_options, route) => (route ? titleFor(route.name as ScreenId) : 'LangQuest') }}>
              <Stack.Navigator
                initialRouteName={nav.initial.screen}
                screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: C.bg } }}
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
            </View>
          </CtxContext.Provider>
          </FooterReportContext.Provider>
          </PaneKeyContext.Provider>
          </LayoutContext.Provider>
        </View>
        {!wide && showTabs ? navChrome('bar') : null}
      </PeopleContext.Provider>
      {/* Files this device deleted behind the app's back (decisions.md 92): over every screen until seen. */}
      <LostFilesAlert state={language.state} />
      {canSwitchPersona ? (
        <DevMenu open={devOpen} onClose={() => setDevOpen(false)} language={language} org={org} currentEmail={props.email} isOwner={session.role === 'owner'} isDev={IS_DEV} jump={(s) => nav.reset({ screen: s })} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.card },
  pane: { borderRightWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.bg },
  paneEmpty: { flex: 1, backgroundColor: C.bg, justifyContent: 'center' }
});

/**
 * Shows one toast at a time for about 7 s with Undo, 3.5 s without, and
 * twice as long while a screen reader is on, so Undo can be reached.
 */
/**
 * The toast showing now, kept outside any component: signing in or opening an
 * organization remounts the shell, and with it the host, right after the
 * screen that said what happened ("Signed in", "… is ready to grow"). The new
 * host shows it for the rest of its time (AUTH-049, NOORG-009). Its Undo is
 * not carried: the shell remounts when the account or the organization
 * changes, and an Undo from before would then act for the account or in the
 * organization that was left.
 */
let showing: { message: string; until: number } | null = null;

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
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => { reader.current = on; }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { reader.current = on; });
    return () => sub.remove();
  }, []);
  const { register } = props;
  useEffect(() => {
    register((next) => {
      if (timer.current) clearTimeout(timer.current);
      const ms = (next.undo ? 7000 : 3500) * (reader.current ? 2 : 1);
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

