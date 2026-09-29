# Platform Differences

## Prop Availability

| Prop | iOS | Android |
|---|---|---|
| `accessibilityLabel` | Yes | Yes |
| `accessibilityHint` | User can disable | Always reads |
| `accessibilityRole` / `role` | Yes | Yes |
| `accessibilityState` | Yes | Yes |
| `accessibilityValue` | Yes | Yes |
| `accessibilityActions` | Yes | Yes |
| `accessibilityViewIsModal` | Yes | No |
| `accessibilityElementsHidden` | Yes | No |
| `accessibilityLanguage` | Yes | No |
| `accessibilityLabelledBy` | No | Yes |
| `accessibilityLiveRegion` | No | Yes |
| `importantForAccessibility` | No | Yes |
| `onAccessibilityEscape` | Yes | No |
| `onMagicTap` | Yes | No |

## Cross-Platform Cheat Sheet

**Hiding from screen readers:** `aria-hidden={true}` works on both. Platform-specific: `accessibilityElementsHidden` (iOS), `importantForAccessibility="no-hide-descendants"` (Android).

**Modal focus trapping:** `accessibilityViewIsModal` (iOS) on the modal + `importantForAccessibility="no-hide-descendants"` (Android) on the background.

**Announcing changes:** `AccessibilityInfo.announceForAccessibility()` (iOS) + `accessibilityLiveRegion` (Android). Do both for cross-platform.

**Form labels:** `accessibilityLabel` on the input works on both. Additionally use `accessibilityLabelledBy` on Android.
