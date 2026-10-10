// Words for the getting-in, welcome and Inbox screens, kept pure so they are
// tested without a phone: what an Inbox update says (INBOX-1, the demo's
// notify() wording in App.tsx), what the welcome says for each role (ONB-1,
// ADR-022), the three "What is LangQuest?" cards (ONB-2), and what an invite
// link says about itself before it is redeemed (AUTH-3, ADR-028). All of it
// in the language showing (LAN-42); the tests read it in English.
import type { Role, Scope, Update } from '@langquest-next/core';
import { t } from './i18n';

// ---- Inbox (INBOX-1) -------------------------------------------------------------------

type UpdateIcon = 'assign' | 'chat' | 'check' | 'people';

interface UpdateWords {
  /** A person's display name ("You" for the viewer). */
  name: (profileId: string) => string;
  /** "Luke 15:11-32" */
  passage: string;
  /** The language it happened in: "Dinka" */
  language: string;
  /** A review kind's name ("Community Check"); "review" when unknown. */
  kindName: (kindId: string | undefined) => string;
  /** Does this kind make content (a back translation) rather than give a verdict? */
  produces?: (kindId: string) => boolean;
  /** A due date as people say it ("due Oct 1"). */
  due?: (date: string) => string;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** One update as the demo words it: a title, a line under it, and its icon. */
export function updateText(u: Update, w: UpdateWords): { title: string; body: string; icon: UpdateIcon } {
  const who = firstName(w.name(u.by));
  const passage = w.passage;
  const language = w.language;
  switch (u.kind) {
    case 'request': {
      const r = u.request;
      const title = r?.what === 'record'
        ? t('account.updates.askedToRecord', { name: who })
        : t('account.updates.askedToReview', { name: who, kind: w.kindName(r?.kindId) });
      const due = r?.dueDate ? (w.due ? w.due(r.dueDate) : t('account.updates.due', { date: r.dueDate })) : null;
      const body = due
        ? t('account.updates.whereDue', { passage, language, due })
        : t('account.updates.where', { passage, language });
      return { icon: 'assign', title, body };
    }
    case 'review': {
      const r = u.review;
      const kind = w.kindName(r?.kindId);
      const name = w.name(u.by);
      const n = u.version ? u.version.n : null;
      if (r && (r.outcome === 'recorded' || w.produces?.(r.kindId))) {
        return {
          icon: 'chat', title: t('account.updates.ready', { kind, passage }),
          body: n !== null ? t('account.updates.madeFromVersion', { name, n }) : t('account.updates.madeFromYours', { name })
        };
      }
      if (r?.outcome === 'looks_good') {
        return {
          icon: 'check', title: t('account.updates.looksGood', { kind }),
          body: n !== null ? t('account.updates.approvedVersion', { name, passage, n }) : t('account.updates.approvedYours', { name, passage })
        };
      }
      return { icon: 'chat', title: t('account.updates.feedbackOn', { passage }), body: t('account.updates.suggestsChanges', { name, kind }) };
    }
    case 'revision':
      return {
        icon: 'chat', title: t('account.updates.revised', { name: who, passage }),
        body: t('account.updates.revisionAnswers', { kind: w.kindName(u.review?.kindId) })
      };
    case 'kept': {
      const note = u.review?.response?.note;
      return {
        icon: 'chat', title: t('account.updates.kept', { name: who, passage }),
        body: note ? t('account.updates.keptReason', { note }) : t('account.updates.keptVoiceNote')
      };
    }
    case 'request_done': {
      const r = u.request;
      if (r?.what === 'record') {
        return { icon: 'check', title: t('account.updates.recorded', { name: who, passage }), body: t('account.updates.recordedBody') };
      }
      return {
        icon: 'check', title: t('account.updates.didReview', { name: who, kind: w.kindName(r?.kindId) }),
        body: t('account.updates.didReviewBody', { passage, language })
      };
    }
  }
}

/**
 * A server Inbox row's title, by its kind (the database writes English):
 * join requests and reports (supabase/migrations, _org_notification_rows),
 * and the projection's updates about a passage ("You were asked to help:
 * Luke 15", server/projectionWorker.ts). A kind this build does not know
 * shows the server's title.
 */
export function remoteTitle(row: { kind: string; title: string }): string {
  // The projection writes "<what happened>: <passage>"; the passage is the organization's own title.
  const at = row.title.indexOf(': ');
  const passage = at >= 0 ? row.title.slice(at + 2) : '';
  switch (row.kind) {
    case 'join_request': return t('account.remote.joinRequest');
    case 'content_report': return t('account.remote.contentReport');
    case 'request': return passage ? t('account.remote.requestOn', { passage }) : t('account.remote.request');
    case 'review': return passage ? t('account.remote.reviewOn', { passage }) : t('account.remote.review');
    case 'revision': return passage ? t('account.remote.revisionOn', { passage }) : t('account.remote.revision');
    case 'kept': return passage ? t('account.remote.keptOn', { passage }) : t('account.remote.kept');
    case 'request_done': return passage ? t('account.remote.requestDoneOn', { passage }) : t('account.remote.requestDone');
    default: return row.title;
  }
}

/** Split into the demo's two groups, newest first within each. */
export function groupByRead<T>(items: T[], isRead: (item: T) => boolean): { unread: T[]; earlier: T[] } {
  const unread: T[] = [];
  const earlier: T[] = [];
  for (const item of items) (isRead(item) ? earlier : unread).push(item);
  return { unread, earlier };
}

/**
 * The join-request id inside a server notification's id. The projection
 * writes `JSON.stringify([orgId, 'join', adminId, requestId])`.
 */
export function joinRequestIdOf(notificationId: string): { orgId: string; requestId: string } | null {
  try {
    const parts = JSON.parse(notificationId) as unknown;
    if (Array.isArray(parts) && parts[1] === 'join' && typeof parts[0] === 'string' && typeof parts[3] === 'string') {
      return { orgId: parts[0], requestId: parts[3] };
    }
  } catch { /* not a join request */ }
  return null;
}

// ---- Server refusals --------------------------------------------------------------------

/** What Supabase Auth's English error means, by its code; `fallback` for one this build does not know. */
export function authErrorText(
  e: { code?: string; name?: string; message?: string } | null | undefined,
  fallback: string,
  offline: string = t('common.notConnected')
): string {
  if (!e) return fallback;
  if (e.name === 'AuthRetryableFetchError' || /fetch|network|failed to send|timed? ?out/i.test(e.message ?? '')) return offline;
  switch (e.code) {
    case 'invalid_credentials': return t('entry.errors.wrongPassword');
    case 'email_not_confirmed': return t('entry.errors.emailNotConfirmed');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit': return t('entry.errors.tooManyTries');
    case 'user_already_exists':
    case 'email_exists': return t('entry.errors.accountExists');
    case 'weak_password': return t('entry.errors.weakPassword');
    case 'same_password': return t('entry.errors.samePassword');
    case 'email_address_invalid':
    case 'validation_failed': return t('entry.errors.badEmail');
    case 'signup_disabled': return t('entry.errors.signupClosed');
    case 'user_banned': return t('entry.errors.suspended');
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used': return t('entry.errors.sessionEnded');
    default: return fallback;
  }
}

/** Why joining by invite failed, from the `join` function's English reply (supabase/functions/join). */
export function joinErrorText(message: string): string {
  if (/fetch|network|failed to send|timed? ?out/i.test(message)) return t('entry.invite.needsConnection');
  switch (message) {
    case 'Unable to join right now. Please retry.': return t('entry.invite.joinBusy');
    case 'This join was already used. Ask whoever invited you for a code to sign back in.': return t('entry.invite.alreadyJoined');
    case 'Type your name to join.': return t('entry.invite.typeName');
    case 'Unable to sign in right now. Please retry.': return t('entry.invite.signInBusy');
    default: return t('entry.invite.joinFailed');
  }
}

/** Why a helper's sign-in code failed, from the `sign-in-code` function's English reply. */
export function signInCodeErrorText(message: string): string {
  if (/fetch|network|failed to send|timed? ?out/i.test(message)) return t('common.tryWhenConnected');
  switch (message) {
    case 'This code is not valid.': return t('entry.signInKey.notValid');
    case 'This code has expired or was already used. Ask for a new one.': return t('entry.signInKey.expiredOrUsed');
    case 'Unable to use this code. Please retry.': return t('entry.signInKey.codeBusy');
    case 'Unable to sign in right now. Please retry.': return t('entry.invite.signInBusy');
    default: return t('entry.signInKey.failed');
  }
}

/**
 * Why a saved account change was turned down. The account outbox keeps the
 * server's English reason (accountData.ts); these are the ones its functions
 * raise (supabase/migrations: create_join_request, save_profile,
 * report_content, set_blocked, record_user_event). Any other: `fallback`.
 */
export function outboxErrorText(error: string | undefined, fallback: string = t('account.outbox.notAccepted')): string {
  switch (error) {
    case 'Sign in again to send your saved changes.': return t('account.outbox.signInAgain');
    case 'sign in required': return t('account.outbox.signInRequired');
    case 'unknown organization': return t('account.outbox.unknownOrg');
    case 'already a member': return t('account.outbox.alreadyMember');
    case 'message too long': return t('account.outbox.messageTooLong');
    case 'Use a name between 1 and 100 characters.': return t('account.outbox.nameLength');
    case 'Only members can report what is in an organization.': return t('account.outbox.membersOnly');
    case 'You cannot report yourself.': return t('account.outbox.reportSelf');
    case 'That person is not in this organization.': return t('account.outbox.notInOrg');
    case 'That is not on the record.': return t('account.outbox.notOnRecord');
    case 'That is a lot of reports for one day. Email admin@frontierrnd.com instead.': return t('account.outbox.tooManyReports');
    case 'You cannot block yourself.': return t('account.outbox.blockSelf');
    case 'You have blocked as many people as one account can.': return t('account.outbox.tooManyBlocks');
    default: return fallback;
  }
}

// ---- Welcome (ONB-1, ADR-022) ------------------------------------------------------------

type WelcomeRole = 'translator' | 'reviewer' | 'admin' | 'viewer';

/** Which welcome someone gets: what they may do, never a job title (ADR-006). */
export function welcomeRoleFor(s: { isAdmin: boolean; can: (p: 'translate' | 'review') => boolean }): WelcomeRole {
  if (s.isAdmin) return 'admin';
  if (s.can('translate')) return 'translator';
  if (s.can('review')) return 'reviewer';
  return 'viewer';
}

type WelcomeIcon = 'mic' | 'people' | 'work' | 'play' | 'chat' | 'building' | 'flow' | 'progress' | 'book';

/** Two or three plain lines per role; each `text` is read in the language showing when it is used. */
export const WELCOME_POINTS: Record<WelcomeRole, { icon: WelcomeIcon; readonly text: string }[]> = {
  translator: [
    { icon: 'mic', get text() { return t('entry.welcome.points.translatorRecord'); } },
    { icon: 'people', get text() { return t('entry.welcome.points.translatorTeam'); } },
    { icon: 'work', get text() { return t('entry.welcome.points.translatorWork'); } }
  ],
  reviewer: [
    { icon: 'play', get text() { return t('entry.welcome.points.reviewerListen'); } },
    { icon: 'chat', get text() { return t('entry.welcome.points.reviewerSay'); } },
    { icon: 'work', get text() { return t('entry.welcome.points.reviewerWork'); } }
  ],
  admin: [
    { icon: 'building', get text() { return t('entry.welcome.points.adminLanguages'); } },
    { icon: 'flow', get text() { return t('entry.welcome.points.adminChecks'); } },
    { icon: 'people', get text() { return t('entry.welcome.points.adminInvite'); } }
  ],
  viewer: [
    { icon: 'progress', get text() { return t('entry.welcome.points.viewerProgress'); } },
    { icon: 'book', get text() { return t('entry.welcome.points.viewerOpen'); } }
  ]
};

/** A fixed role's name ("Organization Admin" for owner), for when the organization's own role has not synced yet. */
export function roleWords(role: Role): string {
  return t(`entry.welcome.roles.${role}`);
}

/** "the Dinka team at Wycliffe Associates" for a language's member, else "Wycliffe Associates". */
export function teamLabel(scope: Scope | undefined, names: { org: string; language?: (languageId: string) => string | undefined }): string {
  if (scope?.level === 'language') {
    const language = names.language?.(scope.languageId);
    if (language) return t('entry.welcome.languageTeam', { language, org: names.org });
  }
  return names.org;
}

/** "a Translator", "an Organization Admin": English only (the welcome picks a whole sentence for each). */
export function withArticle(roleName: string): string {
  return `${/^[aeiou]/i.test(roleName) ? 'an' : 'a'} ${roleName}`;
}

// ---- What is LangQuest? (ONB-2) ----------------------------------------------------------

/** The three cards; `title` and `body` are read in the language showing when they are used. */
export const VISION_STEPS: { readonly title: string; icon: 'globe' | 'book' | 'people'; readonly body: string }[] = [
  { icon: 'globe', get title() { return t('entry.vision.languagesTitle'); }, get body() { return t('entry.vision.languagesBody'); } },
  { icon: 'book', get title() { return t('entry.vision.recordTitle'); }, get body() { return t('entry.vision.recordBody'); } },
  { icon: 'people', get title() { return t('entry.vision.askTitle'); }, get body() { return t('entry.vision.askBody'); } }
];

// The scan screen's invite card is heldInvite.ts `inviteCard`: the server's
// preview, never what a link says about itself (ADR-028).
