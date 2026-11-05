---
ruleId: A11Y-2
title: Label meaningful images, hide decorative ones
---

## [A11Y-2] Label meaningful images, hide decorative ones

### Incorrect

```tsx
<Image source={{ uri: profilePhoto }} />

<View style={styles.row}>
  <MailIcon />
  <Text>Email</Text>
</View>
```

### Correct

```tsx
{/* Meaningful — describe it */}
<Image source={{ uri: profilePhoto }} accessibilityLabel="Profile photo of Jane Doe" accessibilityRole="image" />

{/* Decorative — hide it */}
<View style={styles.row}>
  <MailIcon aria-hidden={true} />
  <Text>Email</Text>
</View>
```

### What to hide

Icons next to text, background images, dividers, shimmer placeholders, non-interactive brand logos.

### What NOT to hide

Status icons without text, informational images, anything interactive.
