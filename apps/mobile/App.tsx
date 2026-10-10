import { StudyPrefetch } from './src/study/StudyPrefetch';
import { HelpModeProvider, useScreenIntro } from './src/helpMode';
import { keepHelpAudio } from './src/helpAudio';
import { languageReady, onLanguageReady } from './src/i18n/start';
import { HelpScopeContext } from './src/helpContext';
import { CommandError, highlightsFor, orgLanguages, updatesFor, type EventSpec } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { CommonActions, NavigationContainer, NavigationContext, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AccessibilityInfo, Dimensions, Linking, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './src/text';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx, RecentPassage } from './src/ctx';
import { DevMenu } from './src/DevMenu';
import { UpdateBanner } from './src/UpdateBanner';
import { maySwitchPersona } from './src/dev';
import { edgeFor, MAP_SCREENS, PASSAGE_READING, SCREEN_IDS, TAB_SCREENS, type ScreenId } from './src/flow';
import { chromeVisible, frame, layoutKind } from './src/layout';
import { NavChrome } from './src/NavChrome';
import { lockPhonesToPortrait } from './src/orientation';
import { paneFor, type SplitSpec } from './src/panes';
import { onNotificationOpened } from './src/push';
import { LayoutContext, PaneSelectionContext, type Layout, type OpenDetail } from './src/useLayout';
import { indexesFor } from './src/indexes';
import { EmptyState, FooterHeightContext, GhostBtn, ToastView, txt, type ToastSpec } from './src/kit';
import { installGlobalHandlers, noteExpected, reportError } from './src/report';
import { commandErrorText } from './src/coreText';
import { t } from './src/i18n';
import { personLook } from './src/people';
import { navRef, useNav, type Route, type StackParams } from './src/nav';
import * as Account from './src/screens/account';
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
import * as Study from './src/screens/study';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { StorageGate, useLeaveGuard } from './src/storageGate';
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, foldsSettled, homeScreenFor, postSignInScreen, tabsFor, type TabId } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { C, space } from './src/theme';
import { recordUserEvent } from './src/accountData';
import { useAccountSync, useDisplayNames, useProfileName } from './src/useAccount';
import { usePendingRequestCount } from './src/invites';
import { useBlocks, useOpenReportCount } from './src/moderationData';
import { PeopleContext } from './src/UserChip';
import { forgetKeyInAddress } from './src/appUrl';
import { sectionAtLoad, useWebHistory } from './src/webHistory';
import { titleFor } from './src/webPaths';
import { parseKey } from './src/inviteCode';
import { nextStep } from './src/heldInvite';
import { useHeldInvite, type InviteHandle } from './src/useHeldInvite';
import { useOrg, type OrgHandle } from './src/useOrg';
import { useLibraryFollow } from './src/library/follow';
import { useSourceOffline } from './src/sources/offline';
import { useLanguage } from './src/useLanguage';
import { useHandOvers } from './src/handOver';
import { openLanguage } from './src/languages';

const IS_DEV = __DEV__;
let initialLinkRead = false;

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element | null> = {
  sign_in: Entry.SignIn, terms_privacy: Entry.TermsPrivacy, explore_home: Entry.ExploreHome, create_account: Entry.CreateAccount,
  scan_qr: Entry.ScanQr, vision: Entry.Vision, intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg,
  request_access: Entry.RequestAccess, welcome: Onboarding.Welcome,
  my_work: Work.MyWork,
  status_home: MapScreens.StatusHome, map_home: MapScreens.MapHome, book_map: MapScreens.BookMap,
  passage_record: Passage.PassageRecord, version_detail: Passage.VersionDetail, review_detail: Passage.ReviewDetail,
  ask_someone: Passage.AskSomeone,
  guest_review: Review.GuestReview, add_record: Review.AddRecord, review_capture: Review.ReviewCapture,
  study_guide: Study.StudyGuide, study_step: Study.StudyStep, guide_editor: Study.GuideEditor,
  workspace: Translate.Workspace, back_translation: Translate.BackTranslation,
  key_terms: Config.KeyTerms, key_term_detail: Config.KeyTermDetail,
  inbox_home: Account.InboxHome, settings_home: Account.SettingsHome, profile_edit: Account.ProfileEdit,
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, delete_account: Account.DeleteAccount, sync_status: Account.SyncStatus,
  org_home: Org.OrgHome, language_home: Org.LanguageHome,
  new_language: Org.NewLanguage, members_list: Org.MembersList, invite_member: Org.InviteMember, invite_qr: Org.InviteQr,
  edit_member: Org.EditMember, review_teams: Org.ReviewTeams, review_team_editor: Org.ReviewTeamEditor,
  roles_home: Config.RolesHome, role_editor: Config.RoleEditor, reference_home: Config.ReferenceHome, material_editor: Config.MaterialEditor,
  flows_home: Config.FlowsHome, flow_editor: Config.FlowEditor,
  templates_home: Content.TemplatesHome, template_picker: Content.TemplatePicker, template_editor: Content.TemplateEditor,
  book_structure: Content.BookStructure,
  reports_home: Reports.ReportsHome, reports_language: Reports.ReportsLanguage,
  reference_bibles: Reference.ReferenceBibles, reference_source: Reference.ReferenceSource, reference_guides: Reference.ReferenceGuides,
  reference_coverage: Reference.ReferenceCoverage, passage_reference: Reference.PassageReference,
  bible_explore: Sources.BibleExplore,
  mic_setup: Simple.MicSetup, get_ready: Simple.GetReady,
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
    // What the screen is for, said the first time it opens (decision 71, demo a-helpFirst).
    const focused = useFocusedSafe();
    useScreenIntro(id, focused);
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
        <ScreenBoundary screen={id} onBack={ctx.back} onHome={ctx.home}>
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
 * moments: `supabaseConfigError` for a build that was assembled without its
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
class ScreenBoundary extends Component<{ screen: ScreenId; onBack: () => void; onHome: () => void; children: ReactNode }, { error: Error | null; id: string }> {
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
        <GhostBtn label={t('shell.errors.goBack')} icon="left" onPress={reset(this.props.onBack)} />
        <GhostBtn label={t('shell.errors.goToMyWork')} icon="home" onPress={reset(this.props.onHome)} />
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
  // Help speaks offline too: keep the recorded help lines of the app's language (decision 80).
  useEffect(() => { void keepHelpAudio(); }, []);
  // Work people left unsent when they signed out of this phone goes as them (decisions.md 60).
  useHandOvers(auth === undefined ? undefined : auth?.user.id ?? null);
  useEffect(() => {
    if (supabaseConfigError) return;
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <UpdateBanner />
        {supabaseConfigError ? (
          <Fatal title={t('shell.errors.notConfigured')} detail={supabaseConfigError} />
        ) : auth === undefined || !wordsReady ? null : (
          <ErrorBoundary>
            {/* Help mode: a ? on every screen's header; while on, taps explain (demo ADR-038). */}
            <HelpModeProvider>
            <StorageGate>
              <Shell key={auth?.user.id ?? 'guest'} actorId={auth?.user.id ?? 'guest'} email={auth?.user.email ?? null} signedIn={!!auth} />
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
function Shell(props: { actorId: string; email: string | null; signedIn: boolean }) {
  // None until this account's organization is known: a guest, or an account
  // in no organization, syncs nothing. Opening a placeholder instead asked the
  // server for an organization this person is not in.
  const [orgId, setOrgId] = useState<string | null>(null);
  const [decided, setDecided] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [noOrganizations, setNoOrganizations] = useState(false);
  const key = `selection:${props.actorId}`;
  // Set once an organization is opened here; a slower "my organizations"
  // reply from before must not overrule it (it once said "none" right
  // after an invite had been used, docs/invites-and-accounts.md section 1).
  const chosen = useRef(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!props.signedIn) return;
      const raw = await AsyncStorage.getItem(key);
      // Saved before decision 34 as { orgId, languageId }: the org is what counts.
      const saved = raw ? (JSON.parse(raw) as { orgId?: string }).orgId : undefined;
      if (saved) { if (active) setOrgId(saved); return; }
      // Nothing chosen on this device yet: open the first organization this
      // account belongs to, so someone just added to a team lands in it.
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) { noteExpected('restore organization', error); return; }
      const first = (data as { org_id: string }[] | null)?.[0];
      if (!active || chosen.current) return;
      // The server's own list is empty: a new account, in no organization yet.
      setNoOrganizations(!first);
      if (!first) return;
      await AsyncStorage.setItem(key, JSON.stringify({ orgId: first.org_id }));
      setOrgId(first.org_id);
    })().catch((e: unknown) => { reportError('restore organization', e); })
      .finally(() => { if (active) setDecided(true); });
    return () => { active = false; };
  }, [key, props.signedIn]);
  const openOrganization = useCallback(async (next: string) => {
    chosen.current = true;
    await AsyncStorage.setItem(key, JSON.stringify({ orgId: next }));
    setNoOrganizations(false);
    setOrgId(next);
    setDecided(true);
    setSelectionRevision((revision) => revision + 1);
  }, [key]);
  // The held invite is used here, above the organization, so opening the
  // organization it joined cannot interrupt it.
  const invite = useHeldInvite(props.signedIn ? props.actorId : null, openOrganization);
  if (!decided) return <View style={styles.root} accessibilityLabel={t('shell.openingOrganization')} />;
  return <Workspace key={`${orgId}:${selectionRevision}`} {...props} orgId={orgId} noOrganizations={noOrganizations} openOrganization={openOrganization} invite={invite} />;
}

/**
 * One organization: its stream, and the languages it lists there. Until
 * the org fold is read (and, on a device that has never seen this org, until
 * the first sync has had its chance), which languages it has is unknown, so
 * nothing is opened yet.
 */
function Workspace(props: { actorId: string; email: string | null; signedIn: boolean; orgId: string | null; noOrganizations: boolean; openOrganization: Ctx['openOrganization']; invite: InviteHandle }) {
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
function OrgWork(props: { actorId: string; email: string | null; signedIn: boolean;
  orgId: string; noOrganizations: boolean; org: OrgHandle; openOrganization: Ctx['openOrganization']; invite: InviteHandle }) {
  const org = props.org;
  const nav = useNav({ screen: 'sign_in' });
  // ---- the language this person works in (MAP-7), and so the stream open ----
  const languageKey = `language:${props.actorId}:${props.orgId}`;
  const [savedLanguage, setSavedLanguage] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(languageKey).then(setSavedLanguage).catch(() => {}); }, [languageKey]);
  const setLanguage = useCallback((id: string) => { setSavedLanguage(id); AsyncStorage.setItem(languageKey, id).catch(() => {}); }, [languageKey]);
  const paramLanguage = nav.current.params?.['languageId'];
  const languageId = useMemo(() => openLanguage(org.state, props.actorId, { param: paramLanguage, saved: savedLanguage }),
    [org.state, props.actorId, paramLanguage, savedLanguage]);
  // A screen about a language makes it the one this person works in.
  useEffect(() => { if (languageId && languageId === paramLanguage && languageId !== savedLanguage) setLanguage(languageId); }, [languageId, paramLanguage, savedLanguage, setLanguage]);
  const languages = useMemo(() => orgLanguages(org.state), [org.state]);
  const language = useLanguage(props.orgId, languageId, props.actorId, org.membershipEpoch);
  // Web: warn before the tab closes with work still to send (storageGate.tsx).
  useLeaveGuard(!language.refused && (language.pending > 0 || language.blobs.pendingUp > 0) || org.pending > 0);
  useAccountSync(props.actorId);
  useProfileName(props.actorId, props.email);
  const blocks = useBlocks(props.actorId);
  // Read names again when someone joins, or a new member shows as a placeholder until restart.
  // Keyed on the state, not its members: the fold adds members in place (OrgHandle.state).
  const memberIds = useMemo(() => Object.keys(org.state?.members ?? {}).sort().join(','), [org.state]);
  const profileNames = useDisplayNames(props.actorId, memberIds);
  const people = profileNames;
  const [welcomed, setWelcomed] = useState(false);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  // The first sign-in welcome (ADR-022) is shown once per account. The flag
  // is the one the vision screen used to set, so people already past
  // onboarding are not welcomed again.
  useEffect(() => {
    let active = true;
    void (async () => {
      const [local, joined] = await Promise.all([AsyncStorage.getItem(`vision:${props.actorId}`), AsyncStorage.getItem(`joined:${props.actorId}`)]);
      // Joining by invite always gets the welcome (ADR-022): who invited
      // you and your role on which team are new even to a returning account.
      if (active) { setWelcomed(local === '1' && joined !== '1'); setOnboardingLoaded(true); }
      if (!props.signedIn || joined === '1') return;
      const { data, error } = await supabase.rpc('get_user_state');
      if (!error && data?.visionSeen) {
        await AsyncStorage.setItem(`vision:${props.actorId}`, '1');
        if (active) setWelcomed(true);
      }
    })().catch(() => { if (active) setOnboardingLoaded(true); });
    return () => { active = false; };
  }, [props.actorId]);

  const session = useMemo(
    () => deriveSession(props.actorId, props.email, welcomed, org.state, languageId),
    [props.actorId, props.email, welcomed, org.state, languageId]
  );
  // Languages follow the library versions their template and flow are at (docs/library.md).
  useLibraryFollow(language, org, session);
  // Sources phones may keep follow the offline scope (docs/reference-material.md).
  useSourceOffline(language, org, session);

  // ---- passages opened lately (WORK-2) ----
  const recentKey = `recent:${props.actorId}:${props.orgId}`;
  const [recent, setRecent] = useState<RecentPassage[]>([]);
  useEffect(() => { AsyncStorage.getItem(recentKey).then((v) => setRecent(v ? JSON.parse(v) : [])).catch(() => {}); }, [recentKey]);
  const remember = useCallback((unitId: string, inLanguage: string) => {
    setRecent((prev) => {
      const next = [{ unitId, languageId: inLanguage, at: Date.now() }, ...prev.filter((r) => r.unitId !== unitId || r.languageId !== inLanguage)].slice(0, 12);
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [recentKey]);

  // ---- details on request (ADR-013), kept for the session ----
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const details = useCallback((key: string) => ({
    open: !!openDetails[key],
    onToggle: () => setOpenDetails((d) => ({ ...d, [key]: !d[key] }))
  }), [openDetails]);

  // ---- toasts (CORE-5) ----
  // Toasts live in their own component, so showing one never re-renders
  // the screens on the stack; `toast` only hands the message over.
  const showToast = useRef<(spec: ToastSpec) => void>(() => {});
  const toast = useCallback((message: string, undo?: () => void | Promise<void>) => {
    const spec: ToastSpec = { id: Date.now(), message, ...(undo ? { undo } : {}) };
    showToast.current(spec);
  }, []);
  const languageRef = useRef(language);
  languageRef.current = language;
  const act = useCallback(async (specs: EventSpec[], message: string, undo?: () => EventSpec[]) => {
    try {
      await languageRef.current.run(specs);
    } catch (e) {
      // Core's refusal in words; anything else is a fault, with its code.
      toast(e instanceof CommandError ? t('shell.toast.notSaved', { reason: commandErrorText(e) }) : t('shell.toast.notSavedCode', { code: reportError('save change', e) }));
      throw e;
    }
    toast(message, undo ? async () => {
      try { await languageRef.current.run(undo()); toast(t('common.undone')); } catch (e) {
        toast(e instanceof CommandError ? t('shell.toast.notUndone', { reason: commandErrorText(e) }) : t('shell.toast.notUndoneCode', { code: reportError('undo change', e) }));
      }
    } : undefined);
  }, [toast]);

  // ---- names: the signed-in person is always "you" (CORE-6) ----
  const name = useCallback((id: string, lower = false) => {
    if (id === props.actorId) return lower ? t('shell.youInSentence') : t('common.you');
    return people[id] ?? personLook(id).name;
  }, [people, props.actorId]);

  // ---- what is waiting, and what happened (WORK-1, INBOX-1) ----
  const forYou = useMemo(() => language.state
    ? highlightsFor(language.state, props.actorId, { canRecord: session.can('translate'), canReview: session.can('review') }, indexesFor(language.state)).length
    : 0, [language.state, props.actorId, session]);
  // Nothing from someone this person blocked reaches their Inbox (decisions.md 48).
  const updates = useMemo(() => language.state
    ? updatesFor(language.state, props.actorId, indexesFor(language.state)).filter((u) => !blocks.has(u.by))
    : [], [language.state, props.actorId, blocks]);
  const readKey = `inbox-read:${props.actorId}:${props.orgId}`;
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { AsyncStorage.getItem(readKey).then((v) => setReadIds(new Set(v ? JSON.parse(v) as string[] : []))).catch(() => {}); }, [readKey]);
  const markRead = useCallback((ids: string[]) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      AsyncStorage.setItem(readKey, JSON.stringify([...next].slice(-2000))).catch(() => {});
      return next;
    });
  }, [readKey]);
  const unread = updates.filter((u) => !readIds.has(u.id)).length;

  // Auth routing is an invariant, not a transition: a signed-in session is
  // never on a pre-auth screen, a signed-out one is only on the screens a
  // guest may see. Checked every render because it is a property of the
  // state, not of an edge; each branch makes its own guard false, so it
  // settles in one extra render.
  //
  // Both folds must be loaded first, the org synced once (foldsSettled):
  // postSignInScreen reads the role out of them, and routing early sends an
  // admin to the wrong home, or a new member to no home at all.
  const loaded = foldsSettled(org.state !== null && org.settled, language.state !== null, props.noOrganizations);
  // Rendering must not wait on the log fold. The home screen for this
  // actor is remembered from the last session and routed to at once; every
  // screen already renders a light placeholder while its state is null.
  // A role change is caught below once both folds are in.
  // Web: the section the address named when the page loaded (a refresh), if this person may open it (webHistory.ts).
  const urlSection = useRef<ScreenId | null>(sectionAtLoad);
  const takeUrlSection = (): ScreenId | null => {
    const s = urlSection.current;
    urlSection.current = null;
    if (!s) return null;
    const tabScreens = tabsFor(session, undefined, { wide: layoutKind(Dimensions.get('window').width) !== 'phone' }).map((t) => t.screen);
    const allowed = tabScreens.includes(s)
      || (s === 'map_home' && tabScreens.some((t) => t === 'status_home' || t === 'map_home'))
      || (s === 'language_home' && tabScreens.includes('org_home'));
    return allowed ? s : null;
  };
  useWebHistory(nav.stack, nav.back);
  // A returning person first lands on their cached home; once the session is
  // in, the section in the address (a refresh) takes over, if they may open it.
  useEffect(() => {
    if (!loaded || !props.signedIn || !urlSection.current || session.isFirstTime) return;
    if (AUTH_SCREENS.includes(nav.current.screen)) return;
    const s = takeUrlSection();
    if (s && nav.current.screen !== s) nav.reset({ screen: s });
  });
  const homeKey = `home:${props.actorId}:${props.orgId}`;
  const [cachedHome, setCachedHome] = useState<ScreenId | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(homeKey).then((v) => setCachedHome((v as ScreenId | null) ?? null)).catch(() => setCachedHome(null));
  }, [homeKey]);
  useEffect(() => {
    if (!loaded || !props.signedIn) return;
    const home = homeScreenFor(session);
    if (home !== cachedHome) {
      setCachedHome(home);
      AsyncStorage.setItem(homeKey, home).catch(() => {});
      if (cachedHome && nav.current.screen === cachedHome) nav.reset({ screen: home });
    }
  }, [loaded, props.signedIn, session, cachedHome, homeKey, nav]);
  useEffect(() => {
    if (!props.signedIn) {
      // Not "anything but sign_in": a guest legitimately walks to Create
      // account, Browse public languages, the terms and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (!onboardingLoaded) return;
    if (!AUTH_SCREENS.includes(nav.current.screen)) return;
    if (loaded) nav.reset({ screen: (!session.isFirstTime && takeUrlSection()) || postSignInScreen(session) });
    else if (cachedHome && !session.isFirstTime) nav.reset({ screen: cachedHome });
  });

  // Every move follows a declared edge from the screen it starts on: the top
  // of the stack, or the list in a split's pane (`fromKey`), which moves as
  // if it were on top (panes.ts).
  const goFrom = useCallback(
    (from: ScreenId, fromKey: string | undefined, to: ScreenId, params?: Record<string, string>) => {
      const edge = edgeFor(from, to) ?? (edgeFor(from, 'home_hub') && to === homeScreenFor(session) ? edgeFor(from, 'home_hub') : undefined);
      const route: Route = params ? { screen: to, params } : { screen: to };
      if (!edge) {
        if (TAB_SCREENS.includes(to)) return nav.reset(route);
        reportError(`flow blocked ${from} -> ${to}: no edge`, new Error('undeclared transition'));
        toast(t('shell.nav.cannotOpenHere'));
        return;
      }
      // Gates are permissions (who MAY act), part of the machine: a screen
      // must not offer an affordance the session cannot take.
      if (!edgeAllowed(edge, session)) {
        reportError(`flow blocked ${from} -> ${to}: gate ${edge.when}`, new Error('gate not met'));
        toast(t('shell.nav.noPermission'));
        return;
      }
      const mode = edge.mode ?? 'push';
      if (fromKey && fromKey !== nav.stack[nav.stack.length - 1]?.key) return nav.fromRoute(fromKey, mode, route);
      switch (mode) {
        case 'push': return nav.push(route);
        case 'replace': return nav.replace(route);
        case 'reset': return nav.reset(route);
        case 'back': return nav.back();
        case 'popTo': return nav.popTo(to, params);
      }
    },
    [nav, session]
  );
  const go = useCallback((to: ScreenId, params?: Record<string, string>) => goFrom(nav.current.screen, undefined, to, params),
    [goFrom, nav.current.screen]);

  const openPassage = useCallback((unitId: string, inLanguage: string, extra?: Record<string, string>) => {
    remember(unitId, inLanguage);
    go('passage_record', { unitId, languageId: inLanguage, ...extra });
  }, [go, remember]);

  // A link that opens the app is a scan (docs/invites-and-accounts.md flow D).
  const { invite } = props;
  useEffect(() => {
    const receive = (url: string) => {
      const key = parseKey(url);
      if (!key) return;
      forgetKeyInAddress();
      if (key.kind === 'signin') { nav.reset({ screen: 'scan_qr', params: { code: url } }); return; }
      void invite.scan(key).then(() => nav.reset({ screen: 'scan_qr' }));
    };
    if (!initialLinkRead) {
      initialLinkRead = true;
      void Linking.getInitialURL().then((url) => { if (url) receive(url); });
    }
    const listener = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => listener.remove();
  }, [nav.reset, invite.scan]);
  // An invite nobody has claimed is shown to whoever is signed in, once, to
  // ask "Join as you?"; it never joins on its own (heldInvite.ts).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!props.signedIn || !onboardingLoaded || !invite.held) return;
    const step = nextStep(invite.held, props.actorId, Date.now());
    if (step.step !== 'ask' || asked.current === invite.held.token) return;
    asked.current = invite.held.token;
    if (nav.current.screen !== 'scan_qr') nav.reset({ screen: 'scan_qr' });
  }, [props.signedIn, onboardingLoaded, invite.held, props.actorId, nav]);

  const canSwitchPersona = maySwitchPersona(props.email, IS_DEV);

  const homeIsWork = homeScreenFor(session) === 'my_work';
  useEffect(() => {
    if (!props.signedIn) return;
    return onNotificationOpened(() => {
      // People with a My Work reach the Inbox from its bell, so it opens over My Work with Back (no Inbox tab).
      if (homeIsWork && navRef.isReady()) {
        navRef.dispatch(CommonActions.reset({ index: 1, routes: [{ name: 'my_work' }, { name: 'inbox_home', params: { from: 'my_work' } }] }));
      } else nav.reset({ screen: 'inbox_home' });
    });
  }, [props.signedIn, nav.reset, homeIsWork]);

  // Open reports count toward the Inbox badge (the tab, or My Work's bell) for whoever may act on them (decisions.md 48).
  const reportCount = useOpenReportCount(props.orgId, props.signedIn && (session.can('manage_structure') || session.can('invite_members')));
  // People asking to join count too, for whoever may admit them.
  const requestCount = usePendingRequestCount(props.orgId, props.signedIn && session.can('invite_members'));
  const inboxCount = unread + reportCount + requestCount;

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
    inbox: { updates, unread: inboxCount, isRead: (id) => readIds.has(id), markRead },
    markWelcomed: async () => {
      await recordUserEvent(props.actorId, 'v1.VisionSeen');
      await AsyncStorage.multiSet([[`vision:${props.actorId}`, '1'], [`joined:${props.actorId}`, '0']]);
      setWelcomed(true);
    },
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
  const tabs = tabsFor(session, { forYou, unread: inboxCount }, { wide });
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
  const stackLayout = useMemo((): Layout => ({ kind, contentWidth: box.detailWidth, role: split ? 'detail' : 'single' }),
    [kind, box.detailWidth, !!split]);
  const paneLayout = useMemo((): Layout => ({ kind, contentWidth: box.paneWidth, role: 'list' }), [kind, box.paneWidth]);
  const paneKey = useMemo(() => (split ? { key: split.list.key, ...(split.empty ? { empty: split.empty } : {}) } : null),
    [split?.list.key, split?.empty]);
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
  // The toast on a wide window: over the content, just above the top screen's footer.
  const [footers, setFooters] = useState<Record<string, number>>({});
  const reportFooter = useCallback((key: string, height: number) => {
    setFooters((f) => (f[key] === height ? f : { ...f, [key]: height }));
  }, []);
  const topKey = nav.stack[nav.stack.length - 1]?.key;
  const toastAbove = (topKey ? footers[topKey] ?? 0 : 0) + space.lg;
  const toastHost = (bottom: number) => <ToastHost register={(show) => { showToast.current = show; }} bottom={bottom} />;
  const openDetail: OpenDetail | null = split?.detail ? { screen: split.detail.screen, params: split.detail.params ?? {} } : null;

  return (
    <View style={{ flex: 1 }}>
      <PeopleContext.Provider value={people}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {wide && showTabs ? navChrome(kind === 'tablet' ? 'rail' : 'sidebar') : null}
          {split && paneCtx ? <PaneSlot key={split.list.key} route={split.list} ctx={paneCtx} layout={paneLayout} open={openDetail} /> : null}
          <LayoutContext.Provider value={stackLayout}>
          <PaneKeyContext.Provider value={paneKey}>
          <FooterReportContext.Provider value={wide ? reportFooter : null}>
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
            {wide ? toastHost(toastAbove) : null}
            </View>
          </CtxContext.Provider>
          </FooterReportContext.Provider>
          </PaneKeyContext.Provider>
          </LayoutContext.Provider>
        </View>
        {!wide && showTabs ? navChrome('bar') : null}
      </PeopleContext.Provider>
      {wide ? null : toastHost(showTabs ? 96 : 24)}
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
function ToastHost(props: { register: (show: (spec: ToastSpec) => void) => void; bottom: number }) {
  const [spec, setSpec] = useState<ToastSpec | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reader = useRef(false);
  useEffect(() => {
    // react-native-web cannot tell and always answers yes, which doubled every toast on web.
    if (Platform.OS === 'web') return;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => { reader.current = on; }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (on) => { reader.current = on; });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    props.register((next) => {
      if (timer.current) clearTimeout(timer.current);
      setSpec(next);
      const ms = (next.undo ? 7000 : 3500) * (reader.current ? 2 : 1);
      timer.current = setTimeout(() => setSpec((t) => (t?.id === next.id ? null : t)), ms);
    });
  }, [props.register]);
  return <ToastView toast={spec} onDismiss={() => setSpec(null)} bottom={props.bottom} />;
}

