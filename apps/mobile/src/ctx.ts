import type { EventSpec, Update } from '@langquest-next/core';
import type { ScreenId } from './flow';
import type { Blocks } from './moderationData';
import type { Session } from './session';
import type { InviteHandle } from './useHeldInvite';
import type { OrgHandle } from './useOrg';
import type { LanguageHandle } from './useLanguage';

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
   * (CORE-5). With `undo`, the toast offers Undo for about 7 seconds; undo
   * appends the inverse events, never deletes.
   */
  act: (specs: EventSpec[], message: string, undo?: () => EventSpec[]) => Promise<void>;
  /** Say what happened, with Undo when it can be undone. */
  toast: (message: string, undo?: () => void | Promise<void>) => void;
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
  openOrganization: (orgId: string) => Promise<void>;
  openDev: () => void;
  isDev: boolean;
  /** May this session switch persona? Dev builds, or a named tester (dev.ts). */
  canSwitchPersona: boolean;
}
