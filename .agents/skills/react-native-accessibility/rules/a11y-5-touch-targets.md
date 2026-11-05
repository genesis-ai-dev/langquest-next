---
ruleId: A11Y-5
title: Minimum 44x44 touch targets
---

## [A11Y-5] Minimum 44x44 touch targets

### Incorrect

```tsx
<Pressable onPress={onInfo} style={{ width: 24, height: 24 }}>
  <InfoIcon size={24} />
</Pressable>
```

### Correct

```tsx
<Pressable onPress={onInfo} accessibilityLabel="More info" accessibilityRole="button" hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
  <InfoIcon size={24} />
</Pressable>
```

Use `hitSlop` to increase tappable area without changing visual size. Close buttons, icon buttons, and toolbar items are the most common offenders.
