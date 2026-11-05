---
ruleId: A11Y-10
title: Accessibility actions for custom controls
---

## [A11Y-10] Accessibility actions for custom controls

Custom controls (steppers, swipeable rows, long-press menus) use gestures that screen reader users cannot perform. Expose them via `accessibilityActions`.

### Incorrect

```tsx
function QuantityStepper({ value, onChange }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(value - 1)}><Text>-</Text></Pressable>
      <Text>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)}><Text>+</Text></Pressable>
    </View>
  );
}
```

### Correct

```tsx
function QuantityStepper({ value, min = 0, max = 99, onChange }) {
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Quantity: ${value}`}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[
        { name: 'increment', label: 'Increase quantity' },
        { name: 'decrement', label: 'Decrease quantity' },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (event.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} aria-hidden={true}><Text>-</Text></Pressable>
      <Text aria-hidden={true}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} aria-hidden={true}><Text>+</Text></Pressable>
    </View>
  );
}
```

Wrap multi-element controls in a single `accessible` container, hide sub-elements with `aria-hidden`, and use `increment`/`decrement` for value controls or named custom actions for context menus.
