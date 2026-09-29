---
ruleId: A11Y-1
title: Label all interactive elements and form inputs
---

## [A11Y-1] Label all interactive elements and form inputs

### Incorrect

```tsx
<Pressable onPress={onSend}>
  <SendIcon />
</Pressable>

<Text>Email</Text>
<TextInput value={email} onChangeText={setEmail} />
```

### Correct

```tsx
<Pressable onPress={onSend} accessibilityLabel="Send message" accessibilityRole="button">
  <SendIcon />
</Pressable>

<Text>Email</Text>
<TextInput value={email} onChangeText={setEmail} accessibilityLabel="Email" />
```

On Android, you can also use `accessibilityLabelledBy` to associate a visible `Text` with an input via `nativeID`.

### Guidelines

- Describe what it **does**, not what it looks like: "Delete" not "Trash can icon"
- Don't include the role: "Send" not "Send button" — screen readers add the role
- Don't include state: use `accessibilityState` instead
- Don't rely on `placeholder` as a label — it disappears when the user types
