// Report or block someone else's content, and hide what a blocked person
// added (decisions.md 48). App-only: Google Play's user-generated content
// policy asks for both, and the partner demo has neither. A flag on anything
// someone else made opens a sheet, never a flow node, so the demo's flow is
// unchanged. Kept in its own file so kit.tsx stays free of I/O.
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ctx } from './ctx';
import { Field, GhostBtn, Group, Ico, IconBtn, LinkBtn, PrimaryBtn, Row, Sheet, txt } from './kit';
import {
  HIDDEN_TEXT, personTarget, REPORT_REASONS, thingLabel, type ReportKind, type ReportReason, type ReportTarget
} from './moderation';
import { dismissReports, queueReport, removeContent } from './moderationData';
import { failureMessage, noteExpected } from './report';
import { C, radius, space, TINT } from './theme';

/** A piece of the open language's record, as something to report. */
export function recordTarget(ctx: Ctx, kind: Exclude<ReportKind, 'person'>, id: string, by: string, unitId?: string, laneId?: string): ReportTarget {
  return {
    kind, id, profileId: by, orgId: ctx.project.orgId, partitionId: ctx.project.projectId,
    ...(unitId ? { unitId } : {}), ...(laneId ? { laneId } : {})
  };
}

/** May this person take it out of the record, or act on a report about someone? The server checks again. */
export function canModerate(ctx: Ctx, t: ReportTarget): boolean {
  return t.kind === 'person' ? ctx.session.can('invite_members') : ctx.session.can('manage_structure');
}

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
      <IconBtn name="flag" label={`Report or block ${ctx.name(target.profileId)}`} onPress={() => setOpen(true)}
        size={props.size ?? 40} color={C.muted} bg={C.card} />
      {open ? <ReportSheet ctx={ctx} target={target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Step = { at: 'menu' } | { at: 'report'; of: ReportTarget } | { at: 'remove' };

/** Report the thing or its maker, block or unblock them, or (for a moderator) take it out of the record. */
export function ReportSheet(props: { ctx: Ctx; target: ReportTarget; onClose: () => void; startAt?: 'report' }) {
  const { ctx, target } = props;
  const [step, setStep] = useState<Step>(props.startAt === 'report' ? { at: 'report', of: target } : { at: 'menu' });
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = ctx.name(target.profileId);
  const blocked = ctx.blocks.has(target.profileId);
  const thing = target.kind === 'person' ? who : thingLabel(target.kind);

  async function send(of: ReportTarget) {
    if (!reason) return;
    setBusy(true);
    try {
      await queueReport(ctx.session.actorId, of, reason, details);
      if (alsoBlock && !blocked) await ctx.blocks.set(target.profileId, true);
      ctx.toast(alsoBlock ? `Reported and blocked ${who}. Thank you.` : 'Reported. Thank you. It is sent when you are connected.');
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
      ctx.toast(blocked ? `Unblocked ${who}.` : `Blocked ${who}. What they add is hidden for you.`, async () => {
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
      await removeContent(target, 'Removed by a moderator');
      ctx.toast('Removed from the record. Phones stop showing it when they next sync.');
      props.onClose();
    } catch (e) {
      // Offline or refused: the server's answer says which.
      noteExpected('remove content', e);
      ctx.toast(`Not removed: ${e instanceof Error ? e.message : 'try again when connected'}`);
    } finally {
      setBusy(false);
    }
  }

  if (step.at === 'report') {
    const of = step.of;
    const ready = !!reason && (reason !== 'other' || details.trim().length > 0);
    return (
      <Sheet visible title={of.kind === 'person' ? `Report ${who}` : `Report ${thingLabel(of.kind)}`}
        sub="What is wrong with it?" onClose={props.onClose}
        footer={<PrimaryBtn label="Send report" icon="flag" disabled={!ready || busy} busy={busy} onPress={() => void send(of)} />}>
        <Group>
          {REPORT_REASONS.map((r, i) => (
            <Row key={r.id} label={r.label} sub={r.sub} role="radio" selected={reason === r.id} last={i === REPORT_REASONS.length - 1}
              right={<View style={[styles.radio, reason === r.id && styles.radioOn]}>{reason === r.id ? <Ico name="check" size={16} color={C.white} /> : null}</View>}
              onPress={() => setReason(r.id)} />
          ))}
        </Group>
        <Field value={details} onChangeText={setDetails} placeholder={reason === 'other' ? 'What is wrong with it?' : 'Anything else? (optional)'} multiline />
        {!blocked ? (
          <Group>
            <Row icon="block" iconColor={TINT.redText} label={`Also block ${who}`} sub="Hide what they add, for you only"
              role="checkbox" checked={alsoBlock} onPress={() => setAlsoBlock((b) => !b)} last
              right={<View style={[styles.radio, styles.box, alsoBlock && styles.radioOn]}>{alsoBlock ? <Ico name="check" size={16} color={C.white} /> : null}</View>} />
          </Group>
        ) : null}
        <Text style={txt.xs}>
          Your organization's admins and the LangQuest team see the report. {who} is not told, and your organization does not see who sent it.
        </Text>
      </Sheet>
    );
  }

  if (step.at === 'remove') {
    return (
      <Sheet visible title={`Remove ${thing}?`} sub="It leaves the record for everyone in the organization." onClose={props.onClose}
        footer={(
          <>
            <PrimaryBtn label="Remove for everyone" icon="trash" tone="red" disabled={busy} busy={busy} onPress={() => void remove()} />
            <GhostBtn label="Cancel" onPress={() => setStep({ at: 'menu' })} />
          </>
        )}>
        <Text style={txt.body}>
          Use this for content that breaks the terms of use. The passage's status is worked out again without it. It needs a connection.
        </Text>
      </Sheet>
    );
  }

  return (
    <Sheet visible title="Report or block" sub={target.kind === 'person' ? who : `${thing.charAt(0).toUpperCase()}${thing.slice(1)} by ${who}`}
      onClose={props.onClose}>
      <Group>
        {target.kind !== 'person' ? (
          <Row icon="flag" iconColor={TINT.redText} label={`Report ${thing}`} sub="It is offensive, harmful or does not belong here"
            onPress={() => setStep({ at: 'report', of: target })} />
        ) : null}
        <Row icon="flag" iconColor={TINT.redText} label={`Report ${who}`} sub="For how they behave, not one thing they made"
          onPress={() => setStep({ at: 'report', of: personTarget(target) })} />
        <Row icon="block" iconColor={TINT.redText} label={blocked ? `Unblock ${who}` : `Block ${who}`}
          sub={blocked ? 'Show what they add again' : "Hide what they add, for you only. They aren't told."}
          onPress={() => void toggleBlock()} last={!(target.kind !== 'person' && canModerate(ctx, target))} />
        {target.kind !== 'person' && canModerate(ctx, target) ? (
          <Row icon="trash" iconColor={TINT.redText} label="Remove from the record" sub="For everyone. Needs a connection."
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
      if (what === 'remove') await removeContent(target, 'Removed after a report');
      else await dismissReports(target);
      ctx.toast(what === 'remove' ? 'Removed from the record. Phones stop showing it when they next sync.' : 'Kept. The report is closed.');
      props.onDone();
    } catch (e) {
      noteExpected(`report ${what}`, e);
      ctx.toast(`Not saved: ${e instanceof Error ? e.message : 'try again when connected'}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {target.kind === 'person' ? (
        <PrimaryBtn label="Open Members" icon="people" onPress={props.onOpen} />
      ) : (
        <>
          <PrimaryBtn label="Remove from the record" icon="trash" tone="red" disabled={busy} busy={busy} onPress={() => void run('remove')} />
          {target.unitId && target.laneId ? <GhostBtn label="Open the passage" onPress={props.onOpen} /> : null}
        </>
      )}
      <GhostBtn label={target.kind === 'person' ? 'Close the report' : 'Keep it'} disabled={busy} onPress={() => void run('keep')} />
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
      <Text style={[txt.sm, { flex: 1, color: C.muted }]}>Hidden because you blocked {props.ctx.name(props.by)}</Text>
      <LinkBtn label="Show" onPress={() => setShown(true)} accessibilityLabel={`Show what ${props.ctx.name(props.by)} added`} />
    </View>
  );
}

/** Someone's words in a line of text, unless this person blocked them. */
export function authoredText(ctx: Ctx, by: string | undefined, text: string): string {
  return by && by !== ctx.session.actorId && ctx.blocks.has(by) ? HIDDEN_TEXT : text;
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
