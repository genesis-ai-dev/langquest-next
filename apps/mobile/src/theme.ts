/**
 * Palette ported from the LangQuest v2 "task-first" prototype (commit
 * 2fe8e1e5). One yellow action per screen; blue = translate, teal = review,
 * orange = reference material, green = done. Tints are the same hues at 6%
 * so a card or row reads by its shading before its icon.
 */
import { StyleSheet as NativeStyleSheet } from 'react-native';

export const lightColors = {
  background: '#FAF9F7',
  foreground: '#252A37',
  card: '#FFFFFF',
  muted: '#F2F0EC',
  mutedForeground: '#676D7E',
  border: '#DDE0E8',
  action: '#FDC317',
  actionForeground: '#1D212B',
  translate: '#0A5ADB',
  review: '#228FA0',
  reference: '#F3751B',
  done: '#29A376',
  danger: '#D93025',
  white: '#ffffff'
} as const;

const darkColors: Record<keyof typeof lightColors, string> = {
  ...lightColors, background: '#151820', foreground: '#F2F3F6',
  card: '#222632', muted: '#2B303D', mutedForeground: '#B4BBCC',
  border: '#42495B', translate: '#7CABFF', review: '#66C6D2',
  reference: '#FFAB70', done: '#61D5A6', danger: '#FF8980'
};
let dark = false;
export function applyTheme(isDark: boolean) { dark = isDark; }
export const colors = Object.fromEntries(Object.keys(lightColors).map((key) =>
  [key, lightColors[key as keyof typeof lightColors]]
)) as Record<keyof typeof lightColors, string>;
for (const key of Object.keys(lightColors) as (keyof typeof lightColors)[]) {
  Object.defineProperty(colors, key, { enumerable: true,
    get: () => (dark ? darkColors : lightColors)[key] });
}

/** Keep module-level styles responsive without remounting active recordings. */
export const StyleSheet = {
  ...NativeStyleSheet,
  create<T extends NativeStyleSheet.NamedStyles<T> | NativeStyleSheet.NamedStyles<any>>(styles: T): T {
    const result = {} as T;
    for (const name of Object.keys(styles) as (keyof T)[]) {
      const style = { ...styles[name] };
      for (const property of Object.keys(style)) {
        if (!/color$/i.test(property)) continue;
        const value = (style as Record<string, unknown>)[property];
        const token = (Object.keys(lightColors) as (keyof typeof lightColors)[])
          .find((key) => lightColors[key] === value || darkColors[key] === value);
        if (token) Object.defineProperty(style, property, {
          enumerable: true, get: () => colors[token]
        });
        else {
          const tintToken = (Object.keys(lightTint) as (keyof typeof lightTint)[])
            .find((key) => lightTint[key] === value || darkTint[key] === value);
          if (tintToken) Object.defineProperty(style, property, {
            enumerable: true, get: () => tint[tintToken]
          });
        }
      }
      // Fresh values also change the style reference, so React Native's
      // native prop diff cannot skip a palette update by object identity.
      Object.defineProperty(result, name, { enumerable: true,
        get: () => ({ ...style }) });
    }
    return result;
  }
};

const lightTint = {
  translate: 'rgba(10, 90, 219, 0.06)',
  review: 'rgba(34, 143, 160, 0.06)',
  reference: 'rgba(243, 117, 27, 0.06)',
  translateBadge: 'rgba(10, 90, 219, 0.15)',
  reviewBadge: 'rgba(34, 143, 160, 0.15)',
  reviewChip: 'rgba(34, 143, 160, 0.10)',
  done: 'rgba(41, 163, 118, 0.06)',
  doneBorder: 'rgba(41, 163, 118, 0.25)',
  translateBar: 'rgba(10, 90, 219, 0.40)',
  reviewBar: 'rgba(34, 143, 160, 0.40)',
  mutedContainer: 'rgba(242, 240, 236, 0.70)'
} as const;

const darkTint: Record<keyof typeof lightTint, string> = {
  translate: 'rgba(124, 171, 255, 0.10)',
  review: 'rgba(102, 198, 210, 0.10)',
  reference: 'rgba(255, 171, 112, 0.10)',
  translateBadge: 'rgba(124, 171, 255, 0.22)',
  reviewBadge: 'rgba(102, 198, 210, 0.22)',
  reviewChip: 'rgba(102, 198, 210, 0.15)',
  done: 'rgba(97, 213, 166, 0.10)',
  doneBorder: 'rgba(97, 213, 166, 0.35)',
  translateBar: 'rgba(124, 171, 255, 0.40)',
  reviewBar: 'rgba(102, 198, 210, 0.40)',
  mutedContainer: 'rgba(43, 48, 61, 0.70)'
};
export const tint = {} as Record<keyof typeof lightTint, string>;
for (const key of Object.keys(lightTint) as (keyof typeof lightTint)[]) {
  Object.defineProperty(tint, key, { enumerable: true,
    get: () => (dark ? darkTint : lightTint)[key] });
}

export const radius = { md: 12, lg: 16, xl: 20, full: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
