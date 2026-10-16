// A language's review flow (decision 136): its checks on top, with Edit; the
// ready-made flows it could start from instead under them; and, last, the
// organization's whole shelf (Review flows). Opened from the language's page
// as get_ready `step: 'flow'`. Using a ready-made flow copies its checks into
// the language (decision 91) and asks first over its own (decision 134).
import { commands, CUSTOM_FLOW, deriveFlow, languageName, type EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { deriveKinds } from '../i18n/coreText';
import { indexesFor } from '../sync/indexes';
import { Group, Header, PrimaryBtn, Row, Screen } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { HelpRow } from '../helpMode/helpBadge';
import { ConfirmDelete } from '../ui/ConfirmDelete';
import { failureMessage } from '../diagnostics/report';
import { NumberedSteps, PickCard, RadioRow } from '../admin/admin';
import { checksLine, flowSub, flowWho, sameChecks } from '../admin/adminModel';
import { useCheckChoices, type FlowEntry } from '../admin/useChoices';

const PAD = { paddingHorizontal: 20, gap: 14 } as const;

export function ReviewFlowPage({ ctx }: { ctx: Ctx }) {
  const state = ctx.language.state!;
  const languageId = ctx.language.languageId;
  const language = languageName(ctx.org.state, languageId);
  const kinds = useMemo(() => deriveKinds(state), [state]);
  const flow = useMemo(() => deriveFlow(state), [state]);
  const { entries, current, kindsOf, loaded } = useCheckChoices(ctx, flow.itemId, kinds);
  // Each named as the language's page names its checks: in order (decision 136).
  const nameOf = (e: FlowEntry) => checksLine(e.doc.steps, kindsOf(e.doc));
  const canUse = ctx.session.can('manage_flows');
  const [picked, setPicked] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<FlowEntry | null>(null);
  const [busy, setBusy] = useState(false);
  // The ready-made flow its checks still are, if any: it is the pick, not an option.
  const same = entries.find((e) => e.c === current || (flow.steps.length > 0 && sameChecks(flow.steps, e.doc.steps))) ?? null;
  const options = entries.filter((e) => e !== same);
  const pick = options.find((e) => e.c.key === picked) ?? null;
  // Checks no ready-made flow made would be gone for good: Use asks first (decision 134).
  const own = flow.flowId === CUSTOM_FLOW && flow.steps.length > 0 && !same;

  async function take(e: FlowEntry) {
    if (busy) return;
    setBusy(true);
    let specs: EventSpec[];
    try {
      // A ready-made flow is copied into the language, its checks the language's own (decision 91).
      specs = commands(state, indexesFor(state)).copyFlow({ commandId: Crypto.randomUUID(), name: e.c.name, kinds: kindsOf(e.doc), steps: e.doc.steps });
    } catch (err) {
      ctx.toast(t('common.notSaved', { reason: failureMessage('use flow', err) })); // i18n-ignore: log label
      setBusy(false);
      return;
    }
    try {
      await ctx.act(specs, t('checks.flows.used', { name: nameOf(e), language }));
      setPicked(null);
    } catch {
      // ctx.act has already said "Not saved" and why.
    }
    setBusy(false);
  }

  return (
    <Screen header={<Header title={t('org.language.reviewFlow')} sub={language} onBack={ctx.back} />} bodyStyle={PAD}
      footer={pick && canUse ? (
        <PrimaryBtn label={t('checks.flows.use', { name: nameOf(pick) })} icon="check" busy={busy} help={t('checks.flows.useHelp', { language })}
          onPress={() => (own ? setReplacing(pick) : void take(pick))} />
      ) : undefined}>
      <PickCard title={checksLine(flow.steps, kinds)} sub={flowSub(flow.steps)}
        links={canUse ? [{ label: t('common.edit'), help: t('org.language.checksHelp'), onPress: () => ctx.go('flow_editor', { languageId, steps: 'language' }) }] : []}>
        {flow.steps.length ? <NumberedSteps items={flowWho(flow.steps, kinds)} /> : null}
      </PickCard>
      {options.map((e) => (
        <HelpRow key={e.c.key} of="getReady.flow.option">
          <RadioRow icon="people" label={nameOf(e)} sub={flowSub(e.doc.steps)} on={picked === e.c.key}
            help={canUse ? t('checks.flows.pickHelp') : t('getReady.flow.optionViewHelp')} onPress={() => { if (canUse) setPicked(picked === e.c.key ? null : e.c.key); }} />
        </HelpRow>
      ))}
      {entries.length === 0 && !loaded ? <Text style={txt.smMuted}>{t('common.loading')}</Text> : null}
      {canUse ? (
        <Group>
          <Row icon="flow" label={t('getReady.flow.all')} help={t('getReady.flow.allHelp')} last onPress={() => ctx.go('flows_home', { level: 'language', languageId })} />
        </Group>
      ) : null}
      <ConfirmDelete visible={!!replacing} name={replacing ? nameOf(replacing) : ''} replaces
        title={t('checks.flows.replaceAsk', { language, name: replacing ? nameOf(replacing) : '' })} confirmLabel={t('checks.flows.use', { name: replacing ? nameOf(replacing) : '' })}
        onClose={() => setReplacing(null)} onConfirm={() => { const r = replacing; setReplacing(null); if (r) void take(r); }} />
    </Screen>
  );
}
