/** React Native's accessibilityState, written out so this stays pure (no platform import). */
export interface AccessibilityState { disabled?: boolean; selected?: boolean; checked?: boolean | 'mixed'; busy?: boolean; expanded?: boolean }

/** What a control's state adds: React Native's own, and the aria-* words the web reads. */
export interface A11yStateProps {
  accessibilityState?: AccessibilityState;
  'aria-checked'?: boolean | 'mixed';
  'aria-expanded'?: boolean;
  'aria-selected'?: boolean;
  'aria-current'?: boolean;
  'aria-pressed'?: boolean;
  'aria-disabled'?: boolean;
  'aria-busy'?: boolean;
}

const CHECKED: readonly string[] = ['radio', 'checkbox', 'switch', 'menuitemradio', 'menuitemcheckbox'];

/**
 * A control's on/off, selected, open, disabled and busy state, for phones and
 * the web alike. react-native-web drops `accessibilityState`, so a screen
 * reader on the web heard no state for most toggles, tabs and disclosures
 * (UI audit, finding 21). Each state goes out twice: as `accessibilityState`
 * for phones, and as the aria-* word the web reads, by role: a radio,
 * checkbox or switch is checked, a tab selected, and a button pressed or not
 * (aria-selected is not allowed on a button). A button that marks where you
 * are among others (a step, a version, a chapter) says current instead.
 */
export function a11yState(state: AccessibilityState | undefined, role?: string, mark: 'pressed' | 'current' = 'pressed'): A11yStateProps {
  if (!state) return {};
  const out: A11yStateProps = { accessibilityState: state };
  if (state.disabled) out['aria-disabled'] = true;
  if (state.busy) out['aria-busy'] = true;
  if (state.expanded !== undefined) out['aria-expanded'] = state.expanded;
  const on = state.checked ?? state.selected;
  if (role && CHECKED.includes(role)) {
    if (on !== undefined) out['aria-checked'] = on;
  } else if (role === 'tab') {
    if (state.selected !== undefined) out['aria-selected'] = state.selected;
  } else if (mark === 'current') {
    if (on) out['aria-current'] = true;
  } else if (on !== undefined) {
    out['aria-pressed'] = on === true;
  }
  return out;
}
