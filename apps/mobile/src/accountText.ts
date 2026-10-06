// Words for the getting-in, welcome and Inbox screens, kept pure so they are
// tested without a phone: what an Inbox update says (INBOX-1, the demo's
// notify() wording in App.tsx), what the welcome says for each role (ONB-1,
// ADR-022), the three "What is LangQuest?" cards (ONB-2), and what an invite
// link says about itself before it is redeemed (AUTH-3, ADR-028).
import type { Scope, Update } from '@langquest-next/core';

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
  const where = `${w.passage} (${w.language})`;
  switch (u.kind) {
    case 'request': {
      const r = u.request;
      const what = r?.what === 'record' ? 'record' : `do a ${w.kindName(r?.kindId)}`;
      const due = r?.dueDate ? ` — ${w.due ? w.due(r.dueDate) : `due ${r.dueDate}`}` : '';
      return { icon: 'assign', title: `${who} asked you to ${what}`, body: `${where}${due}` };
    }
    case 'review': {
      const r = u.review;
      const kind = w.kindName(r?.kindId);
      const version = u.version ? `Version ${u.version.n}` : 'your version';
      if (r && (r.outcome === 'recorded' || w.produces?.(r.kindId))) {
        return { icon: 'chat', title: `${kind} of ${w.passage} is ready`, body: `${w.name(u.by)} made it from ${version}.` };
      }
      if (r?.outcome === 'looks_good') {
        return { icon: 'check', title: `${kind}: looks good`, body: `${w.name(u.by)} approved ${w.passage} (${version}).` };
      }
      return { icon: 'chat', title: `Feedback on ${w.passage}`, body: `${w.name(u.by)}: ${kind} suggests changes — revise, or keep it and say why.` };
    }
    case 'revision':
      return { icon: 'chat', title: `${who} revised ${w.passage}`, body: `The new version answers your ${w.kindName(u.review?.kindId)} feedback.` };
    case 'kept': {
      const note = u.review?.response?.note;
      return { icon: 'chat', title: `${who} kept ${w.passage} as is`, body: note ? `Reason: ${note}` : 'They said why in a voice note.' };
    }
    case 'request_done': {
      const r = u.request;
      if (r?.what === 'record') {
        return { icon: 'check', title: `${who} recorded ${w.passage}`, body: "It's on the record — ask for a review when you're ready." };
      }
      return { icon: 'check', title: `${who} did the ${w.kindName(r?.kindId)} you asked for`, body: `${where} — it's on the record.` };
    }
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

// ---- Welcome (ONB-1, ADR-022) ------------------------------------------------------------

type WelcomeRole = 'translator' | 'reviewer' | 'admin' | 'viewer';

/** Which welcome someone gets: what they may do, never a job title (ADR-006). */
export function welcomeRoleFor(s: { isAdmin: boolean; can: (p: 'translate' | 'review') => boolean }): WelcomeRole {
  if (s.isAdmin) return 'admin';
  if (s.can('translate')) return 'translator';
  if (s.can('review')) return 'reviewer';
  return 'viewer';
}

export const WELCOME_POINTS: Record<WelcomeRole, { icon: 'mic' | 'people' | 'work' | 'play' | 'chat' | 'building' | 'flow' | 'progress' | 'book'; text: string }[]> = {
  translator: [
    { icon: 'mic', text: 'Record passages in your language.' },
    { icon: 'people', text: 'Your team listens and says what to change.' },
    { icon: 'work', text: "My Work shows what's next for you." }
  ],
  reviewer: [
    { icon: 'play', text: 'Listen to recordings when someone asks you.' },
    { icon: 'chat', text: 'Say what works and what should change.' },
    { icon: 'work', text: 'My Work shows who is waiting on you.' }
  ],
  admin: [
    { icon: 'building', text: 'Add the languages your teams record.' },
    { icon: 'flow', text: 'Choose how passages get checked.' },
    { icon: 'people', text: 'Invite your team.' }
  ],
  viewer: [
    { icon: 'progress', text: 'See how far each language has come.' },
    { icon: 'book', text: 'Open any passage to hear what happened.' }
  ]
};

/** "the Dinka team at Wycliffe Associates" for a language's member, else "Wycliffe Associates". */
export function teamLabel(scope: Scope | undefined, names: { org: string; language?: (languageId: string) => string | undefined }): string {
  if (scope?.level === 'language') {
    const language = names.language?.(scope.languageId);
    if (language) return `the ${language} team at ${names.org}`;
  }
  return names.org;
}

/** "a Translator", "an Organization Admin". */
export function withArticle(roleName: string): string {
  return `${/^[aeiou]/i.test(roleName) ? 'an' : 'a'} ${roleName}`;
}

// ---- What is LangQuest? (ONB-2) ----------------------------------------------------------

export const VISION_STEPS: { title: string; icon: 'globe' | 'book' | 'people'; body: string }[] = [
  { title: 'Scripture in every language', icon: 'globe', body: 'Teams record the Bible in their own language, check it together, and share it.' },
  { title: 'Every passage keeps a record', icon: 'book', body: 'Recordings, notes and feedback stay with the passage, so the next person knows what happened.' },
  { title: 'Do it, or ask someone', icon: 'people', body: 'Your organization suggests what comes next. Do it yourself, ask someone, or say why not.' }
];

// The scan screen's invite card is heldInvite.ts `inviteCard`: the server's
// preview, never what a link says about itself (ADR-028).
