---
name: react-native-accessibility
description: Guides writing accessible React Native components — screen reader labels, roles, states, focus management, touch targets, and platform-specific patterns for VoiceOver and TalkBack. Use when writing or modifying React Native UI code.
license: MIT
metadata:
  version: "1.0"
---

When writing React Native components, follow these accessibility standards as you write.

## Rules

- [A11Y-1](rules/a11y-1-labels.md) — Label all interactive elements and form inputs
- [A11Y-2](rules/a11y-2-images-and-decorative.md) — Label meaningful images, hide decorative ones
- [A11Y-3](rules/a11y-3-roles.md) — Assign correct accessibility roles
- [A11Y-4](rules/a11y-4-state.md) — Communicate component state
- [A11Y-5](rules/a11y-5-touch-targets.md) — Minimum 44x44 touch targets
- [A11Y-6](rules/a11y-6-announcements.md) — Announce dynamic content changes
- [A11Y-7](rules/a11y-7-focus-and-modals.md) — Manage focus after navigation and in modals
- [A11Y-8](rules/a11y-8-reduced-motion.md) — Respect reduced motion preferences
- [A11Y-9](rules/a11y-9-visual.md) — Color independence and font scaling
- [A11Y-10](rules/a11y-10-custom-actions.md) — Accessibility actions for custom controls

## References

- `references/props.md` — All accessibility props by platform
- `references/screen-readers.md` — VoiceOver and TalkBack gestures and behavior
- `references/focus-management.md` — Programmatic focus and custom focus order
- `references/platform.md` — iOS vs Android differences
- `references/testing.md` — Manual testing, automated testing, and linting
