// What help mode needs inside a part (demo a-helpMode): an unseen box that
// tells the help layer (helpMode.tsx) where the part is drawn, so the dimmed
// screen leaves it lit and its number sits on its corner. The layer draws the
// number over everything, so a card that clips its rows never cuts it off.
// Drawn only: taps go to the part.
import { useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { HelpClipContext, HelpContext, HelpScopeContext, type HelpLit, type HelpSpot } from './helpContext';

/** Tell the help layer where the view holding this ref is, every frame while help is on. */
function useLit(what: HelpLit | null, id: string) {
  const help = useContext(HelpContext);
  const ref = useRef<View>(null);
  const place = help?.place;
  const track = help?.track;
  const on = !!help?.on && !!what;
  const key = what ? JSON.stringify(what) : '';
  useEffect(() => {
    if (!on || !place || !track || !what) return;
    const measure = () => ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) place(id, { x, y, width, height }, what);
    });
    const stop = track(measure);
    return () => { stop(); place(id, null, what); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `what`
  }, [on, place, track, id, key]);
  return ref;
}

/** Put inside a part that calls useHelpSpot: lights it and numbers it while help is on. `inset` puts the number just inside (a row in a card). */
export function HelpBadge(props: { spot: HelpSpot<unknown>; inset?: boolean }) {
  const id = useId();
  const clip = useContext(HelpClipContext);
  const part = props.spot.id;
  const what = useMemo<HelpLit | null>(() => (part ? { kind: 'part', part, mark: props.inset ? 'inset' : 'corner', ...(clip ? { clip } : {}) } : null),
    [part, props.inset, clip]);
  const ref = useLit(what, id);
  return part ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null;
}

/** Keeps a control lit while help is on without numbering it: the ? that turns help off. */
export function HelpLit() {
  const id = useId();
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const clip = useContext(HelpClipContext);
  const what = useMemo<HelpLit | null>(() => (help?.on && showing ? { kind: 'lit', ...(clip ? { clip } : {}) } : null), [help?.on, showing, clip]);
  const ref = useLit(what, id);
  return what ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null;
}

/**
 * The area parts scroll in (kit's Screen body): nothing lit inside it is
 * drawn past its edges, so a part scrolled under the header or a footer
 * stays dim there.
 */
export function HelpClip(props: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const id = useId();
  const help = useContext(HelpContext);
  const showing = useContext(HelpScopeContext);
  const what = useMemo<HelpLit | null>(() => (help?.on && showing ? { kind: 'clip' } : null), [help?.on, showing]);
  const ref = useLit(what, id);
  return (
    <View style={props.style}>
      <HelpClipContext.Provider value={id}>{props.children}</HelpClipContext.Provider>
      {what ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
});
