import { useSyncExternalStore } from 'react';

/** Light or dark, remembered on this browser; the system setting until someone chooses. */
export type Theme = 'light' | 'dark';

const KEY = 'lq-web-theme';
const listeners = new Set<() => void>();

function stored(): Theme | null {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function currentTheme(): Theme {
  return stored() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme() {
  document.documentElement.dataset['theme'] = currentTheme();
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme();
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMedia = () => { applyTheme(); l(); };
    media.addEventListener('change', onMedia);
    return () => { listeners.delete(l); media.removeEventListener('change', onMedia); };
  }, currentTheme);
}
