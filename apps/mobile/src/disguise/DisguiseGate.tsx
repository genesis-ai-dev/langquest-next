import { useEffect, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { ModalCoverContext } from '../ui/coverContext';
import { openBackStep } from '../ui/hardwareBack';
import { codeLength, lockNow, tryCode } from './disguise';
import type { Look } from './disguiseModel';
import { DisguiseFace } from './faces';
import { useDisguise } from './useDisguise';

/**
 * The disguise in front of the whole app (decisions.md 171). A phone that
 * wears one opens on it, and the app under it starts only once the code is
 * typed, so nothing of LangQuest shows, asks or sounds before then. Leaving
 * the app puts it back on; the app stays as it was under it, so coming back
 * with the code finds the same screen, a recording or a sheet still open.
 * Every modal draws it too (ModalCoverContext), as a modal sits above this view.
 */
export function DisguiseGate(props: { children: ReactNode }) {
  const { look, locked } = useDisguise();
  const [started, setStarted] = useState(!locked);
  useEffect(() => { if (!locked) setStarted(true); }, [locked]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'background') return;
      Keyboard.dismiss();
      lockNow();
    });
    return () => sub.remove();
  }, []);
  return (
    <ModalCoverContext.Provider value={DisguiseCover}>
      {started ? (
        <View style={styles.fill} accessibilityElementsHidden={locked} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
          {props.children}
        </View>
      ) : null}
      {locked && look ? <Cover look={look} /> : null}
    </ModalCoverContext.Provider>
  );
}

/** The disguise inside a modal (kit's Sheet and the rest), while it is on. */
function DisguiseCover() {
  const { look, locked } = useDisguise();
  return locked && look ? <Cover look={look} /> : null;
}

function Cover(props: { look: Look }) {
  const [length, setLength] = useState<number | null>(null);
  useEffect(() => { void codeLength().then(setLength); }, []);
  // Android's Back leaves a calculator: so it leaves this one, not a screen of the app behind it.
  // Asked before the app's own steps and screens, as the newest step open (decision 137); before the
  // app has started there are none, and Android's Back leaves as usual.
  useEffect(() => openBackStep({ showing: () => true, run: () => BackHandler.exitApp() }), []);
  return (
    // The only thing a screen reader reaches while it shows, inside a modal too.
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <DisguiseFace kind={props.look.kind} length={length} onCandidate={tryCode} keep />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
