---
ruleId: A11Y-4
title: Communicate component state
---

## [A11Y-4] Communicate component state

Screen readers cannot see visual changes like grayed-out buttons or expanded sections. Use `accessibilityState`.

### Incorrect

```tsx
<Pressable onPress={isDisabled ? undefined : onPress} style={isDisabled ? styles.disabled : styles.active}>
  <Text>Submit</Text>
</Pressable>
```

### Correct

```tsx
<Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ disabled: isDisabled }} disabled={isDisabled}>
  <Text>Submit</Text>
</Pressable>
```

### States

| State | Type | Use For |
|---|---|---|
| `disabled` | boolean | Non-interactive elements |
| `selected` | boolean | Selected tab, list item |
| `checked` | boolean \| `'mixed'` | Checkboxes, toggles |
| `busy` | boolean | Loading elements |
| `expanded` | boolean | Collapsible sections, dropdowns |
