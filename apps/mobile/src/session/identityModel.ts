import type { LocalPerson } from './localPersonModel';

/**
 * Who the app runs as (docs/nearby-sync-plan.md 14.1, 5 "Identity"): the saved sign-in, or the
 * local person of joining offline when there is none. Pure, and apart from the local person's
 * record rules (localPersonModel.ts), so the web bundle, which never has a local person, carries
 * only this.
 */

/** Is this record the person the phone works as, when nobody is signed in? `ready`, and `joined` whose session went. */
export function isLocalIdentity(p: LocalPerson | null | undefined): p is LocalPerson {
  return !!p && (p.stage === 'ready' || p.stage === 'joined');
}

/** Who the app runs as (section 14.1, 5 "Identity"): `signedIn` routes, `serverSession` is what the server would take. */
export interface Identity {
  actorId: string;
  email: string | null;
  /** Someone is on this phone: routing, tabs and the screens behind Sign In. */
  signedIn: boolean;
  /** A real session the server would take: anything that calls the server waits for this. */
  serverSession: boolean;
  /** The local person, when the phone runs as them. */
  local: LocalPerson | null;
}

/**
 * The identity from the saved sign-in and the local person; undefined until both are read. A
 * session wins: after first contact it is the same id, so `Shell`, keyed on the actor id, does
 * not remount. A local person counts only from `ready`, so a copy still filling stays a guest.
 */
export function identityOf(auth: { id: string; email?: string | null } | null | undefined, local: LocalPerson | null | undefined): Identity | undefined {
  if (auth === undefined || local === undefined) return undefined;
  if (auth) return { actorId: auth.id, email: auth.email ?? null, signedIn: true, serverSession: true, local: local && local.profileId === auth.id ? local : null };
  if (isLocalIdentity(local)) return { actorId: local.profileId, email: null, signedIn: true, serverSession: false, local };
  return { actorId: 'guest', email: null, signedIn: false, serverSession: false, local: null };
}
