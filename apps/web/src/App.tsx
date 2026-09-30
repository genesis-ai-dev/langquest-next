import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SignIn, useSession } from './auth';
import { fetchOrganizations, useLoad } from './data';
import { Link, useRoute } from './router';
import { Activity } from './screens/Activity';
import { Alerts } from './screens/Alerts';
import { Geography } from './screens/Geography';
import { LanguageScreen } from './screens/Language';
import { Languages } from './screens/Languages';
import { Ledger } from './screens/Ledger';
import { OrgsScreen } from './screens/Orgs';
import { Overview } from './screens/Overview';
import { Pace } from './screens/Pace';
import { Reports } from './screens/Reports';
import { OrgShell } from './screens/shell';
import { configError } from './supabase';
import type { Section } from './routes';
import { Loading, Notice, Page } from './ui';

export function App() {
  if (configError) {
    return <main className="page"><Notice tone="red" title="This dashboard cannot reach a server" body={configError} /></main>;
  }
  return <Boundary><Signed /></Boundary>;
}

function Signed() {
  const session = useSession();
  if (session.status === 'loading') return <main className="page"><Loading what="your session" /></main>;
  if (session.status === 'signed_out') return <SignIn />;
  return <Routes userId={session.session.user.id} email={session.session.user.email ?? ''} />;
}

const SECTION: Record<Section, (p: { query: Record<string, string> }) => ReactNode> = {
  overview: Overview, activity: Activity, languages: Languages, geography: Geography,
  reports: Reports, ledger: Ledger, pace: Pace, alerts: Alerts
};

function Routes(props: { userId: string; email: string }) {
  const route = useRoute();
  const orgs = useLoad(fetchOrganizations, props.userId);
  switch (route.name) {
    case 'orgs':
      return <OrgsScreen orgs={orgs} email={props.email} />;
    case 'org': {
      const Section = SECTION[route.section];
      return (
        <OrgShell key={route.orgId} orgId={route.orgId} active={route.section} actorId={props.userId} email={props.email} orgs={orgs}>
          <Section query={route.query} />
        </OrgShell>
      );
    }
    case 'language':
      return (
        <OrgShell key={route.orgId} orgId={route.orgId} active="languages" actorId={props.userId} email={props.email} orgs={orgs}>
          <LanguageScreen key={`${route.projectId}/${route.laneId}`} projectId={route.projectId} laneId={route.laneId} />
        </OrgShell>
      );
    case 'not_found':
      return (
        <Page title="Page not found">
          <Notice tone="gray" title="There is nothing at this address" action={<Link to={{ name: 'orgs' }}>Go to your organizations</Link>} />
        </Page>
      );
  }
}

/** A render error shows a way out instead of a blank page. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Dashboard render failed', error.message, info.componentStack);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <Notice tone="red" title="Something went wrong showing this page"
          body="Nothing was changed. Reload to try again."
          action={<button type="button" className="button" onClick={() => window.location.reload()}>Reload</button>} />
      </main>
    );
  }
}
