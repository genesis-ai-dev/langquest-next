import { signOut } from '../auth';
import type { Loaded } from '../data';
import { Link } from '../router';
import { orgRoute } from '../routes';
import { setTheme, useTheme } from '../theme';
import type { Organization } from '../types';
import { LoadFailed, Loading, Notice, Page } from '../ui';

/** Every organization this person belongs to. */
export function OrgsScreen(props: { orgs: Loaded<Organization[]> & { reload: () => void }; email: string }) {
  const { orgs } = props;
  const theme = useTheme();
  return (
    <>
      <header className="topbar no-print">
        <Link to={{ name: 'orgs' }} className="brand">LangQuest</Link>
        <div className="actions">
          <span className="who">{props.email}</span>
          <button type="button" className="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button type="button" className="button button-ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>
      <Page title="Your organizations">
        {orgs.status === 'loading' ? <Loading what="your organizations" /> : null}
        {orgs.status === 'error' ? <LoadFailed error={orgs.error} retry={orgs.reload} /> : null}
        {orgs.status === 'ready' && orgs.data.length === 0 ? (
          <Notice tone="gray" title="You are not in an organization yet"
            body="Join one from the LangQuest app with an invitation, then come back here to see its progress." />
        ) : null}
        {orgs.status === 'ready' && orgs.data.length > 0 ? (
          <ul className="org-list">
            {orgs.data.map((o) => (
              <li key={o.orgId} className="card" style={{ padding: 0 }}>
                <Link to={orgRoute(o.orgId)}>
                  <span>{o.name}</span>
                  <span aria-hidden="true" className="muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Page>
    </>
  );
}
