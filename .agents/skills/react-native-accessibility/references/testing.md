# Testing Accessibility

## Manual Testing

**VoiceOver (iOS):** Settings > Accessibility > VoiceOver. Not available in the Simulator — test on a physical device.

**TalkBack (Android):** Settings > Accessibility > TalkBack. On emulator, install from Play Store first. CLI toggle:
```bash
adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService
```

## What to Verify

1. Every interactive element is reachable via swipe
2. Labels are meaningful — not "button" or auto-generated text
3. Roles are announced correctly
4. State changes are announced (disabled, checked, expanded)
5. Focus moves logically after navigation and modal open/close
6. Dynamic content changes are announced
7. Touch targets are at least 44x44

## Automated Testing

```tsx
import { render, screen } from '@testing-library/react-native';

test('button is accessible', () => {
  render(<DeleteButton />);
  const button = screen.getByRole('button', { name: 'Delete message' });
  expect(button).toBeTruthy();
});
```

## Linting

```bash
npm install --save-dev eslint-plugin-react-native-a11y
```

```json
{ "extends": ["plugin:react-native-a11y/all"] }
```
