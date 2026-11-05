# Screen Readers

## VoiceOver (iOS)

**Gestures:** Swipe right/left = next/previous | Double-tap = activate | Three-finger swipe = scroll | Two-finger Z-scrub = escape | Two-finger double-tap = magic tap | Swipe up/down on adjustable = increment/decrement

**Read order:** label → role → state → hint (if enabled) → value

## TalkBack (Android)

**Gestures:** Swipe right/left = next/previous | Double-tap = activate | Two-finger swipe = scroll | Volume up/down = increment/decrement | Double-tap and hold = long press

**Read order:** label → role → state → hint (always read) → usage hint

## Key Differences

- `accessibilityHint`: iOS users can disable; Android always reads — keep hints short
- Dynamic content: iOS uses `AccessibilityInfo.announceForAccessibility()`; Android uses `accessibilityLiveRegion`
- Form labels: iOS uses `accessibilityLabel`; Android also supports `accessibilityLabelledBy`
- Escape gesture and magic tap are iOS-only
- Long press action is Android-only

## Writing Good Labels

- Concise: "Delete" not "Tap to delete this item"
- Don't include role: "Send" not "Send button"
- Don't include state: use `accessibilityState` instead
