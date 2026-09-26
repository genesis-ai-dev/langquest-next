import { AccountLifecycleBoundary } from './src/accountLifecycle';
import { AccountPreferencesProvider, usePreferences } from './src/accountPreferences';
import { AccountRecoveryBoundary } from './src/accountRecovery';
import { StyleSheet } from './src/theme';
import { deriveInbox, highlightsFor, isObtLane } from '@langquest-next/core';
import { indexesFor } from './src/indexes';
import { useInboxUnread } from './src/notifications';
import * as Obt from './src/screens/obt';
import * as DynamicBible from './src/screens/dynamicBible';
import * as ObtCapture from './src/screens/obtCapture';
import * as ObtManage from './src/screens/obtManage';
import { orgQueries } from './src/orgQueries';
import { getStore } from './src/store';
import { withOrgMembers } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Building2, CheckCircle2, ClipboardList, Inbox, Map as MapIcon, Settings, type LucideIcon } from 'lucide-react-native';
import { NavigationContainer, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from './src/ctx';
import { DevMenu } from './src/DevMenu';
import { UpdateBanner } from './src/UpdateBanner';
import { maySwitchPersona } from './src/dev';
import { edgeFor, SCREEN_IDS, TAB_SCREENS, type ScreenId } from './src/flow';
import { navRef, useNav, type Route, type StackParams } from './src/nav';
import * as Account from './src/screens/account';
import * as Config from './src/screens/config';
import * as Entry from './src/screens/entry';
import * as Org from './src/screens/org';
import * as PassageSlides from './src/screens/passageSlides';
import * as Record from './src/screens/record';
import * as Review from './src/screens/review';
import * as Status from './src/screens/status';
import * as MapScreens from './src/screens/map';
import * as Study from './src/screens/study';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { AUTH_SCREENS, GUEST_SCREENS, activeTabFor, deriveSession, edgeAllowed, homeScreenFor, postSignInScreen, tabsFor, type TabId } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { colors, radius, space } from './src/theme';
import { recordUserEvent, TERMS_VERSION } from './src/accountData';
import { useAccountSync, useDisplayNames } from './src/useAccount';
import { PeopleContext } from './src/UserChip';
import { parseInvite } from './src/inviteCode';
import { useOrg } from './src/useOrg';
import { useProject } from './src/useProject';
import { recentKey, rememberRecent, RECENT_SCREENS } from './src/recent';

// Initial selection, before the account's saved organization is restored.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';
const PROJECT_ID = process.env.EXPO_PUBLIC_PROJECT_ID ?? 'luke-demo-4';
const IS_DEV = __DEV__;
let initialLinkRead = false;

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element | null> = {
  dynamic_bible: DynamicBible.DynamicBible,
  obt_passage: Obt.WorkflowPassage, obt_interaction: ObtCapture.ObtCapture, obt_manage: ObtManage.ObtManage,
  sign_in: Entry.SignIn, create_account: Entry.CreateAccount, terms_privacy: Entry.TermsPrivacy, vision: Entry.Vision,
  intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg,
  request_access: Entry.RequestAccess, scan_qr: Entry.ScanQr, walkthrough: Entry.Walkthrough,
  my_work: Work.MyWork,
  passage_record: Record.PassageRecord, ask_someone: Record.AskSomeone, add_record: Record.AddRecord,
  workspace: Translate.Workspace, review_capture: Review.ReviewCapture, back_translation: Obt.BackTranslation,
  study_guide: Study.StudyGuide, study_step: Study.StudyStep,
  translate_passage: Translate.TranslatePassage,
  passage_references: PassageSlides.PassageReferences, passage_terms: PassageSlides.PassageTerms,
  review_passage: Review.ReviewPassage,
  material_editor: Review.MaterialEditor,
  status_home: Status.StatusHome, map_home: MapScreens.MapHome, book_map: MapScreens.BookMap,
  version_detail: Record.VersionDetail, review_detail: Record.ReviewDetail,
  org_home: Org.OrgHome, project_home: Org.ProjectHome, language_home: Org.LanguageHome,
  members_list: Org.MembersList, invite_member: Org.InviteMember, invite_qr: Org.InviteQr, edit_member: Org.EditMember,
  new_project: Org.NewProject, new_language: Org.NewLanguage, review_teams: Org.ReviewTeams, review_team_editor: Org.ReviewTeamEditor,
  roles_home: Config.RolesHome, role_editor: Config.RoleEditor, templates_home: Config.TemplatesHome,
  reference_home: Config.ReferenceHome, key_terms: Config.KeyTerms, key_term_detail: Config.KeyTermDetail,
  flows_home: Config.FlowsHome, flow_editor: Config.FlowEditor,
  inbox_home: Account.InboxHome, settings_home: Account.SettingsHome, profile_edit: Account.ProfileEdit,
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, sync_status: Account.SyncStatus
};

/**
 * Screens read the shared context through React context rather than props,
 * so the navigator can own the component tree (and its transitions) while
 * the Shell still owns state. `params` comes from the route, so a screen
 * below the top keeps its own params while another is pushed over it.
 */
const CtxContext = createContext<Ctx | null>(null);
const Stack = createNativeStackNavigator<StackParams>();

type HostProps = { route: RouteProp<StackParams, ScreenId> };
function hostFor(id: ScreenId) {
  function Host(props: HostProps) {
    const ctx = useContext(CtxContext);
    if (!ctx) return null;
    const params = props.route.params ?? {};
    const laneId = params.laneId ?? params.taskId?.split(':')[2] ?? '';
    const oral = !!ctx.project.state && (ctx.project.state.obt.workspace || isObtLane(ctx.project.state,laneId));
    const workspace = ctx.project.state?.obt.workspace;
    if (workspace && !['obt_passage','translate_passage','back_translation','my_work',
      'settings_home','org_switcher','sign_out_confirm','sync_status','profile_edit'].includes(id)) {
      return <Obt.BackTranslation {...ctx} params={{ taskId:'translate:passage:output' }} />;
    }
    const Screen = oral && (id === 'translate_passage' || id === 'review_passage') ? Obt.WorkflowPassage : SCREENS[id];
    return <Screen {...ctx} params={params} />;
  }
  Host.displayName = `Host(${id})`;
  return Host;
}
const HOSTS = {} as Record<ScreenId, (props: HostProps) => React.JSX.Element | null>;
for (const id of SCREEN_IDS) HOSTS[id] = hostFor(id);

/**
 * Whatever is wrong, the app says so. A release build has no redbox: an
 * uncaught error there is a white screen, which tells a tester on TestFlight
 * nothing and a developer less. Two backstops, because they catch different
 * moments: `supabaseConfigError` for a build that was assembled without its
 * configuration, and this boundary for anything thrown while rendering.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] unhandled render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return <Fatal title="Something went wrong" detail={`${this.state.error.message}\n\n${this.state.error.stack ?? ''}`} />;
  }
}

/** A message a tester can read out over a call, and a developer can act on. */
function Fatal(props: { title: string; detail: string }) {
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
      <Text style={{ fontSize: 17, fontWeight: '600', color: colors.foreground }}>{props.title}</Text>
      <Text style={{ fontSize: 13, color: colors.mutedForeground }} selectable>
        {props.detail}
      </Text>
    </ScrollView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AccountPreferencesProvider>
        <AccountRecoveryBoundary>
          <AccountLifecycleBoundary>
            <AppContent />
          </AccountLifecycleBoundary>
        </AccountRecoveryBoundary>
      </AccountPreferencesProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  usePreferences();
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  useEffect(() => {
    if (supabaseConfigError) return;
    supabase.auth.getSession().then(({ data }) => setAuth(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setAuth(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style={colors.background === '#151820' ? 'light' : 'dark'} />
        <UpdateBanner />
        {supabaseConfigError ? (
          <Fatal title="This build is not configured" detail={supabaseConfigError} />
        ) : auth === undefined ? null : (
          <ErrorBoundary>
            <Shell key={auth?.user.id ?? 'guest'} actorId={auth?.user.id ?? 'guest'} email={auth?.user.email ?? null} signedIn={!!auth} />
          </ErrorBoundary>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Shell(props: { actorId: string; email: string | null; signedIn: boolean }) {
  const [selection, setSelection] = useState({ orgId: ORG_ID, projectId: PROJECT_ID });
  const [selectionRevision, setSelectionRevision] = useState(0);
  // One-shot: the screen to open once the switched-to project loads.
  const [landing, setLanding] = useState<ScreenId | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(`selection:${props.actorId}`).then((raw) => {
      if (active && raw) setSelection(JSON.parse(raw));
    }).catch(() => {});
    return () => { active = false; };
  }, [props.actorId]);
  const openOrganization = useCallback(async (orgId: string, projectId?: string, landingScreen?: ScreenId) => {
    if (!projectId) {
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) throw new Error(error.message);
      projectId = data?.find((r: { org_id: string }) => r.org_id === orgId)?.project_id ?? 'unselected';
    }
    const next = { orgId, projectId: projectId! };
    await AsyncStorage.setItem(`selection:${props.actorId}`, JSON.stringify(next));
    await AsyncStorage.removeItem('pending-invite');
    setSelection(next);
    setLanding(landingScreen);
    setSelectionRevision((revision) => revision + 1);
  }, [props.actorId]);
  return <Workspace key={`${selection.orgId}:${selection.projectId}:${selectionRevision}`} {...props}
    {...selection} landing={landing} openOrganization={openOrganization} />;
}

function Workspace(props: { actorId: string; email: string | null; signedIn: boolean;
  orgId: string; projectId: string; landing?: ScreenId; openOrganization: Ctx['openOrganization'] }) {
  const rawProject = useProject(props.orgId, props.projectId, props.actorId);
  const org = useOrg(props.orgId, props.actorId);
  const projectedState = useMemo(() => rawProject.state && org.state
    ? withOrgMembers(rawProject.state, org.state, props.projectId) : rawProject.state,
    [rawProject.state, org.state, props.projectId]);
  const queries = useMemo(() => rawProject.queries && projectedState && projectedState !== rawProject.state
    ? orgQueries(rawProject.queries, getStore(), props.orgId, props.projectId, projectedState)
    : rawProject.queries,
    [rawProject.queries, projectedState, rawProject.state, props.orgId, props.projectId]);
  const project = { ...rawProject, state: projectedState, queries };
  useAccountSync(props.actorId);
  const profileNames = useDisplayNames(props.actorId);
  const people = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, scopes] of Object.entries(org.state?.members ?? {})) {
      const name = Object.values(scopes)[0]?.displayName;
      if (name) out[id] = name;
    }
    return { ...out, ...profileNames };
  }, [org.state, profileNames]);
  const [seenVision, setSeenVision] = useState(false);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const nav = useNav({ screen: 'sign_in' });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [local, terms] = await Promise.all([AsyncStorage.getItem(`vision:${props.actorId}`), AsyncStorage.getItem(`terms-version:${props.actorId}`)]);
      if (active) { setSeenVision(local === '1' && terms === TERMS_VERSION); setOnboardingLoaded(true); }
      if (!props.signedIn) return;
      const { data, error } = await supabase.rpc('get_user_state');
      if (!error && data?.visionSeen && data?.termsVersion === TERMS_VERSION) {
        await AsyncStorage.multiSet([[`vision:${props.actorId}`, '1'], [`terms-version:${props.actorId}`, TERMS_VERSION]]);
        if (active) setSeenVision(true);
      }
    })().catch(() => { if (active) setOnboardingLoaded(true); });
    return () => { active = false; };
  }, [props.actorId]);

  const session = useMemo(
    () => deriveSession(props.actorId, props.email, project.state, seenVision, org.state, props.projectId),
    [props.actorId, props.email, project.state, seenVision, org.state, props.projectId]
  );

  // Inbox badge: unread items, the same list and read state the Inbox shows.
  const inboxIds = useMemo(
    () => (project.state ? deriveInbox(project.state, props.actorId, indexesFor(project.state)).map((i) => i.id) : []),
    [project.state, props.actorId]
  );
  const inboxCount = useInboxUnread(props.actorId, inboxIds, props.orgId, props.projectId);
  // The My Work badge is the For you count (J-HOME-1), the list My Work leads with.
  const forYouCount = useMemo(
    () => (project.state ? highlightsFor(project.state, props.actorId, indexesFor(project.state)).length : 0),
    [project.state, props.actorId]
  );

  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    // Undo needs time to find and hit, so those toasts stay longer.
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3400);
    return () => clearTimeout(t);
  }, [toast]);

  // Auth routing is an invariant, not a transition: a signed-in session is
  // never on a pre-auth screen, a signed-out one is only on sign_in. Stated
  // this way, sign-in, sign-up and a session restored at launch all land the
  // same way, and the old bug where signing up left you on create_account
  // (the guard only looked for sign_in) cannot come back. Checked every
  // render because it is a property of the state, not of an edge; each branch
  // makes its own guard false, so it settles in one extra render.
  //
  // Both folds must be loaded first: postSignInScreen reads the role out of
  // them, and routing early sends an owner to the worker's home.
  const loaded = project.state !== null && org.state !== null;
  // Rendering must not wait on the log fold. The home screen for this
  // actor is remembered from the last session and routed to at once; every
  // screen already renders a light placeholder while its state is null.
  // A role change is caught below once both folds are in.
  const homeKey = `home:${props.actorId}:${props.orgId}:${props.projectId}`;
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
      // account and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (!onboardingLoaded) return;
    if (seenVision && (nav.current.screen === 'terms_privacy' || nav.current.screen === 'vision')) {
      nav.reset({ screen: homeScreenFor(session) });
      return;
    }
    if (!AUTH_SCREENS.includes(nav.current.screen)) return;
    if (loaded) nav.reset({ screen: postSignInScreen(session) });
    else if (cachedHome && !session.isFirstTime) nav.reset({ screen: cachedHome });
  });
  // Picking a project on the org home opens that project, with the org home
  // still under it for Back, instead of the same org home again.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !loaded || !props.landing) return;
    const home = homeScreenFor(session);
    if (nav.current.screen !== home) return;
    landed.current = true;
    if (edgeFor(home, props.landing)) nav.push({ screen: props.landing });
    // A manage home is no longer anyone's home; it is a tab.
    else if (TAB_SCREENS.includes(props.landing)) nav.reset({ screen: props.landing });
  });

  const go = useCallback(
    (to: ScreenId, params?: Record<string, string>) => {
      const from = nav.current.screen;
      const edge = edgeFor(from, to) ?? (edgeFor(from, 'home_hub') && to === homeScreenFor(session) ? edgeFor(from, 'home_hub') : undefined);
      const route: Route = params ? { screen: to, params } : { screen: to };
      // Opening a passage is a visit My Work's Recent list remembers (J-WORK-8).
      const visit = () => {
        if ((RECENT_SCREENS as readonly ScreenId[]).includes(to) && params?.['unitId'] && params['laneId']) {
          void rememberRecent(recentKey(props.orgId, props.projectId, props.actorId), { unitId: params['unitId'], laneId: params['laneId'] });
        }
      };
      if (!edge) {
        if (TAB_SCREENS.includes(to)) return nav.reset(route);
        console.error(`[flow] BLOCKED ${from} -> ${to}: declare the edge in flow.ts`);
        return;
      }
      // Role gates are part of the machine (UX spec): a screen must not
      // offer an affordance the session's role cannot take.
      if (!edgeAllowed(edge, session)) {
        console.error(`[flow] BLOCKED ${from} -> ${to}: gate "${edge.when}" not met by role ${session.role ?? 'guest'}`);
        return;
      }
      visit();
      switch (edge.mode ?? 'push') {
        case 'push': return nav.push(route);
        case 'replace': return nav.replace(route);
        case 'reset': return nav.reset(route);
        case 'back': return nav.back();
        case 'popTo': return nav.popTo(to, params);
      }
    },
    [nav, session, props.orgId, props.projectId, props.actorId]
  );

  useEffect(() => {
    const receive = (url: string) => {
      if (!parseInvite(url)) return;
      void AsyncStorage.setItem('pending-invite', url).then(() => {
        nav.reset({ screen: 'scan_qr', params: { invite: url } });
      });
    };
    if (!initialLinkRead) {
      initialLinkRead = true;
      void Linking.getInitialURL().then((url) => { if (url) receive(url); });
    }
    const listener = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => listener.remove();
  }, [nav.reset]);
  useEffect(() => {
    if (!props.signedIn || !seenVision) return;
    void AsyncStorage.getItem('pending-invite').then((value) => {
      if (value) nav.reset({ screen: 'scan_qr', params: { invite: value } });
    });
  }, [props.signedIn, seenVision, nav.reset]);

  const canSwitchPersona = maySwitchPersona(props.email, IS_DEV);

  useEffect(() => {
    // Web is a test target with no notification responses to deliver.
    if (!props.signedIn || !seenVision || Platform.OS === 'web') return;
    const receive =(response: Notifications.NotificationResponse | null) => {
      if (!response?.notification.request.content.data?.notificationId) return;
      nav.reset({ screen: 'inbox_home' });
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then(receive);
    const listener = Notifications.addNotificationResponseReceivedListener(receive);
    return () => listener.remove();
  }, [props.signedIn, seenVision, nav.reset]);

  const ctx: Ctx = {
    project,
    org,
    session,
    params: nav.current.params ?? {},
    go,
    back: nav.back,
    home: () => nav.reset({ screen: homeScreenFor(session) }),
    toast: (text, undo) => setToast(undo ? { text, undo } : { text }),
    markVisionSeen: async () => {
      await recordUserEvent(props.actorId, 'v1.VisionSeen');
      await AsyncStorage.setItem(`vision:${props.actorId}`, '1');
      setSeenVision(true);
    },
    rememberInvite: (value) => AsyncStorage.setItem('pending-invite', value),
    openOrganization: props.openOrganization,
    openDev: () => setDevOpen(true),
    isDev: IS_DEV,
    canSwitchPersona
  };

  const tabs = tabsFor(session, { work: forYouCount, inbox: inboxCount });
  const showTabs = props.signedIn && tabs.length > 0 && homeScreenFor(session) !== 'intent_chooser' && TAB_SCREENS.includes(nav.current.screen);
  const activeTab = activeTabFor(tabs, nav.current.screen);

  return (
    <View style={{ flex: 1 }}>
      <PeopleContext.Provider value={people}>
      <CtxContext.Provider value={ctx}>
        <NavigationContainer ref={navRef} onReady={nav.onReady} onStateChange={nav.onStateChange}>
          <Stack.Navigator
            initialRouteName={nav.initial.screen}
            screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: colors.background } }}
          >
            {SCREEN_IDS.map((id) => (
              // Tab targets are reached by reset, so they crossfade like a tab
              // switch; everything else, the map's deeper screens included,
              // slides like a push.
              <Stack.Screen key={id} name={id} component={HOSTS[id]} options={{ animation: TAB_TARGETS.includes(id) ? 'fade' : 'default' }} />
            ))}
          </Stack.Navigator>
        </NavigationContainer>
      </CtxContext.Provider>
      </PeopleContext.Provider>
      {toast ? (
        <Pressable onPress={() => setToast(null)} accessibilityRole="alert" accessibilityLabel={toast.text} style={[styles.toast, { bottom: showTabs ? 64 : space.lg }]}>
          <CheckCircle2 size={24} color={colors.done} />
          <Text style={[styles.toastText, { flex: 1 }]}>{toast.text}</Text>
          {toast.undo ? (
            <Pressable onPress={() => { toast.undo?.(); setToast(null); }} accessibilityRole="button" accessibilityLabel="Undo"
              style={({ pressed }) => [styles.toastUndo, pressed && { opacity: 0.7 }]}>
              <Text style={styles.toastText}>Undo</Text>
            </Pressable>
          ) : null}
        </Pressable>
      ) : null}
      {showTabs ? (
        <View style={styles.tabs}>
          {tabs.map((t) => {
            const Icon = TAB_ICONS[t.id];
            const active = activeTab === t.id;
            const color = active ? colors.translate : colors.mutedForeground;
            return (
              <Pressable
                key={t.id}
                onPress={() => { if (nav.current.screen !== t.screen) nav.reset({ screen: t.screen }); }}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityValue={t.badge ? { text: String(t.badge) } : undefined}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.tabIndicator, active && { backgroundColor: colors.translate }]} />
                <View>
                  <Icon size={22} color={color} />
                  {t.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{t.badge > 99 ? '99+' : t.badge}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {canSwitchPersona ? (
        <DevMenu open={devOpen} onClose={() => setDevOpen(false)} project={project} org={org} currentEmail={props.email} isOwner={session.role === 'owner'} isDev={IS_DEV} jump={(s) => nav.reset({ screen: s })} />
      ) : null}
    </View>
  );
}

/** Every screen a tab can reset to (tabsFor); a subset of TAB_SCREENS. */
const TAB_TARGETS: ScreenId[] = ['my_work', 'status_home', 'map_home', 'org_home', 'project_home', 'language_home', 'inbox_home', 'settings_home'];

const TAB_ICONS: Record<TabId, LucideIcon> = {
  work: ClipboardList, map: MapIcon, manage: Building2, inbox: Inbox, settings: Settings
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  tab: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 12, gap: 6 },
  tabIndicator: { width: 24, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  // Never red (recording) or yellow (the next action): the numeral carries the meaning.
  badge: { position: 'absolute', top: -6, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.foreground },
  badgeText: { color: colors.background, fontSize: 11, fontWeight: '700' },
  toast: { position: 'absolute', left: space.lg, right: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colors.foreground },
  toastText: { flexShrink: 1, color: colors.background, fontSize: 16, fontWeight: '600' },
  toastUndo: { minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.background }
});
