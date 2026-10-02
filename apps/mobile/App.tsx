import { orgQueries } from './src/orgQueries';
import { getStore } from './src/store';
import { highlightsFor, orgLanguages, updatesFor, withOrgMembers, type EventSpec } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { NavigationContainer, type RouteProp } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { AccessibilityInfo, Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { LayoutContext, PaneSelectionContext, type Layout, type OpenDetail } from './src/useLayout';
import { indexesFor } from './src/indexes';
import { EmptyState, GhostBtn, ToastView, txt, type ToastSpec } from './src/kit';
import { installGlobalHandlers, noteExpected, reportError } from './src/report';
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
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, foldsSettled, homeScreenFor, postSignInScreen, tabsFor, type TabId } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { C, colors, space } from './src/theme';
import { recordUserEvent } from './src/accountData';
import { useAccountSync, useDisplayNames } from './src/useAccount';
import { useBlocks, useOpenReportCount } from './src/moderationData';
import { PeopleContext } from './src/UserChip';
import { parseInvite } from './src/inviteCode';
import { useOrg, type OrgHandle } from './src/useOrg';
import { useLibraryFollow } from './src/library/follow';
import { useProject } from './src/useProject';
import { openLanguage } from './src/languages';

// Initial selection, before the account's saved organization is restored.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';
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
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm, delete_account: Account.DeleteAccount, sync_status: Account.SyncStatus,
  org_home: Org.OrgHome, language_home: Org.LanguageHome,
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

/**
 * The stack entry whose screen is drawn in the list pane of a split
 * (panes.ts). Its own place in the stack shows the split's empty state
 * instead, so a list is never mounted twice.
 */
const PaneKeyContext = createContext<{ key: string; empty?: SplitSpec['empty'] } | null>(null);

type HostProps = { route: RouteProp<StackParams, ScreenId> };
function hostFor(id: ScreenId) {
  const Screen = SCREENS[id];
  function Host(props: HostProps) {
    const ctx = useContext(CtxContext);
    const pane = useContext(PaneKeyContext);
    if (!ctx) return null;
    if (pane && props.route.key === pane.key) return <PaneEmpty spec={pane.empty} />;
    // One boundary per screen (error-tracking): a crash in a study guide
    // never takes the recorder, or the rest of the app, down with it.
    return (
      <ScreenBoundary screen={id} onBack={ctx.back} onHome={ctx.home}>
        <Screen {...ctx} params={props.route.params ?? {}} />
      </ScreenBoundary>
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
            <Host route={route} />
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
    return <Fatal title="Something went wrong" id={this.state.id} detail={this.state.error.stack ?? this.state.error.name} />;
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
        <Text style={txt.h2} accessibilityRole="header">This screen could not open</Text>
        <Text style={txt.body}>Your recordings and everything you saved are safe on this phone.</Text>
        <Text style={txt.smMuted} selectable>If it keeps happening, tell your team this code: {this.state.id}</Text>
        <GhostBtn label="Go back" icon="left" onPress={reset(this.props.onBack)} />
        <GhostBtn label="Go to My Work" icon="home" onPress={reset(this.props.onHome)} />
      </ScrollView>
    );
  }
}

/** A message a tester can read out over a call, and a developer can act on. */
function Fatal(props: { title: string; detail: string; id?: string }) {
  return (
    <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
      <Text style={txt.h3}>{props.title}</Text>
      <Text style={txt.body}>Your recordings and everything you saved are safe on this phone.</Text>
      {props.id ? <Text style={txt.smMuted} selectable>Code for your team: {props.id}</Text> : null}
      <Text style={txt.xs} selectable>{props.detail}</Text>
    </ScrollView>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined);
  useEffect(() => { installGlobalHandlers(); lockPhonesToPortrait(); }, []);
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

/**
 * Which organization is open. An organization is the unit people switch
 * between and the unit that syncs: its own partition plus the one work
 * partition that holds its languages (decision 34).
 */
function Shell(props: { actorId: string; email: string | null; signedIn: boolean }) {
  const [orgId, setOrgId] = useState(ORG_ID);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [noOrganizations, setNoOrganizations] = useState(false);
  const key = `selection:${props.actorId}`;
  useEffect(() => {
    let active = true;
    void (async () => {
      const raw = await AsyncStorage.getItem(key);
      // Saved before decision 34 as { orgId, projectId }: the org is what counts.
      const saved = raw ? (JSON.parse(raw) as { orgId?: string }).orgId : undefined;
      if (saved) { if (active) setOrgId(saved); return; }
      if (!props.signedIn) return;
      // Nothing chosen on this device yet: open the first organization this
      // account belongs to, so someone just added to a team lands in it.
      const { data, error } = await supabase.rpc('my_organizations');
      if (error) { noteExpected('restore organization', error); return; }
      const first = (data as { org_id: string }[] | null)?.[0];
      if (!active) return;
      // The server's own list is empty: a new account, in no organization yet.
      setNoOrganizations(!first);
      if (!first) return;
      await AsyncStorage.setItem(key, JSON.stringify({ orgId: first.org_id }));
      setOrgId(first.org_id);
    })().catch((e: unknown) => { reportError('restore organization', e); });
    return () => { active = false; };
  }, [key, props.signedIn]);
  const openOrganization = useCallback(async (next: string) => {
    await AsyncStorage.setItem(key, JSON.stringify({ orgId: next }));
    await AsyncStorage.removeItem('pending-invite');
    setNoOrganizations(false);
    setOrgId(next);
    setSelectionRevision((revision) => revision + 1);
  }, [key]);
  return <Workspace key={`${orgId}:${selectionRevision}`} {...props} orgId={orgId} noOrganizations={noOrganizations} openOrganization={openOrganization} />;
}

/**
 * One organization: its partition, and the languages it lists there. Until
 * the org fold is read (and, on a device that has never seen this org, until
 * the first sync has had its chance), which languages it has is unknown, so
 * nothing is opened yet.
 */
function Workspace(props: { actorId: string; email: string | null; signedIn: boolean; orgId: string; noOrganizations: boolean; openOrganization: Ctx['openOrganization'] }) {
  const org = useOrg(props.orgId, props.actorId);
  const known = org.state !== null && (org.state.org !== null || org.settled);
  if (!known) return <View style={styles.root} accessibilityLabel="Opening your organization" />;
  return <OrgWork {...props} org={org} />;
}

/**
 * The organization with one language open (docs/decisions.md 37). Each
 * language is its own partition: this phone syncs the org partition and the
 * open language's, and a screen about another language opens that one, in
 * place, without leaving the screen.
 */
function OrgWork(props: { actorId: string; email: string | null; signedIn: boolean;
  orgId: string; noOrganizations: boolean; org: OrgHandle; openOrganization: Ctx['openOrganization'] }) {
  const org = props.org;
  const nav = useNav({ screen: 'sign_in' });
  // ---- the language this person works in (MAP-7), and so the partition open ----
  const laneKey = `lane:${props.actorId}:${props.orgId}`;
  const [savedLane, setSavedLane] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(laneKey).then(setSavedLane).catch(() => {}); }, [laneKey]);
  const setLane = useCallback((id: string) => { setSavedLane(id); AsyncStorage.setItem(laneKey, id).catch(() => {}); }, [laneKey]);
  const paramLane = nav.current.params?.['laneId'];
  const open = useMemo(() => openLanguage(org.state, props.actorId, { param: paramLane, saved: savedLane }),
    [org.state, props.actorId, paramLane, savedLane]);
  // A screen about a language makes it the one this person works in.
  useEffect(() => { if (open.laneId && open.laneId === paramLane && open.laneId !== savedLane) setLane(open.laneId); }, [open.laneId, paramLane, savedLane, setLane]);
  const projectId = open.partitionId;
  const languages = useMemo(() => orgLanguages(org.state), [org.state]);
  const rawProject = useProject(props.orgId, projectId, props.actorId);
  const projectedState = useMemo(() => rawProject.state && org.state
    ? withOrgMembers(rawProject.state, org.state, projectId) : rawProject.state,
    [rawProject.state, org.state, projectId]);
  const queries = useMemo(() => rawProject.queries && projectedState && projectedState !== rawProject.state
    ? orgQueries(rawProject.queries, getStore(), props.orgId, projectId, projectedState)
    : rawProject.queries,
    [rawProject.queries, projectedState, rawProject.state, props.orgId, projectId]);
  const project = { ...rawProject, state: projectedState, queries };
  useAccountSync(props.actorId);
  const blocks = useBlocks(props.actorId);
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
    () => deriveSession(props.actorId, props.email, project.state, welcomed, org.state, projectId),
    [props.actorId, props.email, project.state, welcomed, org.state, projectId]
  );
  // Languages follow the library versions their template and flow are at (docs/library.md).
  useLibraryFollow(project, org, session);

  // The open language; an organization from before decision 37 opens its
  // shared partition, whose own languages are known once it has loaded.
  const lanes = useMemo(() => Object.keys(project.state?.lanes ?? {}).sort(), [project.state?.lanes]);
  const laneId = open.laneId && (project.state?.lanes[open.laneId] || !project.state) ? open.laneId : lanes[0] ?? open.laneId;

  // ---- passages opened lately (WORK-2) ----
  const recentKey = `recent:${props.actorId}:${props.orgId}`;
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
  // Toasts live in their own component, so showing one never re-renders
  // the screens on the stack; `toast` only hands the message over.
  const showToast = useRef<(spec: ToastSpec) => void>(() => {});
  const toast = useCallback((message: string, undo?: () => void | Promise<void>) => {
    const spec: ToastSpec = { id: Date.now(), message, ...(undo ? { undo } : {}) };
    showToast.current(spec);
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
  // Nothing from someone this person blocked reaches their Inbox (decisions.md 48).
  const updates = useMemo(() => project.state
    ? updatesFor(project.state, props.actorId, indexesFor(project.state)).filter((u) => !blocks.has(u.by))
    : [], [project.state, props.actorId, blocks]);
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
  // Both folds must be loaded first: postSignInScreen reads the role out of
  // them, and routing early sends an admin to the wrong home.
  const loaded = foldsSettled(org.state !== null, project.state !== null, props.noOrganizations);
  // Rendering must not wait on the log fold. The home screen for this
  // actor is remembered from the last session and routed to at once; every
  // screen already renders a light placeholder while its state is null.
  // A role change is caught below once both folds are in.
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
      // account, Browse public projects, the terms and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (!onboardingLoaded) return;
    if (!AUTH_SCREENS.includes(nav.current.screen)) return;
    if (loaded) nav.reset({ screen: postSignInScreen(session) });
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
        toast("That can't be opened from here.");
        return;
      }
      // Gates are permissions (who MAY act), part of the machine: a screen
      // must not offer an affordance the session cannot take.
      if (!edgeAllowed(edge, session)) {
        reportError(`flow blocked ${from} -> ${to}: gate ${edge.when}`, new Error('gate not met'));
        toast("You don't have permission to open that.");
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
    languages,
    act,
    toast,
    details,
    recent,
    openPassage,
    name,
    blocks,
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
  // Phone, tablet or desktop by the window's width alone (decisions.md 55).
  const { width } = useWindowDimensions();
  const kind = layoutKind(width);
  const wide = kind !== 'phone';
  const showTabs = props.signedIn && homeScreenFor(session) !== 'intent_chooser' && chromeVisible(kind, screen);
  // Open reports count toward the Inbox badge for whoever may act on them (decisions.md 48).
  const reportCount = useOpenReportCount(props.orgId, props.signedIn && (session.can('manage_structure') || session.can('invite_members')));
  const tabs = tabsFor(session, { forYou, unread: unread + reportCount });
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
    openPassage: (unitId, lane, extra) => {
      remember(unitId, lane);
      goFrom(split.list.screen, split.list.key, 'passage_record', { unitId, laneId: lane, ...extra });
    }
  } : null;
  const openDetail: OpenDetail | null = split?.detail ? { screen: split.detail.screen, params: split.detail.params ?? {} } : null;

  return (
    <View style={{ flex: 1 }}>
      <PeopleContext.Provider value={people}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {wide && showTabs ? navChrome(kind === 'tablet' ? 'rail' : 'sidebar') : null}
          {split && paneCtx ? <PaneSlot key={split.list.key} route={split.list} ctx={paneCtx} layout={paneLayout} open={openDetail} /> : null}
          <LayoutContext.Provider value={stackLayout}>
          <PaneKeyContext.Provider value={paneKey}>
          <CtxContext.Provider value={ctx}>
            {/* Its own box, so the native stack ends where the tab bar begins
                rather than drawing screens underneath it. */}
            <View style={{ flex: 1, overflow: 'hidden' }}>
            <NavigationContainer ref={navRef} onReady={nav.onReady} onStateChange={nav.onStateChange}>
              <Stack.Navigator
                initialRouteName={nav.initial.screen}
                screenOptions={{ headerShown: false, fullScreenGestureEnabled: true, contentStyle: { backgroundColor: colors.background } }}
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
            </View>
          </CtxContext.Provider>
          </PaneKeyContext.Provider>
          </LayoutContext.Provider>
        </View>
        {!wide && showTabs ? navChrome('bar') : null}
      </PeopleContext.Provider>
      <ToastHost register={(show) => { showToast.current = show; }} bottom={!wide && showTabs ? 96 : 24} />
      {canSwitchPersona ? (
        <DevMenu open={devOpen} onClose={() => setDevOpen(false)} project={project} org={org} currentEmail={props.email} isOwner={session.role === 'owner'} isDev={IS_DEV} jump={(s) => nav.reset({ screen: s })} />
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

