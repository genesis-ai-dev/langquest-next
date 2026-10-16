// The saved mark (decision 127): what people make has no Save button, so a small mark
// in the header shows that what you are making is kept. A spinner while it
// is being kept turns into a check once it is. Wordless, so it explains
// itself in help mode, and says itself to a screen reader (an image with a
// name: a wordless mark, which the web may name only with a role).
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { HelpInfo, Ico } from './kit';
import { C, TINT } from './theme';
import type { SaveStatus } from './savedModel';

export function SavedMark(props: { status: SaveStatus; testID?: string;
  /** What help mode says it means, where "kept as you go" needs more (a draft only you see). */ help?: string }) {
  const { status } = props;
  const pop = useRef(new Animated.Value(1)).current;
  const was = useRef(status);
  useEffect(() => {
    if (status === 'saved' && was.current === 'saving') {
      pop.setValue(0.5);
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();
    }
    was.current = status;
  }, [status, pop]);
  if (status === 'idle') return <View style={styles.box} />;
  const label = status === 'saving' ? t('saved.saving') : status === 'failed' ? t('saved.failed') : t('saved.saved');
  return (
    <HelpInfo label={label} detail={status === 'failed' ? t('saved.failedHelp') : props.help ?? t('saved.help')} style={styles.box}>
      <View testID={props.testID ?? 'saved-mark'} accessible accessibilityRole="image" accessibilityLabel={label}
        accessibilityLiveRegion="polite" style={styles.box}>
        {status === 'saving' ? <ActivityIndicator size="small" color={C.primary} />
          : status === 'failed' ? <Ico name="warning" size={22} color={TINT.redText} />
          : (
            <Animated.View style={[styles.done, { transform: [{ scale: pop }] }]}>
              <Ico name="check" size={16} color={C.white} strokeWidth={3.2} />
            </Animated.View>
          )}
      </View>
    </HelpInfo>
  );
}

const styles = StyleSheet.create({
  box: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  done: { width: 24, height: 24, borderRadius: 12, backgroundColor: TINT.greenText, alignItems: 'center', justifyContent: 'center' }
});
