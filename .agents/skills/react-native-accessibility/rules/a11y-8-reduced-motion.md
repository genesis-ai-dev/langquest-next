---
ruleId: A11Y-8
title: Respect reduced motion preferences
---

## [A11Y-8] Respect reduced motion preferences

### Incorrect

```tsx
function FadeInCard({ children }) {
  const opacity = useSharedValue(0);
  useEffect(() => { opacity.value = withSpring(1); }, []);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
```

### Correct (Reanimated)

```tsx
import { useReducedMotion } from 'react-native-reanimated';

function FadeInCard({ children }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => { opacity.value = reduceMotion ? 1 : withSpring(1); }, [reduceMotion]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
```

Without Reanimated, use `AccessibilityInfo.isReduceMotionEnabled()` and listen with `addEventListener('reduceMotionChanged', ...)`.

When reduce motion is enabled: use instant transitions or cross-fades instead of slides, disable parallax, stop auto-playing animations. Loading spinners are acceptable.
