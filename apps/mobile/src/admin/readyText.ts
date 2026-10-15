// Words for the Ready screen (admin/ready.tsx).
import { t } from '../i18n';

/** "How this works": the checklist's own words, spoken in help mode (about 40 seconds). */
export function howItWorks(language: string): string {
  return t('admin.howItWorks.text', { language });
}
