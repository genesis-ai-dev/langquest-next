---
ruleId: A11Y-9
title: Color independence and font scaling
---

## [A11Y-9] Color independence and font scaling

### Don't rely on color alone

```tsx
// Bad — color-blind users can't distinguish error/success
<View style={{ backgroundColor: isError ? 'red' : 'green' }}>
  <Text style={{ color: 'white' }}>{status}</Text>
</View>

// Good — text and icon supplement color
<View style={{ backgroundColor: isError ? '#D32F2F' : '#388E3C' }}>
  <Text style={{ color: 'white' }}>{isError ? 'Error: ' : 'Success: '}{status}</Text>
</View>
```

Always pair color with text, icons, or patterns. WCAG contrast minimums: 4.5:1 for normal text, 3:1 for large text.

### Support font scaling

```tsx
// Bad
<Text allowFontScaling={false}>Important</Text>
<View style={{ height: 48 }}><Text>Clipped at large sizes</Text></View>

// Good
<Text>Important</Text>
<View style={{ minHeight: 48, paddingVertical: 12 }}><Text>Wraps at large sizes</Text></View>
```

Never set `allowFontScaling={false}`. If you must cap scaling, use `maxFontSizeMultiplier`. Use `minHeight` instead of fixed `height` for text containers.
