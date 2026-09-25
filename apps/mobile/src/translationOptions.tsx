import { usePreferences } from './accountPreferences';
// Avatar U. Optional written work stays behind a neutral secondary action.
import { createTextTranslation, isStored, textTranslationsFor, type EventSpec, type TextTranslation } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { FileText, Plus, Save, Sparkles, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Ctx } from './ctx';
import { getReferenceSlides } from './passageResources';
import { supabase } from './supabase';
import { colors, space } from './theme';
import { ActionButton, Card, text as typography } from './ui';

type TranslationOptionsProps = {
  ctx: Ctx; unitId: string; laneId: string;
};

export function TranslationOptions(props: TranslationOptionsProps) {
  const { ctx, unitId, laneId } = props;
  const scope = JSON.stringify([ctx.project.orgId, ctx.project.projectId,
    ctx.session.actorId, unitId, laneId]);
  return <TranslationEditor key={scope} {...props} />;
}

function TranslationEditor({ ctx, unitId, laneId }: TranslationOptionsProps) {
  const { locked } = usePreferences();
  const [open, setOpen] = useState(false);
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
  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: space.md, color: colors.foreground, minHeight: 100 };
  return <>
    <ActionButton icon={FileText} variant="outline" accessibilityLabel="Optional text translation, transcription and AI drafts" onPress={() => setOpen(true)} />
    <Modal visible={open && !locked} animationType="slide" onRequestClose={() => { if (!busy) setOpen(false); }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
          <ActionButton icon={X} variant="outline" accessibilityLabel="Close written translation" disabled={busy} onPress={() => setOpen(false)} />
          <Text style={typography.h3}>Written translation</Text>
          <Text style={typography.small}>Optional working drafts. Your recorded take still follows the project review process.</Text>
          <TextInput style={input} multiline accessibilityLabel="Source text" placeholder="Source text for a draft suggestion" placeholderTextColor={colors.mutedForeground} value={sourceText} onChangeText={setSourceText} editable={!busy} maxLength={50000} />
          <Text style={typography.small}>AI actions send the selected source to the configured AI provider. Check the result before saving.</Text>
          <ActionButton icon={Sparkles} variant="outline" label="Suggest a draft" accessibilityLabel="Request AI draft suggestion" disabled={busy || !sourceText.trim()} onPress={() => void assist('draft')} />
          {sources.map((source, i) => <ActionButton key={source.id} icon={FileText} variant="outline" label={`Transcribe ${source.label} ${i + 1}${isStored(state, source.hash) ? '' : ' · waiting for sync'}`} accessibilityLabel={`Transcribe ${source.label} ${i + 1}${isStored(state, source.hash) ? '' : ', waiting for sync'}`} disabled={busy || !isStored(state, source.hash)} onPress={() => void assist('transcribe', source.hash, source.format)} />)}
          {!sources.length ? <Text style={typography.small}>Attach source audio to transcribe it. Audio must finish syncing before transcription.</Text> : null}
          {suggestion ? <Card>
            <Text style={typography.small}>Review suggestion</Text>
            <Text style={typography.body}>{suggestion.text}</Text>
            <ActionButton icon={FileText} variant="outline" label="Use as source text" accessibilityLabel="Use suggestion as source text" disabled={busy} onPress={() => { setSourceText(suggestion.text); setSuggestion(null); }} />
            <ActionButton icon={FileText} variant="outline" label="Use as draft" accessibilityLabel="Use suggestion as draft" disabled={busy} onPress={() => { setDraft(suggestion.text); setOrigin(suggestion.origin); setSuggestion(null); }} />
            <ActionButton icon={X} variant="outline" label="Discard suggestion" accessibilityLabel="Discard AI suggestion" disabled={busy} onPress={() => setSuggestion(null)} />
          </Card> : null}
          <Text style={typography.small}>{parent ? 'Editing a child version; the original stays available.' : 'New translation'}</Text>
          <TextInput style={input} multiline accessibilityLabel="Translation text" value={draft} onChangeText={setDraft} editable={!busy} maxLength={50000} />
          <ActionButton icon={Save} label="Save draft version" accessibilityLabel="Save draft version" disabled={busy || !draft.trim()} onPress={() => void execute(async () => {
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
          })} />
          <ActionButton icon={Plus} variant="outline" label="Start a new translation"
            accessibilityLabel="Start a new independent translation" disabled={busy}
            onPress={() => {
              setDraft(''); setSourceText(''); setParent(null);
              setOrigin('written'); setSuggestion(null); setError('');
              pendingSave.current = null;
            }} />
          {error ? <Text accessibilityRole="alert" style={typography.muted}>{error}</Text> : null}
          {versions.map(version => <Card key={version.value.translationId}>
            <Text style={typography.small}>{version.value.origin} · {version.value.parentTranslationId ? 'Child version' : 'Original version'}</Text>
            <Text style={typography.body}>{version.value.text}</Text>
            <ActionButton icon={FileText} variant="outline" label="Create child translation" accessibilityLabel="Edit as a child translation" disabled={busy} onPress={() => {
              setDraft(version.value.text); setParent(version.value.translationId);
              setSourceText(version.value.sourceText ?? ''); setOrigin('written');
              setSuggestion(null); setError(''); pendingSave.current = null;
            }} />
          </Card>)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
