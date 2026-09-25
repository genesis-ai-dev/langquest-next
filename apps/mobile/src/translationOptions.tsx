import { usePreferences } from './accountPreferences';
// Avatar U. Optional written work stays behind a neutral secondary action.
// Inside, it is a slide run like passageSlides.tsx: one yellow action per
// slide, icons carry the meaning, secondary actions are outline.
import { createTextTranslation, isStored, textTranslationsFor, type EventSpec, type TextTranslation } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { LucideIcon } from 'lucide-react-native';
import { AudioLines, BookOpen, Check, ChevronLeft, ChevronRight, FileText, GitBranch, PenLine, Plus, Sparkles, X } from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from './ctx';
import { getReferenceSlides } from './passageResources';
import { supabase } from './supabase';
import { colors, radius, space, StyleSheet, tint } from './theme';
import { ActionButton, BackButton, Card, text as typography } from './ui';

type TranslationOptionsProps = {
  ctx: Ctx; unitId: string; laneId: string;
};

/** Source text, then the draft, then saved versions. */
type Slide = 'source' | 'draft' | 'versions';
const RUN: Slide[] = ['source', 'draft', 'versions'];
const REFERENCE_TINT = 'rgba(243,117,27,0.06)';

export function TranslationOptions(props: TranslationOptionsProps) {
  const { ctx, unitId, laneId } = props;
  const scope = JSON.stringify([ctx.project.orgId, ctx.project.projectId,
    ctx.session.actorId, unitId, laneId]);
  return <TranslationEditor key={scope} {...props} />;
}

function TranslationEditor({ ctx, unitId, laneId }: TranslationOptionsProps) {
  const { locked } = usePreferences();
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState<Slide>('source');
  const [draft, setDraft] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [origin, setOrigin] = useState<TextTranslation['origin']>('written');
  const [suggestion, setSuggestion] = useState<{ text: string; origin: 'asr' | 'ai' } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const pendingSave = useRef<{
    signature: string; id: string; events: EventSpec[];
  } | null>(null);
  const state = ctx.project.state;
  if (!state || state.obt.workspace || !ctx.session.can('translate')) return null;
  const versions = textTranslationsFor(state, unitId, laneId);
  const sources = getReferenceSlides(state, laneId, unitId);
  const passage = state.units[unitId]?.label ?? unitId;
  async function execute(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not complete this action'); }
    finally { working.current = false; setBusy(false); }
  }
  async function assist(action: 'draft' | 'transcribe', hash?: string, format?: string) {
    await execute(async () => {
      const { data, error: requestError } = await supabase.functions.invoke('translation-assist', {
        body: { action, orgId: ctx.project.orgId, projectId: ctx.project.projectId,
          unitId, laneId, sourceText, targetLanguage: state!.lanes[laneId]?.languoidId,
          ...(hash ? { hash, format } : {}) }
      });
      if (requestError) {
        const response = requestError.context;
        const details = response instanceof Response
          ? await response.json().catch(() => null) : null;
        throw new Error(typeof details?.error === 'string' ? details.error
          : 'AI assistance is unavailable. Check your connection or contact your project administrator.');
      }
      if (data?.error) throw new Error(data.error);
      if (typeof data?.text !== 'string' || !data.text.trim() || data.text.length > 50000) throw new Error('No usable text was returned.');
      setSuggestion({ text: data.text, origin: action === 'draft' ? 'ai' : 'asr' });
    });
  }
  function show() {
    setSlide(versions.length ? 'versions' : 'source');
    setError(''); setOpen(true);
  }
  function close() { if (!busy) { setSuggestion(null); setOpen(false); } }
  function go(next: Slide) { setError(''); setSlide(next); }
  function startNew() {
    setDraft(''); setSourceText(''); setParent(null);
    setOrigin('written'); setSuggestion(null);
    pendingSave.current = null; go('source');
  }
  function branch(version: TextTranslation) {
    setDraft(version.text); setParent(version.translationId);
    setSourceText(version.sourceText ?? ''); setOrigin('written');
    setSuggestion(null); pendingSave.current = null; go('draft');
  }
  function save() {
    void execute(async () => {
      const payload = { unitId, laneId, parentTranslationId: parent,
        text: draft.trim(), sourceText, origin };
      const signature = JSON.stringify(payload);
      if (pendingSave.current?.signature !== signature) {
        const id = Crypto.randomUUID();
        pendingSave.current = { id, signature, events:
          createTextTranslation(ctx.project.state!, id, {
            ...payload, translationId: id
          }) };
      }
      const pending = pendingSave.current;
      // Reuse stable event/version IDs if saving succeeded locally but
      // refreshing the UI failed. The offline outbox deduplicates retries.
      await ctx.project.run(pending.events);
      setParent(pending.id);
      pendingSave.current = null;
      go('versions');
    });
  }
  const previous = slide === 'source' ? close : () => go(RUN[RUN.indexOf(slide) - 1]!);

  let body: ReactNode;
  let footer: ReactNode;
  let background = colors.background;
  if (suggestion) {
    // Suggestions never save themselves: the translator checks each one.
    const asr = suggestion.origin === 'asr';
    background = asr ? REFERENCE_TINT : tint.translate;
    body = <>
      <SlideIcon icon={asr ? AudioLines : Sparkles} color={asr ? colors.reference : colors.translate} label={asr ? 'Transcription to check' : 'AI draft to check'} />
      <Card><Text style={typography.body}>{suggestion.text}</Text></Card>
    </>;
    footer = <>
      <Square icon={X} label="Discard suggestion" disabled={busy} onPress={() => setSuggestion(null)} />
      {asr ? <Square icon={PenLine} label="Use transcription as translation draft" disabled={busy} onPress={() => {
        setDraft(suggestion.text); setOrigin('asr'); setSuggestion(null); go('draft');
      }} /> : null}
      <ActionButton icon={Check} accessibilityLabel={asr ? 'Use as source text' : 'Use as translation draft'} style={styles.primary} disabled={busy} onPress={() => {
        if (asr) setSourceText(suggestion.text);
        else { setDraft(suggestion.text); setOrigin('ai'); }
        setSuggestion(null);
      }} />
    </>;
  } else if (slide === 'source') {
    background = REFERENCE_TINT;
    body = <>
      <SlideIcon icon={BookOpen} color={colors.reference} label="Source text" />
      <TextInput style={styles.input} multiline accessibilityLabel="Source text" value={sourceText} onChangeText={setSourceText} editable={!busy} maxLength={50000} />
      {sources.length ? <View style={styles.row}>
        {sources.map((source, i) => {
          const stored = isStored(state, source.hash);
          return <ActionButton key={source.id} icon={AudioLines} variant="outline"
            label={sources.length > 1 ? String(i + 1) : undefined}
            accessibilityLabel={`Transcribe ${source.label} ${i + 1}${stored ? '' : ', waiting for sync'}`}
            disabled={busy || !stored} onPress={() => void assist('transcribe', source.hash, source.format)} />;
        })}
      </View> : null}
      {sources.length ? <Text style={typography.small}>Transcription sends audio to the project's AI provider.</Text> : null}
    </>;
    footer = <>
      <Square icon={ChevronLeft} label="Close written translation" disabled={busy} onPress={previous} />
      <ActionButton icon={ChevronRight} accessibilityLabel="Next: write the translation" style={styles.primary} disabled={busy} onPress={() => go('draft')} />
    </>;
  } else if (slide === 'draft') {
    background = tint.translate;
    body = <>
      <SlideIcon icon={parent ? GitBranch : PenLine} color={colors.translate} label={parent ? 'Editing a child version; the original stays available' : 'New translation'} />
      <TextInput style={styles.input} multiline accessibilityLabel="Translation text" value={draft} onChangeText={setDraft} editable={!busy} maxLength={50000} />
      {sourceText.trim() ? <Text style={typography.small}>AI drafts send the source text to the project's AI provider.</Text> : null}
    </>;
    footer = <>
      <Square icon={ChevronLeft} label="Previous: source text" disabled={busy} onPress={previous} />
      <Square icon={Sparkles} label="Request AI draft suggestion" disabled={busy || !sourceText.trim()} onPress={() => void assist('draft')} />
      <ActionButton icon={Check} accessibilityLabel="Save draft version" style={styles.primary} disabled={busy || !draft.trim()} onPress={save} />
    </>;
  } else {
    background = tint.done;
    body = <>
      <SlideIcon icon={FileText} color={colors.done} label="Saved translation versions" />
      {versions.map(version => <Card key={version.value.translationId}>
        <View style={styles.versionHead}>
          {version.value.parentTranslationId ? <GitBranch size={18} color={colors.mutedForeground} /> : <FileText size={18} color={colors.mutedForeground} />}
          <Text style={[typography.small, { flex: 1 }]}>{version.value.origin}</Text>
          <Square icon={GitBranch} label="Edit as a child translation" disabled={busy} onPress={() => branch(version.value)} />
        </View>
        <Text style={typography.body}>{version.value.text}</Text>
      </Card>)}
    </>;
    footer = <>
      <Square icon={Plus} label="Start a new independent translation" disabled={busy} onPress={startNew} />
      <ActionButton icon={Check} accessibilityLabel="Done with written translation" style={styles.primary} disabled={busy} onPress={close} />
    </>;
  }

  return <>
    <ActionButton icon={FileText} variant="outline" accessibilityLabel="Optional text translation, transcription and AI drafts" onPress={show} />
    <Modal visible={open && !locked} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackButton onPress={close} />
          {suggestion ? null : <View style={styles.beads} accessibilityLabel={`Step ${RUN.indexOf(slide) + 1} of ${RUN.length}`}>
            {RUN.map((s, i) => <View key={s} style={[styles.bead, i < RUN.indexOf(slide) && styles.beadPast, s === slide && styles.beadCurrent]} />)}
          </View>}
          <Text style={styles.reference}>{passage}</Text>
          {body}
          {busy ? <ActivityIndicator color={colors.foreground} /> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>{footer}</View>
      </SafeAreaView>
    </Modal>
  </>;
}

function SlideIcon({ icon: Icon, color, label }: { icon: LucideIcon; color: string; label: string }) {
  return <View accessible accessibilityLabel={label} style={styles.icon}><Icon size={34} color={color} /></View>;
}

/** Outline secondary action, sized to sit beside the yellow primary. */
function Square({ icon: Icon, label, onPress, disabled }: {
  icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
    accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    style={[styles.outline, disabled && styles.disabled]}>
    <Icon size={25} color={disabled ? colors.mutedForeground : colors.foreground} />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: space.lg, padding: space.lg },
  footer: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card },
  primary: { flex: 1 },
  outline: { width: 56, height: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  disabled: { borderStyle: 'dashed', backgroundColor: colors.muted },
  beads: { flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 8 },
  bead: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  beadPast: { backgroundColor: colors.done },
  beadCurrent: { width: 20, borderRadius: 3, backgroundColor: colors.foreground },
  reference: { textAlign: 'center', fontSize: 23, fontWeight: '700', color: colors.foreground },
  icon: { alignItems: 'center' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.md, color: colors.foreground, backgroundColor: colors.card, minHeight: 160, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  versionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  error: { color: colors.danger, textAlign: 'center' }
});
