---
ruleId: A11Y-7
title: Manage focus after navigation and in modals
---

## [A11Y-7] Manage focus after navigation and in modals

### Focus After Navigation

```tsx
function DetailScreen() {
  const titleRef = useRef(null);

  useEffect(() => {
    const node = findNodeHandle(titleRef.current);
    if (node) {
      setTimeout(() => AccessibilityInfo.setAccessibilityFocus(node), 100);
    }
  }, []);

  return (
    <View>
      <Text ref={titleRef} accessibilityRole="header">Order Details</Text>
    </View>
  );
}
```

### Focus Scenarios

| Event | Focus Target |
|---|---|
| Navigate to new screen | Screen title |
| Open modal | Modal title or close button |
| Close modal | Element that triggered it |
| Delete list item | Next item (or previous if last) |
| Form error | First error message |

### Modal Focus Trapping

Screen reader users can navigate behind modals unless you trap focus. Prefer React Native's `<Modal>` which handles this automatically. For custom overlays:

```tsx
{/* Hide background from screen readers */}
<View importantForAccessibility={isOpen ? 'no-hide-descendants' : 'auto'}>
  <MainContent />
</View>

{isOpen && (
  <View accessibilityViewIsModal={true} onAccessibilityEscape={() => { onClose(); return true; }}>
    <Text accessibilityRole="header">Confirm</Text>
    <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose}>
      <Text>Close</Text>
    </Pressable>
  </View>
)}
```

- **iOS:** `accessibilityViewIsModal={true}` on the modal
- **Android:** `importantForAccessibility="no-hide-descendants"` on the background
- **iOS escape:** Implement `onAccessibilityEscape` so the two-finger Z-scrub gesture dismisses it
