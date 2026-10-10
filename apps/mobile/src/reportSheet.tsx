// Report or block someone else's content, and hide what a blocked person
// added (decisions.md 48). App-only: Google Play's user-generated content
// policy asks for both, and the partner demo has neither. A flag on anything
// someone else made opens a sheet, never a flow node, so the demo's flow is
// unchanged. Kept in its own file so kit.tsx stays free of I/O.
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from './ctx';
import { Field, GhostBtn, Group, Ico, IconBtn, LinkBtn, PrimaryBtn, Row, Sheet, txt } from './kit';
import { t } from './i18n';
import {
  hiddenText, personTarget, reasonLabel, reasonSub, removeThingTitle, REPORT_REASON_IDS, reportThingLabel, thingByLine,
  type ReportKind, type ReportReason, type ReportTarget
} from './moderation';
import { dismissReports, queueReport, removeContent, reportsChanged } from './moderationData';
import { failureMessage, noteExpected } from './report';
import { C, radius, space, TINT } from './theme';

/** A piece of the open language's record, as something to report. */
export function recordTarget(ctx: Ctx, kind: Exclude<ReportKind, 'person'>, id: string, by: string, unitId?: string): ReportTarget {
  return { kind, id, profileId: by, orgId: ctx.language.orgId, languageId: ctx.language.languageId, ...(unitId ? { unitId } : {}) };
}

/** May this person take it out of the record, or act on a report about someone? The server checks again. */
function canModerate(ctx: Ctx, target: ReportTarget): boolean {
  return target.kind === 'person' ? ctx.session.can('invite_members') : ctx.session.can('manage_structure');
}

/** A server's refusal or a lost connection, as a reason to show: never the server's own English. */
const looksOffline = (e: unknown) => !(e instanceof Error) || /network|fetch|offline|timed? ?out|not connected/i.test(e.message);

/**
 * The flag on something someone else made: opens Report or block. Nothing
 * for your own work, or when signed out.
 */
export function ReportFlag(props: { ctx: Ctx; target: ReportTarget; size?: number }) {
  const [open, setOpen] = useState(false);
  const { ctx, target } = props;
  if (ctx.session.isGuest || target.profileId === ctx.session.actorId || !target.profileId) return null;
  return (
    <>
      <IconBtn name="flag" label={t('moderation.flagLabel', { name: ctx.name(target.profileId) })} onPress={() => setOpen(true)}
        size={props.size ?? 40} color={C.muted} bg={C.card} />
      {open ? <ReportSheet ctx={ctx} target={target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Step = { at: 'menu' } | { at: 'report'; of: ReportTarget } | { at: 'remove' };

/** Report the thing or its maker, block or unblock them, or (for a moderator) take it out of the record. */
function ReportSheet(props: { ctx: Ctx; target: ReportTarget; onClose: () => void; startAt?: 'report' }) {
  const { ctx, target } = props;
  const [step, setStep] = useState<Step>(props.startAt === 'report' ? { at: 'report', of: target } : { at: 'menu' });
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = ctx.name(target.profileId);
  const blocked = ctx.blocks.has(target.profileId);

  async function send(of: ReportTarget) {
    if (!reason) return;
    setBusy(true);
    try {
      await queueReport(ctx.session.actorId, of, reason, details);
      if (alsoBlock && !blocked) await ctx.blocks.set(target.profileId, true);
      ctx.toast(alsoBlock ? t('moderation.toast.reportedAndBlocked', { name: who }) : t('moderation.toast.reported'));
      props.onClose();
    } catch (e) {
      ctx.toast(failureMessage('report content', e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleBlock() {
    try {
      await ctx.blocks.set(target.profileId, !blocked);
      ctx.toast(blocked ? t('moderation.toast.unblocked', { name: who }) : t('moderation.toast.blocked', { name: who }), async () => {
        await ctx.blocks.set(target.profileId, blocked);
      });
      props.onClose();
    } catch (e) {
      ctx.toast(failureMessage('block person', e));
    }
  }

  async function remove() {
    setBusy(true);
    try {
      // i18n-ignore: the reason stored with the removal on the server
      await removeContent(target, 'Removed by a moderator');
      reportsChanged();
      ctx.toast(t('moderation.toast.removed'));
      props.onClose();
    } catch (e) {
      // Offline or refused: the server's answer says which.
      noteExpected('remove content', e);
      ctx.toast(looksOffline(e) ? t('moderation.toast.notRemovedOffline') : t('moderation.toast.notRemovedRefused'));
    } finally {
      setBusy(false);
    }
  }

  if (step.at === 'report') {
    const of = step.of;
    const ready = !!reason && (reason !== 'other' || details.trim().length > 0);
    return (
      <Sheet visible title={of.kind === 'person' ? t('moderation.reportPerson', { name: who }) : reportThingLabel(of.kind)}
        sub={t('moderation.report.whatIsWrong')} onClose={props.onClose}
        footer={<PrimaryBtn label={t('moderation.report.send')} icon="flag" disabled={!ready || busy} busy={busy} onPress={() => void send(of)} />}>
        <Group>
          {REPORT_REASON_IDS.map((id, i) => (
            <Row key={id} label={reasonLabel(id)} sub={reasonSub(id)} role="radio" selected={reason === id} last={i === REPORT_REASON_IDS.length - 1}
              right={<View style={[styles.radio, reason === id && styles.radioOn]}>{reason === id ? <Ico name="check" size={16} color={C.white} /> : null}</View>}
              onPress={() => setReason(id)} />
          ))}
        </Group>
        <Field value={details} onChangeText={setDetails} placeholder={reason === 'other' ? t('moderation.report.whatIsWrong') : t('moderation.report.anythingElse')} multiline />
        {!blocked ? (
          <Group>
            <Row icon="block" iconColor={TINT.redText} label={t('moderation.report.alsoBlock', { name: who })} sub={t('moderation.report.alsoBlockSub')}
              role="checkbox" checked={alsoBlock} onPress={() => setAlsoBlock((b) => !b)} last
              right={<View style={[styles.radio, styles.box, alsoBlock && styles.radioOn]}>{alsoBlock ? <Ico name="check" size={16} color={C.white} /> : null}</View>} />
          </Group>
        ) : null}
        <Text style={txt.xs}>{t('moderation.report.whoSees', { name: who })}</Text>
      </Sheet>
    );
  }

  // Only something someone made can be removed; a person is removed under Members.
  if (step.at === 'remove' && target.kind !== 'person') {
    return (
      <Sheet visible title={removeThingTitle(target.kind)} sub={t('moderation.remove.sub')} onClose={props.onClose}
        footer={(
          <>
            <PrimaryBtn label={t('moderation.remove.confirm')} icon="trash" tone="red" disabled={busy} busy={busy} onPress={() => void remove()} />
            <GhostBtn label={t('common.cancel')} onPress={() => setStep({ at: 'menu' })} />
          </>
        )}>
        <Text style={txt.body}>{t('moderation.remove.body')}</Text>
      </Sheet>
    );
  }

  return (
    <Sheet visible title={t('moderation.menu.title')} sub={target.kind === 'person' ? who : thingByLine(target.kind, who)}
      onClose={props.onClose}>
      <Group>
        {target.kind !== 'person' ? (
          <Row icon="flag" iconColor={TINT.redText} label={reportThingLabel(target.kind)} sub={t('moderation.menu.reportThingSub')}
            onPress={() => setStep({ at: 'report', of: target })} />
        ) : null}
        <Row icon="flag" iconColor={TINT.redText} label={t('moderation.reportPerson', { name: who })} sub={t('moderation.menu.reportPersonSub')}
          onPress={() => setStep({ at: 'report', of: personTarget(target) })} />
        <Row icon="block" iconColor={TINT.redText} label={blocked ? t('moderation.menu.unblock', { name: who }) : t('moderation.menu.block', { name: who })}
          sub={blocked ? t('moderation.menu.unblockSub') : t('moderation.menu.blockSub')}
          onPress={() => void toggleBlock()} last={!(target.kind !== 'person' && canModerate(ctx, target))} />
        {target.kind !== 'person' && canModerate(ctx, target) ? (
          <Row icon="trash" iconColor={TINT.redText} label={t('moderation.removeFromRecord')} sub={t('moderation.menu.removeSub')}
            onPress={() => setStep({ at: 'remove' })} last />
        ) : null}
      </Group>
    </Sheet>
  );
}

/**
 * A moderator's choices for an open report: look at it, take it out of the
 * record, or keep it. A report about a person points to Members, where
 * they can be removed.
 */
export function ReportActions(props: { ctx: Ctx; target: ReportTarget; onDone: () => void; onOpen: () => void }) {
  const { ctx, target } = props;
  const [busy, setBusy] = useState(false);
  async function run(what: 'remove' | 'keep') {
    setBusy(true);
    try {
      // i18n-ignore: the reason stored with the removal on the server
      if (what === 'remove') await removeContent(target, 'Removed after a report');
      else await dismissReports(target);
      reportsChanged();
      ctx.toast(what === 'remove' ? t('moderation.toast.removed') : t('moderation.toast.kept'));
      props.onDone();
    } catch (e) {
      noteExpected(`report ${what}`, e);
      ctx.toast(looksOffline(e) ? t('moderation.toast.notSavedOffline') : t('moderation.toast.notSavedRefused'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {target.kind === 'person' ? (
        <PrimaryBtn label={t('moderation.actions.openMembers')} icon="people" onPress={props.onOpen} />
      ) : (
        <>
          <PrimaryBtn label={t('moderation.removeFromRecord')} icon="trash" tone="red" disabled={busy} busy={busy} onPress={() => void run('remove')} />
          {target.unitId ? <GhostBtn label={t('moderation.actions.openPassage')} onPress={props.onOpen} /> : null}
        </>
      )}
      <GhostBtn label={target.kind === 'person' ? t('moderation.actions.closeReport') : t('moderation.actions.keep')} disabled={busy} onPress={() => void run('keep')} />
    </>
  );
}

/**
 * What someone made, unless this person blocked them: then a line saying
 * it is hidden, and Show for this once. Their work still counts toward the
 * passage's status; only its words, audio and photos are hidden.
 */
export function Authored(props: { ctx: Ctx; by: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown || props.by === props.ctx.session.actorId || !props.ctx.blocks.has(props.by)) return <>{props.children}</>;
  return (
    <View style={styles.hidden}>
      <Ico name="block" size={18} color={C.muted} />
      <Text style={[txt.sm, { flex: 1, color: C.muted }]}>{t('moderation.hidden.byName', { name: props.ctx.name(props.by) })}</Text>
      <LinkBtn label={t('moderation.hidden.show')} onPress={() => setShown(true)} accessibilityLabel={t('moderation.hidden.showLabel', { name: props.ctx.name(props.by) })} />
    </View>
  );
}

/** Someone's words in a line of text, unless this person blocked them. */
export function authoredText(ctx: Ctx, by: string | undefined, text: string): string {
  return by && by !== ctx.session.actorId && ctx.blocks.has(by) ? hiddenText() : text;
}

const styles = StyleSheet.create({
  hidden: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md,
    borderRadius: radius.md, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed'
  },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  box: { borderRadius: 6 },
  radioOn: { backgroundColor: C.primary, borderColor: C.primary }
});
