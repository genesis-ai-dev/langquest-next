// The alert for files this device deleted behind the app's back
// (decisions.md 92). Phones sold with fake storage sizes throw files away
// once the real space runs out, and nobody learns of it until a recording
// is needed. The file store notices (blobs.ts); this says so where nobody
// can miss it: over every screen, until someone taps "I understand". It
// says what can come back and which passages need recording again.
import type { LostFile } from '@langquest-next/sync';
import { lostFilesView, unitTitle, type LanguageState } from '@langquest-next/core';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { getBlobStore, type BlobStore } from './blobs';
import { HelpHost } from './helpBadge';
import { Ico, PrimaryBtn, txt, useHelpHost, type IconName } from './kit';
import { t } from './i18n';
import { Text } from './text';
import { C, onColor, radius, space, TINT, type as T, withAlpha } from './theme';

/** Passages named in the alert; the rest are counted. */
const NAMED = 4;

export interface LostFilesWords {
  total: number;
  /** Recordings the server never had: gone. */
  unsent: number;
  /** Files the server has: nothing lost there. */
  safe: number;
  /** The passages to record again, by name. */
  passages: string[];
  morePassages: number;
}

/** What the alert says, from the open language and the files lost. */
export function lostFilesWords(state: LanguageState, lost: readonly LostFile[]): LostFilesWords {
  const view = lostFilesView(state, lost.map((l) => l.hash));
  return {
    total: lost.length,
    unsent: view.unsent,
    safe: view.safe,
    passages: view.unitIds.slice(0, NAMED).map((id) => unitTitle(state, id)),
    morePassages: Math.max(0, view.unitIds.length - NAMED)
  };
}

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
export function LostFilesAlert(props: { state: LanguageState | null }) {
  const { lost, store } = useLostFiles();
  const state = props.state;
  // One walk of the language's files per change, not per render.
  const words = useMemo(() => (state && lost.length ? lostFilesWords(state, lost) : null), [state, lost]);
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
