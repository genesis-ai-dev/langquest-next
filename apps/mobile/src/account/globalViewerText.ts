import { t } from '../i18n';
import type { GlobalViewerAccess } from './globalViewerModel';

/** What a Global Viewer's way in says about their access now (decisions.md 158). */
export function globalViewerLine(access: GlobalViewerAccess): string {
  switch (access) {
    case 'needs_setup': return t('globalViewer.lineSetUp');
    case 'needs_code': return t('globalViewer.lineCode');
    case 'on': return t('globalViewer.lineOn');
    case 'revoked': return t('globalViewer.lineRevoked');
  }
}
