import type { EventSpec, Update } from '@langquest-next/core';
import type { ScreenId } from './flow';
import type { Blocks } from '../moderation/moderationData';
import type { Session } from './session';
import type { InviteHandle } from '../invites/useHeldInvite';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';
import type { V2Welcome } from '../account/welcomeBack';

/** A passage someone opened lately (WORK-2), newest first. */
export interface RecentPassage {
  unitId: string;
  languageId: string;
  at: number;
}

/** Everything a screen gets. Screens never own shared state or navigate directly. */
export interface Ctx {
  /** The open language's stream (decision 63). */
  language: LanguageHandle;
  /** The organization stream: roles, memberships, languages, library. */
  org: OrgHandle;
  session: Session;
  params: Record<string, string>;
  /** Navigate along a declared edge; mode comes from the edge. */
  go: (to: ScreenId, params?: Record<string, string>) => void;
  back: () => void;
  home: () => void;

  /**
   * The language this person is working in, which is the open stream: the
   * Map, My Work's suggestions and new requests default to it (MAP-7).
   * Remembered per account on this device; null only when the organization
   * has no languages yet.
   */
  languageId: string | null;
  setLanguage: (languageId: string) => void;
  /**
   * Every language the organization has, from its stream (decision 63),
   * whether or not this phone has it: each is its own stream, and
   * `language` is the open one. A screen about another language opens it.
   */
  languages: { languageId: string; name: string }[];
  /**
   * Apply a command's events (core `commands()`), then say what changed
   * (CORE-5). No toast offers Undo (decision 134): the way back stays on the
   * screen, with the thing.
   */
  act: (specs: EventSpec[], message: string) => Promise<void>;
  /** Say what happened; `'problem'` when it went wrong: an amber warning that stays until closed. */
  toast: (message: string, tone?: 'problem') => void;
  /** Details on request (ADR-013): open state per thing shown, kept across a visit and Back. */
  details: (key: string) => { open: boolean; onToggle: () => void };
  /** Passages this person opened lately, newest first (WORK-2). */
  recent: RecentPassage[];
  /** Open a passage's record and remember it under Recent. Follows the declared edge from the current screen. */
  openPassage: (unitId: string, languageId: string, extra?: Record<string, string>) => void;
  /** A person's display name; the signed-in person is always "You" (CORE-6). */
  name: (profileId: string, lower?: boolean) => string;
  /**
   * People this account blocked (decisions.md 48). What they add is hidden
   * behind "Show" on this account's phones; their work still counts.
   */
  blocks: Blocks;
  /** Record-derived updates for the Inbox and which of them this device has shown. */
  inbox: { updates: Update[]; unread: number; isRead: (id: string) => boolean; markRead: (ids: string[]) => void };

  /**
   * Someone who came from LangQuest v2 and has not been welcomed yet: what
   * of their v2 work has arrived, and a way to look again (welcomeBack.ts,
   * demo ADR-043). Absent for everyone else.
   */
  welcomeBack?: { data: V2Welcome; refresh: () => Promise<V2Welcome | null> };
  /** The first sign-in welcome was seen (ADR-022). */
  markWelcomed: () => Promise<void>;
  /** Terms accepted by signing in (AUTH-1); pass the new account's id right after sign-in. */
  acceptTerms: (actorId?: string) => Promise<void>;
  /** Someone just joined by invite: they get the welcome even if this account was welcomed before (ADR-022). */
  markJoined: (actorId: string) => Promise<void>;
  /**
   * The held invite (docs/invites-and-accounts.md): what was scanned, who it
   * is for, and what happened to it. Screens read it and say who is joining;
   * the app uses it.
   */
  invite: InviteHandle;
  /** Switch to another organization: its stream, and the language it opens to. */
  /** Switch organization; `open` names the language, and the passage, to open once it is in (an Inbox row from there). */
  openOrganization: (orgId: string, open?: { languageId: string; unitId?: string }) => Promise<void>;
  openDev: () => void;
  isDev: boolean;
  /** May this session switch persona? Dev builds, or a named tester (dev.ts). */
  canSwitchPersona: boolean;
}
