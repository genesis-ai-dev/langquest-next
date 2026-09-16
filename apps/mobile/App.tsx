import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { Home, Inbox, ListChecks, Settings } from 'lucide-react-native';
import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Ctx } from './src/ctx';
import { DevMenu } from './src/DevMenu';
import { maySwitchPersona } from './src/dev';
import { edgeFor, TAB_SCREENS, type ScreenId } from './src/flow';
import { useNav, type Route } from './src/nav';
import * as Account from './src/screens/account';
import * as Config from './src/screens/config';
import * as Entry from './src/screens/entry';
import * as Org from './src/screens/org';
import * as Recordings from './src/screens/recordings';
import * as Review from './src/screens/review';
import * as Status from './src/screens/status';
import * as Translate from './src/screens/translate';
import * as Work from './src/screens/work';
import { AUTH_SCREENS, GUEST_SCREENS, deriveSession, edgeAllowed, homeScreenFor, postSignInScreen, tabsFor } from './src/session';
import { supabase, supabaseConfigError } from './src/supabase';
import { colors, space } from './src/theme';
import { useOrg } from './src/useOrg';
import { useProject } from './src/useProject';

// One fixed partition for now. Project selection is a later screen.
// Overridable so an imported project (server/importV2.ts) can be opened.
const ORG_ID = process.env.EXPO_PUBLIC_ORG_ID ?? 'org1';
const PROJECT_ID = process.env.EXPO_PUBLIC_PROJECT_ID ?? 'luke-demo-4';
const IS_DEV = __DEV__;

const SCREENS: Record<ScreenId, (ctx: Ctx) => React.JSX.Element> = {
  sign_in: Entry.SignIn, create_account: Entry.CreateAccount, terms_privacy: Entry.TermsPrivacy, vision: Entry.Vision,
  intent_chooser: Entry.IntentChooser, create_org: Entry.CreateOrg, explore_home: Entry.ExploreHome,
  request_access: Entry.RequestAccess, scan_qr: Entry.ScanQr, walkthrough: Entry.Walkthrough,
  assignments_home: Work.AssignmentsHome, give_assignment: Work.GiveAssignment, pickup_home: Work.PickupHome,
  assignment_progress_detail: Work.AssignmentProgressDetail, progress_home: Work.ProgressHome,
  translate_passage: Translate.TranslatePassage, quest_assets: Recordings.QuestAssets,
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
  org_switcher: Account.OrgSwitcher, sign_out_confirm: Account.SignOutConfirm
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
      {supabaseConfigError ? (
        <Fatal title="This build is not configured" detail={supabaseConfigError} />
      ) : auth === undefined ? null : (
        <ErrorBoundary>
          <Shell actorId={auth?.user.id ?? 'guest'} email={auth?.user.email ?? null} signedIn={!!auth} />
        </ErrorBoundary>
      )}
    </SafeAreaView>
  );
}

function Shell(props: { actorId: string; email: string | null; signedIn: boolean }) {
  const project = useProject(ORG_ID, PROJECT_ID, props.actorId);
  const org = useOrg(ORG_ID, props.actorId);
  const [seenVision, setSeenVision] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const nav = useNav({ screen: 'sign_in' });

  useEffect(() => {
    AsyncStorage.getItem(`vision:${props.actorId}`).then((v) => setSeenVision(v === '1')).catch(() => {});
  }, [props.actorId]);

  const session = useMemo(
    () => deriveSession(props.actorId, props.email, project.state, seenVision, org.state, PROJECT_ID),
    [props.actorId, props.email, project.state, seenVision, org.state]
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
  useEffect(() => {
    if (!props.signedIn) {
      // Not "anything but sign_in": a guest legitimately walks to Create
      // account, Browse public projects and the invite scanner.
      if (!GUEST_SCREENS.includes(nav.current.screen)) nav.reset({ screen: 'sign_in' });
      return;
    }
    if (loaded && AUTH_SCREENS.includes(nav.current.screen)) nav.reset({ screen: postSignInScreen(session) });
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

  const canSwitchPersona = maySwitchPersona(props.email, IS_DEV);

  const ctx: Ctx = {
    project,
    org,
    session,
    params: nav.current.params ?? {},
    go,
    back: nav.back,
    home: () => nav.reset({ screen: homeScreenFor(session) }),
    markVisionSeen: () => {
      setSeenVision(true);
      AsyncStorage.setItem(`vision:${props.actorId}`, '1').catch(() => {});
    },
    openDev: () => setDevOpen(true),
    isDev: IS_DEV,
    canSwitchPersona
  };

  const Screen = SCREENS[nav.current.screen];
  const showTabs = props.signedIn && TAB_SCREENS.includes(nav.current.screen);
  const tabs = tabsFor(session);

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
