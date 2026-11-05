import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { IconBtn } from './kit';
import { C, target } from './theme';

/**
 * Undo and Redo where people build something (decisions 133 and 134; the
 * research "Undo and redo in recording"): two arrows that never move, grey
 * when there is nothing to take back or put back. The recording screen puts
 * them beside the red button (out of the way while its red view is open);
 * other screens in the header, beside help.
 */
export interface UndoRedoProps { canUndo: boolean; canRedo: boolean; undoWhat?: string; redoWhat?: string; onUndo: () => void; onRedo: () => void }

export function UndoRedo(props: UndoRedoProps & { hidden?: boolean; size?: number;
  /** What help mode says each does here. */ help: { undo: string; redo: string } }) {
  const size = props.size ?? target.min;
  const undoLabel = props.undoWhat ? t('common.undoWhat', { what: props.undoWhat }) : t('common.undo');
  const redoLabel = props.redoWhat ? t('common.redoWhat', { what: props.redoWhat }) : t('common.redo');
  return (
    <View style={[styles.row, props.hidden && { opacity: 0 }]} pointerEvents={props.hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={props.hidden} importantForAccessibility={props.hidden ? 'no-hide-descendants' : 'auto'}>
      <IconBtn name="undo" testID="undo" label={undoLabel} help={props.help.undo} bg="transparent" color={C.dark} size={size}
        disabled={!props.canUndo} onPress={props.onUndo} />
      <IconBtn name="redo" testID="redo" label={redoLabel} help={props.help.redo} bg="transparent" color={C.dark} size={size}
        disabled={!props.canRedo} onPress={props.onRedo} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' }
});
