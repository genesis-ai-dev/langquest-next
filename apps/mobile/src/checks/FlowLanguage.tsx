// A ready-made flow published in several languages (admin/flowSetsModel.ts):
// the language it is shown in, and a sheet to switch to another, as a
// guide set's language is chosen (reference/GuideLanguageSheet.tsx).
import { useState } from 'react';
import { View } from 'react-native';
import { HelpRow } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { languageLabel } from '../admin/adminModel';
import type { FlowEntry } from '../admin/useChoices';
import { LinkBtn, Row, Sheet } from '../ui/kit';
import { space } from '../ui/theme';

export function FlowLanguageLink(props: { entry: FlowEntry; onPick: (entryKey: string) => void }) {
  const [open, setOpen] = useState(false);
  const set = props.entry.set;
  if (!set) return null;
  const now = set.members.find((m) => m.entry.c.key === props.entry.c.key)?.language;
  return (
    <View style={{ paddingHorizontal: space.sm }}>
      <LinkBtn label={t('checks.flows.inLanguage', { language: now ? languageLabel(now) : '' })} style={{ alignSelf: 'flex-start' }}
        help={t('checks.flows.inLanguageHelp')} onPress={() => setOpen(true)} />
      <Sheet visible={open} title={t('checks.flows.languageTitle')} onClose={() => setOpen(false)}>
        {set.members.map((m, i) => (
          <HelpRow key={m.entry.c.key} of="checks.flowLanguage">
            <Row icon={m.entry.c.key === props.entry.c.key ? 'check' : 'globe'} label={languageLabel(m.language)} sub={m.entry.c.name}
              role="radio" selected={m.entry.c.key === props.entry.c.key} last={i === set.members.length - 1}
              onPress={() => { props.onPick(m.entry.c.key); setOpen(false); }} />
          </HelpRow>
        ))}
      </Sheet>
    </View>
  );
}
