---
ruleId: A11Y-3
title: Assign correct accessibility roles
---

## [A11Y-3] Assign correct accessibility roles

Without a role, a `Pressable` is announced as plain text — users won't know it's interactive.

### Incorrect

```tsx
<Pressable onPress={onToggle}>
  <Text>Dark Mode</Text>
</Pressable>

<Text style={styles.sectionTitle}>Settings</Text>
```

### Correct

```tsx
<Pressable onPress={onToggle} accessibilityRole="switch" accessibilityState={{ checked: isDarkMode }} accessibilityLabel="Dark mode">
  <Text>Dark Mode</Text>
</Pressable>

<Text accessibilityRole="header" style={styles.sectionTitle}>Settings</Text>
```

### Common Roles

| Component | Role |
|---|---|
| Tappable action | `button` |
| On/off toggle | `switch` |
| Checkbox | `checkbox` |
| Navigation link | `link` |
| Section title | `header` |
| Slider / stepper | `adjustable` |
| Tab | `tab` |
| Progress indicator | `progressbar` |
| Alert / toast | `alert` |

Mark section titles with `accessibilityRole="header"` so screen reader users can jump between sections.
