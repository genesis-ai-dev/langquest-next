// Words for the Ready screen (admin/ready.tsx).
import { t } from '../i18n';

/** "How this works": the checklist's own words, spoken in help mode (about 40 seconds). */
export function howItWorks(language: string): string {
  return t('admin.howItWorks.text', { language });
}

/** What help mode says picking one of the plain choices means (`id` a PlainRoleId); any other role, what a role is. */
export function plainRoleHelp(id: string): string {
  switch (id) {
    case 'translate': return t('admin.roles.translateHelp');
    case 'check': return t('admin.roles.checkHelp');
    case 'backtranslate': return t('admin.roles.backtranslateHelp');
    case 'lead': return t('admin.roles.leadHelp');
    default: return t('admin.invite.pickRoleHelp');
  }
}
