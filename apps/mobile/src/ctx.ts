import type { EventSpec, Update } from '@langquest-next/core';
import type { ScreenId } from './flow';
import type { Session } from './session';
import type { OrgHandle } from './useOrg';
import type { ProjectHandle } from './useProject';

/** A passage someone opened lately (WORK-2), newest first. */
export interface RecentPassage {
  unitId: string;
  laneId: string;
  at: number;
}

/** Everything a screen gets. Screens never own shared state or navigate directly. */
export interface Ctx {
  project: ProjectHandle;
  /** The organization partition: roles, memberships, catalog, projects. */
  org: OrgHandle;
  session: Session;
  params: Record<string, string>;
  /** Navigate along a declared edge; mode comes from the edge. */
  go: (to: ScreenId, params?: Record<string, string>) => void;
  back: () => void;
  home: () => void;

  /**
   * The language (lane) this person is working in: the Map, My Work's
   * suggestions and new requests default to it (MAP-7). Remembered per
   * account on this device; null only when the project has no languages.
   */
  laneId: string | null;
  setLane: (laneId: string) => void;
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
  openPassage: (unitId: string, laneId: string, extra?: Record<string, string>) => void;
  /** A person's display name; the signed-in person is always "You" (CORE-6). */
  name: (profileId: string, lower?: boolean) => string;
  /** Record-derived updates for the Inbox and which of them this device has shown. */
  inbox: { updates: Update[]; unread: number; isRead: (id: string) => boolean; markRead: (ids: string[]) => void };

  /** The first sign-in welcome was seen (ADR-022). */
  markWelcomed: () => Promise<void>;
  /** Terms accepted by signing in (AUTH-1). */
  acceptTerms: () => Promise<void>;
  rememberInvite: (value: string) => Promise<void>;
  openOrganization: (orgId: string, projectId?: string) => Promise<void>;
  openDev: () => void;
  isDev: boolean;
  /** May this session switch persona? Dev builds, or a named tester (dev.ts). */
  canSwitchPersona: boolean;
}
