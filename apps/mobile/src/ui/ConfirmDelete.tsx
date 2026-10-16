// Asking before a whole thing is deleted (Caleb, 2026-10-16): a version, a
// draft, or every part at once. Not a toast whose Undo is about to vanish:
// the sheet names what goes and waits. A single part is still deleted at
// once, with Undo, since it is said again in a moment.
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { GhostBtn, PrimaryBtn, Sheet } from './kit';

export function ConfirmDelete(props: {
  visible: boolean;
  /** What goes, by its name: "Version 2", "Draft 1", "Parts 1–5". */
  name: string;
  /** What it holds: "5 parts · 0:49 · Verses 49–59". */
  sub?: string;
  /** In place of "Delete {name}?" and "Delete {name}", when the thing has no one name. */
  title?: string; confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Sheet visible={props.visible} title={props.title ?? t('common.deleteAsk', { name: props.name })} {...(props.sub ? { sub: props.sub } : {})} onClose={props.onClose}
      footer={(
        <>
          <PrimaryBtn label={props.confirmLabel ?? t('passage.versions.delete', { name: props.name })} icon="trash" tone="red" busy={!!props.busy} onPress={props.onConfirm} />
          <GhostBtn label={t('common.cancel')} help={t('help.details.cancel')} onPress={props.onClose} />
        </>
      )}>
      {props.children ?? null}
    </Sheet>
  );
}
