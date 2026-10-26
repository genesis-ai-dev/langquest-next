import { useContext } from 'react';
import { ModalCoverContext } from './coverContext';

/** What the app puts over a modal's contents (coverContext.ts), as the modal's last child. */
export function ModalCover() {
  const Cover = useContext(ModalCoverContext);
  return Cover ? <Cover /> : null;
}
