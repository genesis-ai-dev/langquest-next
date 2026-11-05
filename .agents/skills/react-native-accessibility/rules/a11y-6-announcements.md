---
ruleId: A11Y-6
title: Announce dynamic content changes
---

## [A11Y-6] Announce dynamic content changes

### Incorrect

```tsx
function Toast({ message }) {
  return <Text style={styles.toast}>{message}</Text>;
}
```

### Correct

```tsx
function Toast({ message }) {
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  return <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{message}</Text>;
}
```

### Cross-Platform Strategy

- **Android:** `accessibilityLiveRegion` (`polite` or `assertive`) handles announcements natively
- **iOS:** Call `AccessibilityInfo.announceForAccessibility()` in a `useEffect`
- **Both:** Do both — set `accessibilityLiveRegion` AND call `announceForAccessibility` on iOS

Use for: toasts, form errors, counter updates, content loaded confirmations.
