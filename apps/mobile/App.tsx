import { orgQueries } from './src/orgQueries';
import { getStore } from './src/store';
import { withOrgMembers } from '@langquest-next/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Home, Inbox, ListChecks, Settings } from 'lucide-react-native';
import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from './src/ctx';
import { DevMenu } from './src/DevMenu';
import { UpdateBanner } from './src/UpdateBanner';
import { maySwitchPersona } from './src/dev';
import { edgeFor, TAB_SCREENS, type ScreenId } from './src/flow';
import { useNav, type Route } from './src/nav';
import * as Account from './src/screens/account';
import * as Config from './src/screens/config';
import * as Entry from './src/screens/entry';
import * as Org from './src/screens/org';
import * as PassageSlides from './src/screens/passageSlides';
import * as Recordings from './src/screens/recordings';
import * as Review from './src/screens/review';
import * as Status from './src/screens/status';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { AUTH_SCREENS, GUEST_SCREENS, deriveInboxCount, deriveSession, edgeAllowed, homeScreenFor, postSignInScreen, tabsFor } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { colors, space } from './src/theme';
import { recordUserEvent, TERMS_VERSION } from './src/accountData';
import { useAccountSync } from './src/useAccount';
import { parseInvite } from './src/inviteCode';
import { useOrg } from './src/useOrg';
import { useProject } from './src/useProject';

// Initial selection, before the account's saved organization is restored.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';
const PROJECT_ID = process.env.EXPO_PUBLIC_PROJECT_ID ?? 'luke-demo-4';
const IS_DEV = __DEV__;
let initialLinkRead = false;

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element | null> = {
  sign_in: Entry.SignIn, create_account: Entry.CreateAccount, terms_privacy: Entry.TermsPrivacy, vision: Entry.Vision,
  intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg, explore_home: Entry.ExploreHome,
  request_access: Entry.RequestAccess, scan_qr: Entry.ScanQr, walkthrough: Entry.Walkthrough,
  assignments_home: Work.AssignmentsHome, give_assignment: Work.GiveAssignment, pickup_home: Work.PickupHome,
  assignment_progress_detail: Work.AssignmentProgressDetail, progress_home: Work.ProgressHome,
  translate_passage: Translate.TranslatePassage, quest_assets: Recordings.QuestAssets,
  passage_references: PassageSlides.PassageReferences, passage_terms: PassageSlides.PassageTerms,
  attach_questions: Translate.AttachQuestions, add_to_tg: Translate.AddToTg,
  review_passage: Review.ReviewPassage, review_questions: Review.ReviewQuestions, done_await: Review.DoneAwait,
  material_editor: Review.MaterialEditor,
  status_home: Status.StatusHome, language_status: Status.LanguageStatus, book_status: Status.BookStatus,
  piece_status: Status.PieceStatus, piece_assign: Status.PieceAssign, piece_stage: Status.PieceStage,
  piece_version: Status.PieceVersion, piece_review: Status.PieceReview,
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

  const inboxCount = useMemo(
    () => deriveInboxCount(project.state, props.actorId),
    [project.state, props.actorId]
  );

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
      // account, Browse public projects and the invite scanner.
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
      // Role gates are part of the machine (UX spec): a screen must not
      // offer an affordance the session's role cannot take.
      if (!edgeAllowed(edge, session)) {
        console.error(`[flow] BLOCKED ${from} -> ${to}: gate "${edge.when}" not met by role ${session.role ?? 'guest'}`);
        return;
      }
      switch (edge.mode ?? 'push') {
        case 'push': return nav.push(route);
        case 'replace': return nav.replace(route);
        case 'reset': return nav.reset(route);
        case 'back': return nav.back();
        case 'popTo': return nav.popTo(to);
      }
    },
    [nav, session]
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
    if (!props.signedIn || !seenVision) return;
    const receive = (response: Notifications.NotificationResponse | null) => {
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

  const Screen = SCREENS[nav.current.screen];
  const showTabs = props.signedIn && TAB_SCREENS.includes(nav.current.screen);
  const tabs = tabsFor(session, inboxCount);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Screen {...ctx} />
      </View>
      {showTabs ? (
        <View style={styles.tabs}>
          {tabs.map((t) => {
            const Icon = t === 'status_home' ? ListChecks : t === 'inbox_home' ? Inbox : t === 'settings_home' ? Settings : Home;
            const active = nav.current.screen === t;
            return (
              <Pressable key={t} onPress={() => nav.reset({ screen: t })} accessibilityRole="tab" accessibilityLabel={t} style={styles.tab}>
                <Icon size={22} color={active ? colors.translate : colors.mutedForeground} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 }
});
