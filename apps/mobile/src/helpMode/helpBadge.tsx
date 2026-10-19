// What help mode needs inside a part (demo a-helpMode): an unseen box that
// tells the help layer (helpMode.tsx) where the part is drawn, so the dimmed
// screen leaves it lit and its number sits on its corner. The layer draws the
// number over everything, so a card that clips its rows never cuts it off.
// Drawn only: taps go to the part.
import { useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { HelpLit, HelpRowAt, HelpSpot } from './helpContext';
import { HelpClipContext, HelpContext, HelpHostContext, HelpLayerContext, HelpRowContext, useHelpOn } from './useHelpMode';

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
  const rows = useContext(HelpRowContext);
  const part = props.spot.id;
  const what = useMemo<HelpLit | null>(() => (part ? { kind: 'part', part, mark: props.inset ? 'inset' : 'corner', ...(clip ? { clip } : {}), ...(rows ? { rows } : {}) } : null),
    [part, props.inset, clip, rows]);
  const ref = useLit(what, id);
  return part ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null;
}

/** Keeps a control lit while help is on without numbering it: the ? that turns help off. */
export function HelpLit() {
  const id = useId();
  const on = useHelpOn();
  const clip = useContext(HelpClipContext);
  const what = useMemo<HelpLit | null>(() => (on ? { kind: 'lit', ...(clip ? { clip } : {}) } : null), [on, clip]);
  const ref = useLit(what, id);
  return what ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null;
}

/**
 * One of a list's same-shaped rows (a passage, a person, a part): while help
 * is on, only the first row of each kind in sight numbers its parts, so a
 * list of twenty passages shows one passage's numbers, not twenty (decision
 * 71 as amended 2026-10-16). The other rows stay dim and still explain when
 * tapped. `of` names the kind of row; lists of the same kind on one screen
 * share the one row. A list whose items each do something different (tabs,
 * filters) has no HelpRow.
 */
export function HelpRow(props: { of: string; children: ReactNode }) {
  const row = useId();
  const outer = useContext(HelpRowContext);
  const rows = useMemo<readonly HelpRowAt[]>(() => [...(outer ?? []), { of: props.of, row }], [outer, props.of, row]);
  return <HelpRowContext.Provider value={rows}>{props.children}</HelpRowContext.Provider>;
}

/**
 * The area parts scroll in (kit's Screen body): nothing lit inside it is
 * drawn past its edges, so a part scrolled under the header or a footer
 * stays dim there.
 */
export function HelpClip(props: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const id = useId();
  const on = useHelpOn();
  const what = useMemo<HelpLit | null>(() => (on ? { kind: 'clip' } : null), [on]);
  const ref = useLit(what, id);
  return (
    <View style={props.style}>
      <HelpClipContext.Provider value={id}>{props.children}</HelpClipContext.Provider>
      {what ? <View ref={ref} collapsable={false} style={styles.box} pointerEvents="none" /> : null}
    </View>
  );
}

/**
 * What a sheet draws (kit's Sheet, from useHelpHost): its parts belong to it,
 * not to the screen under it (nor to the area that screen scrolls in, nor to
 * a row of a list there), and help draws inside it while it is on top.
 */
export function HelpHost(props: { id: string; children: ReactNode }) {
  return (
    <HelpHostContext.Provider value={props.id}>
      <HelpClipContext.Provider value={undefined}>
        <HelpRowContext.Provider value={undefined}>
          {props.children}
          <HelpHostLayer id={props.id} />
        </HelpRowContext.Provider>
      </HelpClipContext.Provider>
    </HelpHostContext.Provider>
  );
}

/** Inside a sheet that opened a help host (kit's Sheet): while it is on top, help dims and numbers here. */
export function HelpHostLayer(props: { id: string }) {
  const slot = useContext(HelpLayerContext);
  return slot?.host === props.id ? <>{slot.layer}</> : null;
}

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }
});
