# Focus Management

## Programmatic Focus

```tsx
// iOS
const node = findNodeHandle(ref.current);
if (node) AccessibilityInfo.setAccessibilityFocus(node);

// Android
UIManager.sendAccessibilityEvent(findNodeHandle(ref.current), UIManager.AccessibilityEventTypes.typeViewFocused);
```

Use a small `setTimeout` (100ms) after navigation to let the screen finish rendering before setting focus.

## Focus Restoration Pattern

```tsx
function useFocusRestoration(triggerRef, isOpen) {
  useEffect(() => {
    if (!isOpen && triggerRef.current) {
      const node = findNodeHandle(triggerRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }
  }, [isOpen]);
}
```

## Custom Focus Order

```tsx
<View experimental_accessibilityOrder={['title', 'cta', 'description']}>
  <Text accessible nativeID="description">Details</Text>
  <Text accessible nativeID="title" accessibilityRole="header">Title</Text>
  <Pressable accessible nativeID="cta" onPress={act}><Text>Go</Text></Pressable>
</View>
```

Non-listed accessible descendants are excluded from focus order.
