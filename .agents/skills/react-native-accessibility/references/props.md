# Accessibility Props

## Both Platforms

| Prop | Purpose |
|---|---|
| `accessible` | Makes element discoverable by screen readers (touchables default to `true`) |
| `accessibilityLabel` | Text read aloud by screen readers |
| `accessibilityHint` | Describes outcome of action (iOS: user can disable; Android: always reads) |
| `accessibilityRole` | Component purpose: `button`, `link`, `header`, `switch`, `checkbox`, etc. |
| `role` | Newer alternative to `accessibilityRole` (takes precedence) |
| `accessibilityState` | Object: `{ disabled, selected, checked, busy, expanded }` |
| `accessibilityValue` | Object: `{ min, max, now, text }` for range components |
| `accessibilityActions` | Array of `{ name, label }` for custom screen reader actions |
| `onAccessibilityAction` | Handler for accessibility actions |

## iOS Only

| Prop | Purpose |
|---|---|
| `accessibilityViewIsModal` | VoiceOver ignores sibling elements (for modals) |
| `accessibilityElementsHidden` | Hides element and children from VoiceOver |
| `accessibilityLanguage` | Language for screen reader (BCP 47) |
| `accessibilityIgnoresInvertColors` | Prevents color inversion on images |
| `onAccessibilityEscape` | Two-finger Z-scrub gesture handler |
| `onMagicTap` | Two-finger double-tap handler |

## Android Only

| Prop | Purpose |
|---|---|
| `accessibilityLabelledBy` | References another element's `nativeID` for form labels |
| `accessibilityLiveRegion` | Announces dynamic changes: `'polite'` or `'assertive'` |
| `importantForAccessibility` | `'auto'`, `'yes'`, `'no'`, `'no-hide-descendants'` |

## ARIA Equivalents

`aria-hidden` → `accessibilityElementsHidden` / `importantForAccessibility` | `aria-label` → `accessibilityLabel` | `aria-live` → `accessibilityLiveRegion` | `aria-modal` → `accessibilityViewIsModal` | `aria-disabled/checked/expanded/selected/busy` → `accessibilityState` fields
