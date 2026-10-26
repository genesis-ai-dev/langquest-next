import { t } from '../i18n';

// Whether this session is read-only (a Global Viewer looking in, decisions.md 158). The state and
// the words for its refusal sit here, below the recorder and the server; the handles that refuse
// writes are shell/readOnly.ts.

/** Whether the open organization is read-only for this session, for messages outside it (failureMessage). */
let readOnlyNow = false;

export function setReadOnlySession(on: boolean): void {
  readOnlyNow = on;
}

/** Is the open organization read-only for this session? The recorder asks before it opens the microphone. */
export function isReadOnlySession(): boolean {
  return readOnlyNow;
}

/**
 * The words for a server's refusal of a write while read-only: a call the
 * screens make to the server directly (an invite, a listing) is refused as
 * not allowed (SQLSTATE 42501), which here is the session, not a fault.
 */
export function readOnlyRefusal(e: unknown): string | null {
  return readOnlyNow && (e as { code?: unknown } | null)?.code === '42501' ? t('globalViewer.readOnly') : null;
}
