import { orgQueries } from './src/orgQueries';
import { getStore } from './src/store';
import { highlightsFor, updatesFor, withOrgMembers, type EventSpec } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx, RecentPassage } from './src/ctx';
import { DevMenu } from './src/DevMenu';
import { UpdateBanner } from './src/UpdateBanner';
import { maySwitchPersona } from './src/dev';
import { edgeFor, MAP_SCREENS, PASSAGE_READING, SCREEN_IDS, TAB_SCREENS, type ScreenId } from './src/flow';
import { indexesFor } from './src/indexes';
import { Ico, ToastView, type IconName, type ToastSpec } from './src/kit';
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
import * as Review from './src/screens/review';
import * as Study from './src/screens/study';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, homeScreenFor, postSignInScreen, tabsFor, type TabId } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { C, colors, space } from './src/theme';
import { recordUserEvent } from './src/accountData';
import { useAccountSync, useDisplayNames } from './src/useAccount';
import { PeopleContext } from './src/UserChip';
import { parseInvite } from './src/inviteCode';
import { useOrg } from './src/useOrg';
import { useProject } from './src/useProject';

// Initial selection, before the account's saved organization is restored.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';
const PROJECT_ID = process.env.EXPO_PUBLIC_PROJECT_ID ?? 'luke-demo-4';
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
  study_guide: Study.StudyGuide, study_step: Study.StudyStep,
  workspace: Translate.Workspace, back_translation: Translate.BackTranslation,
  key_terms: Config.KeyTerms, key_term_detail: Config.KeyTermDetail,
  inbox_home: Account.InboxHome, settings_home: Account.SettingsHome, profile_edit: Account.ProfileEdit,
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, sync_status: Account.SyncStatus,
  org_home: Org.OrgHome, project_home: Org.ProjectHome, language_home: Org.LanguageHome, new_project: Org.NewProject,
  new_language: Org.NewLanguage, members_list: Org.MembersList, invite_member: Org.InviteMember, invite_qr: Org.InviteQr,
  edit_member: Org.EditMember, review_teams: Org.ReviewTeams, review_team_editor: Org.ReviewTeamEditor,
  roles_home: Config.RolesHome, role_editor: Config.RoleEditor, reference_home: Config.ReferenceHome, material_editor: Config.MaterialEditor,
  flows_home: Config.FlowsHome, flow_editor: Config.FlowEditor,
  templates_home: Content.TemplatesHome, template_picker: Content.TemplatePicker, template_editor: Content.TemplateEditor,
  book_structure: Content.BookStructure
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
  const Screen = SCREENS[id];
  function Host(props: HostProps) {
    const ctx = useContext(CtxContext);
    if (!ctx) return null;
    return <Screen {...ctx} params={props.route.params ?? {}} />;
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
        <StatusBar style="dark" />
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
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(`selection:${props.actorId}`).then((raw) => {
      if (active && raw) setSelection(JSON.parse(raw));
    }).catch(() => {});
    return () => { active = false; };
  }, [props.actorId]);
  const openOrganization = useCallback(async (orgId: string, projectId?: string) => {
    if (!projectId) {
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) throw new Error(error.message);
      projectId = data?.find((r: { org_id: string }) => r.org_id === orgId)?.project_id ?? 'unselected';
    }
    const next = { orgId, projectId: projectId! };
    await AsyncStorage.setItem(`selection:${props.actorId}`, JSON.stringify(next));
    await AsyncStorage.removeItem('pending-invite');
    setSelection(next);
    setSelectionRevision((revision) => revision + 1);
  }, [props.actorId]);
  return <Workspace key={`${selection.orgId}:${selection.projectId}:${selectionRevision}`} {...props}
    {...selection} openOrganization={openOrganization} />;
}

function Workspace(props: { actorId: string; email: string | null; signedIn: boolean;
  orgId: string; projectId: string; openOrganization: Ctx['openOrganization'] }) {
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
  const [welcomed, setWelcomed] = useState(false);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const nav = useNav({ screen: 'sign_in' });

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
    () => deriveSession(props.actorId, props.email, project.state, welcomed, org.state, props.projectId),
    [props.actorId, props.email, project.state, welcomed, org.state, props.projectId]
  );

  // ---- the language this person works in (MAP-7) ----
  const laneKey = `lane:${props.actorId}:${props.orgId}:${props.projectId}`;
  const [savedLane, setSavedLane] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(laneKey).then(setSavedLane).catch(() => {}); }, [laneKey]);
  const lanes = useMemo(() => Object.keys(project.state?.lanes ?? {}).sort(), [project.state?.lanes]);
  const laneId = savedLane && lanes.includes(savedLane) ? savedLane : lanes[0] ?? null;
  const setLane = useCallback((id: string) => { setSavedLane(id); AsyncStorage.setItem(laneKey, id).catch(() => {}); }, [laneKey]);

  // ---- passages opened lately (WORK-2) ----
  const recentKey = `recent:${props.actorId}:${props.orgId}:${props.projectId}`;
  const [recent, setRecent] = useState<RecentPassage[]>([]);
  useEffect(() => { AsyncStorage.getItem(recentKey).then((v) => setRecent(v ? JSON.parse(v) : [])).catch(() => {}); }, [recentKey]);
  const remember = useCallback((unitId: string, lane: string) => {
    setRecent((prev) => {
      const next = [{ unitId, laneId: lane, at: Date.now() }, ...prev.filter((r) => r.unitId !== unitId || r.laneId !== lane)].slice(0, 12);
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
  const [toastSpec, setToastSpec] = useState<ToastSpec | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((message: string, undo?: () => void | Promise<void>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const spec: ToastSpec = { id: Date.now(), message, ...(undo ? { undo } : {}) };
    setToastSpec(spec);
    toastTimer.current = setTimeout(() => setToastSpec((t) => (t?.id === spec.id ? null : t)), undo ? 7000 : 3500);
  }, []);
  const projectRef = useRef(project);
  projectRef.current = project;
  const act = useCallback(async (specs: EventSpec[], message: string, undo?: () => EventSpec[]) => {
    try {
      await projectRef.current.run(specs);
    } catch (e) {
      toast(`Not saved: ${(e as Error).message}`);
      throw e;
    }
    toast(message, undo ? async () => {
      try { await projectRef.current.run(undo()); toast('Undone.'); } catch (e) { toast(`Could not undo: ${(e as Error).message}`); }
    } : undefined);
  }, [toast]);

  // ---- names: the signed-in person is always "you" (CORE-6) ----
  const name = useCallback((id: string, lower = false) => {
    if (id === props.actorId) return lower ? 'you' : 'You';
    return people[id] ?? personLook(id).name;
  }, [people, props.actorId]);

  // ---- what is waiting, and what happened (WORK-1, INBOX-1) ----
  const forYou = useMemo(() => project.state
    ? highlightsFor(project.state, props.actorId, { canRecord: session.can('translate'), canReview: session.can('review') }, indexesFor(project.state)).length
    : 0, [project.state, props.actorId, session]);
  const updates = useMemo(() => project.state ? updatesFor(project.state, props.actorId, indexesFor(project.state)) : [], [project.state, props.actorId]);
  const readKey = `inbox-read:${props.actorId}:${props.orgId}:${props.projectId}`;
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
  // Both folds must be loaded first: postSignInScreen reads the role out of
  // them, and routing early sends an admin to the wrong home.
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
      // account, Browse public projects, the terms and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (!onboardingLoaded) return;
    if (!AUTH_SCREENS.includes(nav.current.screen)) return;
    if (loaded) nav.reset({ screen: postSignInScreen(session) });
    else if (cachedHome && !session.isFirstTime) nav.reset({ screen: cachedHome });
  });

  const go = useCallback(
    (to: ScreenId, params?: Record<string, string>) => {
      const from = nav.current.screen;
      const edge = edgeFor(from, to) ?? (edgeFor(from, 'home_hub') && to === homeScreenFor(session) ? edgeFor(from, 'home_hub') : undefined);
      const route: Route = params ? { screen: to, params } : { screen: to };
      if (!edge) {
        if (TAB_SCREENS.includes(to)) return nav.reset(route);
        console.error(`[flow] BLOCKED ${from} -> ${to}: declare the edge in flow.ts`);
        return;
      }
      // Gates are permissions (who MAY act), part of the machine: a screen
      // must not offer an affordance the session cannot take.
      if (!edgeAllowed(edge, session)) {
        console.error(`[flow] BLOCKED ${from} -> ${to}: gate "${edge.when}" not met`);
        return;
      }
      switch (edge.mode ?? 'push') {
        case 'push': return nav.push(route);
        case 'replace': return nav.replace(route);
        case 'reset': return nav.reset(route);
        case 'back': return nav.back();
        case 'popTo': return nav.popTo(to, params);
      }
    },
    [nav, session]
  );

  // A project registered in the org (New project) gets its own log started
  // the first time someone who may create it opens it: the server accepts
  // ProjectCreated as a partition's first event from Manage Org Structure.
  const registered = org.state?.projects[props.projectId];
  const canCreate = session.can('manage_structure');
  useEffect(() => {
    if (!project.state || project.state.project || !registered || !canCreate) return;
    void rawProject.append('v1.ProjectCreated', { name: registered.name, sourceLanguoidId: 'eng' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.state?.project, registered?.name, canCreate]);

  const openPassage = useCallback((unitId: string, lane: string, extra?: Record<string, string>) => {
    remember(unitId, lane);
    go('passage_record', { unitId, laneId: lane, ...extra });
  }, [go, remember]);

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
    if (!props.signedIn || !onboardingLoaded) return;
    void AsyncStorage.getItem('pending-invite').then((value) => {
      if (value) nav.reset({ screen: 'scan_qr', params: { invite: value } });
    });
  }, [props.signedIn, onboardingLoaded, nav.reset]);

  const canSwitchPersona = maySwitchPersona(props.email, IS_DEV);

  useEffect(() => {
    if (!props.signedIn) return;
    const receive = (response: Notifications.NotificationResponse | null) => {
      if (!response?.notification.request.content.data?.notificationId) return;
      nav.reset({ screen: 'inbox_home' });
      void Notifications.clearLastNotificationResponseAsync();
    };
    void Notifications.getLastNotificationResponseAsync().then(receive);
    const listener = Notifications.addNotificationResponseReceivedListener(receive);
    return () => listener.remove();
  }, [props.signedIn, nav.reset]);

  const ctx: Ctx = {
    project,
    org,
    session,
    params: nav.current.params ?? {},
    go,
    back: nav.back,
    home: () => nav.reset({ screen: homeScreenFor(session) }),
    laneId,
    setLane,
    act,
    toast,
    details,
    recent,
    openPassage,
    name,
    inbox: { updates, unread, isRead: (id) => readIds.has(id), markRead },
    markWelcomed: async () => {
      await recordUserEvent(props.actorId, 'v1.VisionSeen');
      await AsyncStorage.multiSet([[`vision:${props.actorId}`, '1'], [`joined:${props.actorId}`, '0']]);
      setWelcomed(true);
    },
    acceptTerms: (actorId = props.actorId) => recordUserEvent(actorId, 'v1.TermsAccepted'),
    markJoined: (actorId) => AsyncStorage.setItem(`joined:${actorId}`, '1'),
    rememberInvite: (value) => AsyncStorage.setItem('pending-invite', value),
    openOrganization: props.openOrganization,
    openDev: () => setDevOpen(true),
    isDev: IS_DEV,
    canSwitchPersona
  };

  const screen = nav.current.screen;
  const showTabs = props.signedIn && homeScreenFor(session) !== 'intent_chooser' && TAB_SCREENS.includes(screen);
  const tabs = tabsFor(session, { forYou, unread });
  // The lit tab is the one you came from (the bottom of the stack), so a
  // passage opened from My Work stays under My Work.
  const bottom = nav.stack[0]?.screen;
  const activeTab: TabId = tabs.find((t) => t.screen === screen)?.id
    ?? tabs.find((t) => t.screen === bottom)?.id
    ?? ([...MAP_SCREENS, ...PASSAGE_READING].includes(screen) ? 'map' : 'manage');
  const TAB_ICONS: Record<TabId, IconName> = { work: 'work', map: 'map', manage: 'home', inbox: 'notif', settings: 'settings' };

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
              // Tab-level screens are only ever reached by reset, so they
              // crossfade like a tab switch; everything else slides like a push.
              <Stack.Screen key={id} name={id} component={HOSTS[id]} options={{ animation: TAB_SCREENS.includes(id) ? 'fade' : 'default' }} />
            ))}
          </Stack.Navigator>
        </NavigationContainer>
      </CtxContext.Provider>
      </PeopleContext.Provider>
      {showTabs ? (
        <View style={styles.tabs}>
          {tabs.map((t) => {
            const active = t.id === activeTab;
            const color = active ? C.primary : C.muted;
            return (
              <Pressable
                key={t.id}
                onPress={() => { if (screen !== t.screen) nav.reset({ screen: t.screen }); }}
                accessibilityRole="tab"
                accessibilityLabel={t.badge ? `${t.label}, ${t.badge}` : t.label}
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.tabPill, active && { backgroundColor: C.light }]}>
                  <Ico name={TAB_ICONS[t.id]} size={24} color={color} />
                  {t.badge ? (
                    <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{t.badge > 99 ? '99+' : t.badge}</Text></View>
                  ) : null}
                </View>
                <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ToastView toast={toastSpec} onDismiss={() => setToastSpec(null)} bottom={showTabs ? 96 : 24} />
      {canSwitchPersona ? (
        <DevMenu open={devOpen} onClose={() => setDevOpen(false)} project={project} org={org} currentEmail={props.email} isOwner={session.role === 'owner'} isDev={IS_DEV} jump={(s) => nav.reset({ screen: s })} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.card },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.sm, paddingBottom: space.xs },
  tab: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: space.sm },
  tabPill: { paddingHorizontal: 18, paddingVertical: 4, borderRadius: 99 },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  tabBadge: { position: 'absolute', top: -4, right: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: C.white, fontSize: 12, fontWeight: '800' }
});
