import type { ScreenId } from './flow';
import type { Session } from './session';
import type { OrgHandle } from './useOrg';
import type { ProjectHandle } from './useProject';

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
  markVisionSeen: () => void;
  openDev: () => void;
  isDev: boolean;
  /** May this session switch persona? Dev builds, or a named tester (dev.ts). */
  canSwitchPersona: boolean;
}
