// The admin's simple building blocks (decision 71, demo ADR-039; the
// prototype's simple/admin.tsx and simple/onboarding.tsx): a big title for a
// language's page, the four-question checklist, big radio cards with
// examples under them, numbered steps, radio rows, a checkbox row with a
// play button, a lock toggle, and the invite code. Built from kit
// primitives and theme tokens; every pressable goes through `useHelpPress`
// so help mode explains it instead of pressing it.
import { FileText, Play, Route } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import QRCode from 'react-native-qrcode-svg';
import { scopeKey, type Scope } from '@langquest-next/core';
import { APP_URL } from '../appUrl';
import { useHelpMode, useHelpPress } from '../helpContext';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { inviteUri, issueInvite } from '../invites';
import { Ico, txt, type IconName } from '../kit';
import { noteExpected } from '../report';
import { shadow } from '../shadow';
import { C, radius, space, target, TINT, type as T } from '../theme';

// ---- icons ----------------------------------------------------------------------------

/** The kit's icons, plus the two the admin pages draw that the kit does not have. */
export type AdminIcon = IconName | 'file' | 'route' | 'playSolid';

export function Glyph(props: { name: AdminIcon; size?: number; color?: string; strokeWidth?: number }) {
  const size = props.size ?? 22;
  const color = props.color ?? C.primary;
  const strokeWidth = props.strokeWidth ?? 2.2;
  if (props.name === 'file') return <FileText size={size} color={color} strokeWidth={strokeWidth} />;
  if (props.name === 'route') return <Route size={size} color={color} strokeWidth={strokeWidth} />;
  if (props.name === 'playSolid') return <Play size={size} color={color} fill={color} strokeWidth={strokeWidth} />;
  return <Ico name={props.name} size={size} color={color} strokeWidth={strokeWidth} />;
}

/** An icon on a soft tile, as rows and cards lead with. */
export function IconTile(props: { icon: AdminIcon; size?: number; bg?: string; color?: string }) {
  const size = props.size ?? 44;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size >= 44 ? 14 : 12 }, props.bg ? { backgroundColor: props.bg } : null]}>
      <Glyph name={props.icon} size={Math.round(size * 0.5)} color={props.color ?? C.primary} />
    </View>
  );
}

// ---- the top of a language's page --------------------------------------------------------

/** The round ? (help mode), as the kit's header draws it. */
export function HelpButton() {
  const help = useHelpMode();
  if (!help) return <View style={{ width: target.min }} />;
  return (
    <Pressable onPress={() => help.setOn(!help.on)} accessibilityRole="button" accessibilityLabel={help.on ? t('admin.help.turnOff') : t('admin.help.turnOn')}
      accessibilityState={{ selected: help.on }}
      style={({ pressed }) => [styles.round, help.on && { backgroundColor: C.primary, borderColor: C.primary }, pressed && styles.pressed]}>
      <Ico name="help" size={24} color={help.on ? C.white : C.primary} />
    </Pressable>
  );
}

/**
 * A page led by a big title (a language's page, Get ready): Back and ? as
 * round buttons above it when it was opened from somewhere, only ? at a
 * tab's root. While help is on, the kit's header says so; here the ? is lit.
 */
export function BigTop(props: { onBack?: () => void; over?: string; title: string; status?: string; statusTone?: 'green' | 'amber' | 'muted' }) {
  const help = useHelpMode();
  const tone = props.statusTone === 'green' ? TINT.greenText : props.statusTone === 'amber' ? TINT.amberText : C.muted;
  return (
    <View>
      {help?.on ? (
        <View style={styles.helpBanner} accessibilityLiveRegion="polite">
          <Text style={[txt.sm, { flex: 1, color: C.white, fontWeight: '700' }]}>{t('admin.help.isOn')}</Text>
          <Pressable onPress={() => help.setOn(false)} accessibilityRole="button" style={({ pressed }) => [styles.helpDone, pressed && styles.pressed]}>
            <Text style={[txt.sm, { color: C.primary, fontWeight: '800' }]}>{t('common.done')}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bigTop}>
        <View style={styles.bigTopBar}>
          {props.onBack ? (
            <Pressable onPress={props.onBack} accessibilityRole="button" accessibilityLabel={t('common.back')} style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
              <Ico name="arrowL" size={24} color={C.dark} />
            </Pressable>
          ) : <View />}
          <HelpButton />
        </View>
        {props.over ? <Text style={styles.over}>{props.over}</Text> : null}
        <Text style={styles.bigTitle} accessibilityRole="header">{props.title}</Text>
        {props.status ? <Text style={[styles.status, { color: tone }]}>{props.status}</Text> : null}
      </View>
    </View>
  );
}

/** The one question a step screen asks, big. */
export function Question(props: { children: ReactNode }) {
  return <Text style={styles.question} accessibilityRole="header">{props.children}</Text>;
}

// ---- the checklist ------------------------------------------------------------------------

/** One of the four questions: done (green tick), now (lit, brand border), or later (muted). */
export function ChecklistRow(props: { state: 'done' | 'now' | 'later'; icon: AdminIcon; label: string; sub?: string; onPress?: () => void }) {
  const { state } = props;
  const onPress = useHelpPress(props.label, props.sub ?? (state === 'done' ? t('admin.checklist.answered') : t('admin.checklist.answerIt')), props.onPress);
  return (
    <Pressable onPress={onPress} disabled={!props.onPress} accessibilityRole="button"
      accessibilityLabel={state === 'done' ? t('admin.checklist.doneLabel', { label: props.label }) : props.label}
      accessibilityState={{ disabled: !props.onPress, selected: state === 'now' }}
      style={({ pressed }) => [styles.checkRow, state === 'now' && styles.checkRowNow, pressed && styles.pressed]}>
      <View style={[styles.checkCircle, state === 'done' ? { backgroundColor: C.green } : state === 'now' ? { backgroundColor: C.primary } : { backgroundColor: C.light }]}>
        {state === 'done' ? <Ico name="check" size={24} color={C.white} strokeWidth={3} />
          : <Glyph name={props.icon} size={22} color={state === 'now' ? C.white : C.muted} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.checkLabel, state === 'later' && { color: C.muted }]}>{props.label}</Text>
        {props.sub && state === 'done' ? <Text style={[txt.sm, { color: C.muted }]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      {state !== 'later' ? <Ico name="right" size={22} color={C.muted} /> : null}
    </Pressable>
  );
}

/** A quiet centred link with a small icon ("▶ How this works · 0:40"). */
export function QuietLink(props: { icon: AdminIcon; label: string; onPress: () => void; detail?: string }) {
  const onPress = useHelpPress(props.label, props.detail, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.quietLink, pressed && styles.pressed]}>
      <Glyph name={props.icon} size={16} color={C.muted} />
      <Text style={[txt.sm, { color: C.muted, fontWeight: '700' }]}>{props.label}</Text>
    </Pressable>
  );
}

// ---- choices ------------------------------------------------------------------------------

function Radio(props: { on: boolean; size?: number }) {
  const size = props.size ?? 26;
  return (
    <View style={[styles.radio, { width: size, height: size, borderRadius: size / 2 }, props.on && { borderColor: C.primary }]}>
      {props.on ? <View style={{ width: size * 0.46, height: size * 0.46, borderRadius: size, backgroundColor: C.primary }} /> : null}
    </View>
  );
}

/** A big radio card: icon, title, a line under it, and, when given, examples or steps below. */
export function ChoiceCard(props: { on: boolean; icon: AdminIcon; title: string; sub?: string; onPress: () => void; children?: ReactNode; chevron?: boolean }) {
  const onPress = useHelpPress(props.title, props.sub, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole={props.chevron ? 'button' : 'radio'} accessibilityState={props.chevron ? undefined : { selected: props.on }}
      accessibilityLabel={`${props.title}${props.sub ? `. ${props.sub}` : ''}`}
      style={({ pressed }) => [styles.choice, props.on && styles.choiceOn, pressed && styles.pressed]}>
      <View style={styles.choiceHead}>
        <IconTile icon={props.icon} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.choiceTitle}>{props.title}</Text>
          {props.sub ? <Text style={[txt.xs, { fontSize: 14, color: C.muted, marginTop: 1 }]}>{props.sub}</Text> : null}
        </View>
        {props.chevron ? <Ico name="right" size={22} color={C.muted} /> : <Radio on={props.on} />}
      </View>
      {props.children}
    </Pressable>
  );
}

/** What a choice would give, a few lines under its title. */
export function Examples(props: { rows: string[] }) {
  if (props.rows.length === 0) return null;
  return (
    <View style={styles.indent}>
      {props.rows.map((r) => <Text key={r} style={styles.example} numberOfLines={1}>{r}</Text>)}
    </View>
  );
}

/** Numbered steps under a choice; a lock marks one that must pass. */
export function NumberedSteps(props: { items: { label: string; lock?: boolean }[] }) {
  return (
    <View style={[styles.indent, { gap: 2 }]}>
      {props.items.map((s, i) => (
        <View key={`${s.label}-${i}`} style={styles.numbered}>
          <View style={styles.num}><Text style={styles.numText}>{formatNumber(i + 1)}</Text></View>
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.dark }}>{s.label}</Text>
          {s.lock ? <Ico name="lock" size={15} color={C.muted} /> : null}
        </View>
      ))}
    </View>
  );
}

/** A radio row ("Translate"), with the icon on a tile (inviting) or bare (letting someone in). */
export function RadioRow(props: { icon: AdminIcon; label: string; sub?: string; on: boolean; onPress: () => void; tile?: boolean }) {
  const onPress = useHelpPress(props.label, props.sub, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: props.on }} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.radioRow, props.tile && styles.radioRowTall, props.on && styles.choiceOn, pressed && styles.pressed]}>
      {props.tile ? <IconTile icon={props.icon} size={44} /> : <Glyph name={props.icon} size={24} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.radioLabel, props.tile && { fontWeight: '800' }]}>{props.label}</Text>
        {props.sub ? <Text style={[txt.xs]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      <Radio on={props.on} size={26} />
    </Pressable>
  );
}

/** A dashed action ("Add a step", "Something else: make a new role"). */
export function DashedRow(props: { icon: AdminIcon; label: string; onPress: () => void; detail?: string; centred?: boolean }) {
  const onPress = useHelpPress(props.label, props.detail, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.dashed, props.centred && { justifyContent: 'center' }, pressed && styles.pressed]}>
      <Glyph name={props.icon} size={20} />
      <Text style={[txt.body, { color: C.primary, fontWeight: '700' }]}>{props.label}</Text>
    </Pressable>
  );
}

/** Pills that wrap onto more lines (the testament pills, the invite chips). */
export function Pills(props: { children: ReactNode }) {
  return <View style={styles.pills}>{props.children}</View>;
}

/** A pick-many row with a checkbox, and a play button that opens what it is. */
export function CheckRow(props: { label: string; sub?: string; checked: boolean; onToggle: () => void; onPlay?: () => void; playLabel?: string; last?: boolean; disabled?: boolean; detail?: string }) {
  const onToggle = useHelpPress(props.label, props.detail ?? (props.checked ? t('admin.checkRow.offered') : t('admin.checkRow.notOffered')), props.onToggle);
  const playLabel = props.playLabel ?? t('admin.checkRow.hear', { name: props.label });
  const onPlay = useHelpPress(playLabel, undefined, props.onPlay);
  return (
    <View style={[styles.checkLine, !props.last && styles.rowBorder]}>
      <Pressable onPress={onToggle} disabled={props.disabled} accessibilityRole="checkbox" accessibilityState={{ checked: props.checked, disabled: !!props.disabled }}
        accessibilityLabel={props.label} style={({ pressed }) => [styles.checkTap, pressed && styles.pressed]}>
        <View style={[styles.box, props.checked && { backgroundColor: C.primary, borderColor: C.primary }]}>
          {props.checked ? <Ico name="check" size={20} color={C.white} strokeWidth={3} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700' }]} numberOfLines={2}>{props.label}</Text>
          {props.sub ? <Text style={[txt.sm, { color: C.muted }]}>{props.sub}</Text> : null}
        </View>
      </Pressable>
      {props.onPlay ? (
        <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={playLabel} hitSlop={4}
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
          <Ico name="play" size={22} color={C.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A switch as the design draws it: a brand pill with a white knob, the same on the web as on a device. */
export function Pill(props: { on: boolean; disabled?: boolean }) {
  return (
    <View style={[styles.pill, props.on ? { backgroundColor: C.primary } : { backgroundColor: C.faint }, props.disabled && { opacity: 0.5 }]}>
      <View style={[styles.knob, props.on ? { right: 3 } : { left: 3 }]} />
    </View>
  );
}

/** A row that is one switch: the whole row takes the tap (a 64pt target) and speaks as the switch. */
export function SwitchRow(props: { label: string; sub?: string; on: boolean; onToggle: () => void; disabled?: boolean; last?: boolean; icon?: AdminIcon }) {
  const onPress = useHelpPress(props.label, props.on ? t('admin.switchRow.on') : t('admin.switchRow.off'), props.onToggle);
  return (
    <Pressable onPress={onPress} disabled={props.disabled} accessibilityRole="switch" accessibilityState={{ checked: props.on, disabled: !!props.disabled }}
      accessibilityLabel={props.label} style={({ pressed }) => [styles.switchRow, !props.last && styles.rowBorder, pressed && styles.pressed]}>
      {props.icon ? <IconTile icon={props.icon} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '700' }]}>{props.label}</Text>
        {props.sub ? <Text style={[txt.sm, { fontSize: 14, color: C.muted }]}>{props.sub}</Text> : null}
      </View>
      <Pill on={props.on} disabled={props.disabled} />
    </Pressable>
  );
}

/** A count on a solid amber disc (join requests waiting). */
export function CountBadge(props: { n: number }) {
  return (
    <View style={styles.count} accessibilityLabel={t('admin.waiting', { count: props.n })}>
      <Text style={[txt.xsStrong, { color: C.white }]}>{formatNumber(props.n)}</Text>
    </View>
  );
}

/** Must this step pass before the next ones? A round lock, dashed when not. */
export function LockToggle(props: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  const onPress = useHelpPress(props.label, props.on ? t('admin.lock.on') : t('admin.lock.off'), props.onToggle);
  return (
    <Pressable onPress={onPress} disabled={props.disabled} accessibilityRole="switch" accessibilityState={{ checked: props.on, disabled: !!props.disabled }}
      accessibilityLabel={props.label} hitSlop={4}
      style={({ pressed }) => [styles.lock, props.on ? styles.lockOn : null, pressed && styles.pressed]}>
      <Ico name="lock" size={20} color={props.on ? TINT.amberText : C.faint} />
    </Pressable>
  );
}

/** A note in amber ("We'll offer the World English Bible …"). */
export function AmberNote(props: { icon: AdminIcon; children: ReactNode }) {
  return (
    <View style={styles.note}>
      <Glyph name={props.icon} size={22} color={TINT.amberText} />
      <Text style={[txt.sm, { flex: 1, color: C.dark }]}>{props.children}</Text>
    </View>
  );
}

// ---- the invite code ------------------------------------------------------------------------

/** How many people a group code admits (the server allows up to 50). */
export const GROUP_USES = 30;

type InviteState = { uri: string } | { error: string } | null;

/**
 * Why the server made no invite code, in the language showing. Its own
 * words are a developer's English (the invite RPCs' `raise exception`), so
 * only a refusal is told apart; anything else reads as a connection to try
 * again on.
 */
export function inviteFailureText(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  if (/not allowed|may only invite/i.test(message)) return t('admin.inviteCode.notAllowed');
  return t('common.tryWhenConnected');
}

/**
 * A group code for one role at one scope, issued when first shown (the same
 * RPC as Invite by QR) and kept while the screen is up, so switching back to
 * a role shows the code already made. Offline, it says so.
 */
export function useGroupInvite(orgId: string, roleId: string | null, scope: Scope | null, label: string): InviteState {
  const [made, setMade] = useState<Record<string, InviteState>>({});
  const key = roleId && scope ? `${roleId}|${scopeKey(scope)}` : '';
  useEffect(() => {
    if (!key || !roleId || !scope || made[key]) return;
    let live = true;
    void issueInvite(orgId, roleId, scope, { label, maxUses: GROUP_USES })
      .then((inv) => { if (live) setMade((m) => ({ ...m, [key]: { uri: inviteUri(orgId, inv.token, APP_URL) } })); })
      .catch((e: unknown) => {
        // Offline or refused by the server: its words say which.
        noteExpected('issue group invite', e);
        if (live) setMade((m) => ({ ...m, [key]: { error: inviteFailureText(e) } }));
      });
    return () => { live = false; };
    // `made` is read to skip a code already made; it must not re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, orgId, label]);
  return key ? made[key] ?? null : null;
}

/** The code to scan, with what to tell people. */
export function InviteCode(props: { state: InviteState }) {
  const s = props.state;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={styles.qr}>
        {s && 'uri' in s ? <QRCode value={s.uri} size={196} backgroundColor={C.white} color={C.dark} />
          : <Text style={[txt.smMuted, { textAlign: 'center' }]}>{s && 'error' in s ? t('admin.inviteCode.notMade') : t('admin.inviteCode.making')}</Text>}
      </View>
      <Text style={[txt.body, { fontWeight: '700' }]}>{t('admin.inviteCode.askToScan')}</Text>
      <Text style={[txt.sm, { color: C.muted, textAlign: 'center' }]}>
        {s && 'error' in s ? s.error : t('admin.inviteCode.noPassword')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  tile: { backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  round: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  helpBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: C.primary, paddingHorizontal: space.lg, paddingVertical: space.sm },
  helpDone: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: C.white, justifyContent: 'center' },
  bigTop: { paddingHorizontal: space.xl - 4, paddingTop: space.md, paddingBottom: space.xs, backgroundColor: C.bg },
  bigTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  over: { fontSize: 14, fontWeight: '700', color: C.muted },
  bigTitle: { fontSize: 28, fontWeight: '800', color: C.dark, marginTop: 2 },
  status: { fontSize: T.sm, fontWeight: '700', marginTop: 2 },
  question: { fontSize: 24, fontWeight: '800', color: C.dark, lineHeight: 31, paddingHorizontal: space.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, paddingLeft: 14, paddingRight: 10, paddingVertical: 10, borderRadius: radius.xl, borderWidth: 2, borderColor: C.border, backgroundColor: C.card },
  checkRowNow: { borderColor: C.primary },
  checkCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { fontSize: T.base, fontWeight: '800', color: C.dark },
  quietLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: target.min, alignSelf: 'center', paddingHorizontal: space.md },
  radio: { borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  choice: { padding: 14, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.border, gap: 10 },
  choiceOn: { borderColor: C.primary },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  choiceTitle: { fontSize: T.base, fontWeight: '800', color: C.dark, lineHeight: 25 },
  indent: { paddingLeft: 52, gap: 6 },
  example: { fontSize: T.xs, color: C.muted, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: C.bg, overflow: 'hidden' },
  numbered: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 30 },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, fontWeight: '800', color: C.primary },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: 16, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: C.card, borderWidth: 2, borderColor: C.border },
  radioRowTall: { minHeight: 66, borderRadius: radius.xl, paddingHorizontal: 16 },
  radioLabel: { fontSize: T.base, fontWeight: '700', color: C.dark },
  dashed: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  checkLine: { flexDirection: 'row', alignItems: 'center', minHeight: target.row, paddingRight: space.sm, backgroundColor: C.card },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  checkTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingLeft: space.lg, paddingVertical: space.sm },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: C.faint, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  play: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 50, height: 30, borderRadius: 15, justifyContent: 'center' },
  knob: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card },
  count: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: TINT.amberText, alignItems: 'center', justifyContent: 'center' },
  lock: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  lockOn: { borderWidth: 0, backgroundColor: TINT.amber },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: TINT.amber },
  qr: { width: 232, height: 232, borderRadius: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', padding: space.lg, ...shadow }
});
