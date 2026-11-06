import type { GlobalViewerAccess } from '../account/globalViewerModel';
import type { LayoutKind } from '../ui/layout';
import { PASSAGE_READING, TAB_SCREENS, type ScreenId } from './flow';

/**
 * Drill-downs under Manage and Settings that keep the rail or sidebar on a
 * wide window, so it does not vanish while a list and its editor sit side by
 * side. Task screens (recording, reviewing, asking, signing in) still hide it
 * at any width (ADR-021).
 */
export const WIDE_CHROME: readonly ScreenId[] = [
  'members_list', 'edit_member', 'invite_member', 'invite_qr', 'new_language', 'check_editor',
  'roles_home', 'role_editor', 'flows_home', 'flow_editor', 'templates_home', 'template_editor', 'book_structure',
  'reference_home', 'material_editor', 'guide_editor', 'key_terms', 'key_term_detail', 'profile_edit', 'org_switcher', 'sync_status', 'settings_more', 'global_viewer',
  'reference_bibles', 'reference_source', 'reference_guides', 'reference_coverage',
  // The Reports tab exists only on a wide window (decisions.md 57).
  'reports_home', 'reports_language'
];

/**
 * A passage and what you read under it are tasks on a phone, as Ryder drew
 * them (decision 71): the footer holds the one main button, with no tab bar
 * under it; Back returns to the list it came from.
 */
const PHONE_TASKS: readonly ScreenId[] = ['passage_record', ...PASSAGE_READING];

/**
 * Task screens closed with a ✕ (ADR-021), each with sideways drags of its
 * own: a part slides to its bin, a stopped session's waveform pans, a version
 * card swipes, a timeline is dragged. On iOS only a swipe from the screen's
 * edge goes back from them, not a drag anywhere.
 */
export const TASK_SCREENS: readonly ScreenId[] = [
  'workspace', 'back_translation', 'review_capture', 'add_record', 'guest_review', 'study_guide', 'study_step',
  'get_ready', 'new_language', 'ask_someone', 'review_detail'
];

/** Whether the tabs (bar, rail or sidebar) show on this screen. On a phone, the demo's tab screens but a passage's own. */
export function chromeVisible(kind: LayoutKind, screen: ScreenId): boolean {
  if (kind === 'phone' && PHONE_TASKS.includes(screen)) return false;
  if (TAB_SCREENS.includes(screen)) return true;
  return kind !== 'phone' && WIDE_CHROME.includes(screen);
}

/** Does the header carry the Global Viewer link? Whoever has the access (not revoked), once an organization is open: also in one of their own, where the code goes. */
export function showsGlobalViewerLink(globalViewer: GlobalViewerAccess | null, orgOpen: boolean): boolean {
  return globalViewer !== null && globalViewer !== 'revoked' && orgOpen;
}
