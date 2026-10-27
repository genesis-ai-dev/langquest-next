// The alert for files this device deleted behind the app's back
// (decisions.md 92). Phones sold with fake storage sizes throw files away
// once the real space runs out, and nobody learns of it until a recording
// is needed. The file store notices (blobs.ts); this says so where nobody
// can miss it: over every screen, until someone taps "I understand". It
// says what can come back and which passages need recording again.
import type { LostFile } from '@langquest-next/sync';
import type { LanguageState, LostFilesView } from '@langquest-next/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { getBlobStore, type BlobStore } from './blobs';
import { registerDeviceProbe } from '../diagnostics/diagnostics';
import { HelpHost } from '../helpMode/helpBadge';
import { Ico, PrimaryBtn, type IconName } from '../ui/kit';
import { useHelpHost } from '../helpMode/useHelpMode';
import { txt } from '../ui/textStyles';
import { t } from '../i18n';
import { Text } from '../ui/text';
import { ModalCover } from '../ui/ModalCover';
import { C, onColor, radius, space, TINT, type as T, withAlpha } from '../ui/theme';
import { lostFilesWords, type LostFilesWords } from './lostFilesWords';

/** Files lost that nobody has seen the alert for, kept current as the store finds more. */
function useLostFiles(): { lost: LostFile[]; store: BlobStore | null } {
  const [lost, setLost] = useState<LostFile[]>([]);
  const [store, setStore] = useState<BlobStore | null>(null);
  useEffect(() => {
    let active = true;
    let off = () => {};
    void getBlobStore().then((s) => {
      if (!active) return;
      setStore(s);
      const load = () => { void s.lostFiles().then((l) => { if (active) setLost(l); }).catch(() => undefined); };
      off = s.onLost(load);
      load();
    }).catch(() => undefined);
    return () => { active = false; off(); };
  }, []);
  return { lost, store };
}

/**
 * Drawn once, above the app. Waits for the open language, which says what
 * each lost file was; with no language open every file is simply counted.
 */
export function LostFilesAlert(props: { state: LanguageState | null; whatWere: (hashes: readonly string[]) => Promise<LostFilesView> }) {
  const { lost, store } = useLostFiles();
  const { state, whatWere } = props;
  // What the files were comes from the phone's table for a language kept on disk (decisions.md 143).
  const [view, setView] = useState<LostFilesView | null>(null);
  useEffect(() => {
    let active = true;
    if (!state || lost.length === 0) { setView(null); return; }
    void whatWere(lost.map((l) => l.hash)).then((v) => { if (active) setView(v); }).catch(() => undefined);
    return () => { active = false; };
  }, [state, lost, whatWere]);
  // One walk of the language's files per change, not per render.
  const words = useMemo(() => (state && view && lost.length ? lostFilesWords(state, lost, view) : null), [state, lost, view]);
  // Field diagnostics read the counts at each delivery (the `device` record): files lost that
  // nobody has seen the alert for, and of them the open language's recordings that never
  // reached the server. Phones only, like the ledger (decisions.md 92).
  const counts = useRef({ lostFiles: 0, lostRecordings: undefined as number | undefined });
  counts.current = { lostFiles: lost.length, lostRecordings: words ? words.unsent : state ? 0 : undefined };
  useEffect(() => (Platform.OS === 'web' ? undefined : registerDeviceProbe('lostFiles', () => counts.current)), []);
  if (!store || !words) return null;
  const seen = () => { void store.lostSeen(lost.map((l) => l.hash)); };
  return <LostFilesCard words={words} onSeen={seen} />;
}

/**
 * The alert itself. Back does not close it: only the button does. It is a
 * help host of its own, as a sheet is (kit's Sheet): help on the screen under
 * it turns off while it shows, so "I understand" is never taken for a tap
 * that explains it behind the alert.
 */
export function LostFilesCard(props: { words: LostFilesWords; onSeen: () => void }) {
  const w = props.words;
  const host = useHelpHost(true);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <HelpHost id={host}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.badge} accessible={false}>
              <Ico name="phone" size={48} color={C.white} strokeWidth={2.2} />
              <View style={styles.bang}><Ico name="warning" size={22} color={onColor.red} strokeWidth={2.6} /></View>
            </View>
            <Text style={styles.title} accessibilityRole="header">{t('lostFiles.title')}</Text>
            <Text style={[txt.body, styles.center, styles.deleted]}>{t('lostFiles.deleted', { count: w.total })}</Text>
            {w.unsent ? (
              <Part icon="mic" fg={TINT.redText} bg={TINT.red} title={t('lostFiles.unsent', { count: w.unsent })}>
                {w.passages.length ? <Text style={txt.sm}>{t('lostFiles.recordAgain')}</Text> : null}
                {w.passages.map((p) => <Text key={p} style={[txt.sm, styles.passage]}>{t('lostFiles.passage', { passage: p })}</Text>)}
                {w.morePassages ? <Text style={txt.sm}>{t('lostFiles.morePassages', { count: w.morePassages })}</Text> : null}
              </Part>
            ) : null}
            {w.safe ? <Part icon="onPhone" fg={TINT.greenText} bg={TINT.green} title={t('lostFiles.safe', { count: w.safe })} /> : null}
            <Part icon="cloud" fg={TINT.amberText} bg={TINT.amber} title={t('lostFiles.goOnline')}>
              <Text style={txt.sm}>{t('lostFiles.lessSpace')}</Text>
            </Part>
          </ScrollView>
          <View style={styles.foot}>
            <PrimaryBtn label={t('lostFiles.understand')} help={t('lostFiles.understandHelp')} onPress={props.onSeen} tone="red" />
          </View>
        </View>
      </View>
      </HelpHost>
      <ModalCover />
    </Modal>
  );
}

function Part(props: { icon: IconName; fg: string; bg: string; title: string; children?: ReactNode }) {
  return (
    <View style={[styles.part, { backgroundColor: props.bg }]} accessible>
      <Ico name={props.icon} size={26} color={props.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[txt.body, { fontWeight: '700', color: props.fg }]}>{props.title}</Text>
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: withAlpha(C.dark, 0.72), justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: C.card, borderRadius: radius.sheet, maxHeight: '100%', width: '100%', maxWidth: 460, alignSelf: 'center',
    borderTopWidth: 8, borderTopColor: C.red, overflow: 'hidden' },
  body: { padding: space.xl, gap: space.md },
  badge: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  bang: { position: 'absolute', right: -2, bottom: -2, width: 40, height: 40, borderRadius: 20, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.red },
  title: { fontSize: T.xxl, fontWeight: '800', color: onColor.red, textAlign: 'center' },
  center: { textAlign: 'center' },
  deleted: { fontWeight: '600' },
  part: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.lg },
  passage: { fontWeight: '700' },
  foot: { paddingHorizontal: space.xl, paddingBottom: space.xl, paddingTop: space.sm }
});
