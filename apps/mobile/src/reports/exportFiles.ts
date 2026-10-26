// Reports as files: saving a CSV and printing (reports/ui.tsx). The CSV text is csvModel.ts.
import { Platform, Share } from 'react-native';

/** `Dinka books 2026-09-29.csv`, safe on every filesystem. */
export function fileName(title: string, now = new Date()): string {
  return `${safeName(title)} ${now.toISOString().slice(0, 10)}.csv`;
}

/** A file name without the characters some filesystems refuse. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
}

/** A CSV to keep: downloaded in a browser, handed to the share sheet on a phone or tablet. */
export function exportCsv(name: string, text: string): void {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  void Share.share({ title: name, message: text }).catch(() => undefined);
}

/** Printing (and saving as PDF) is the browser's; elsewhere there is nothing to print with. */
export const canPrint = Platform.OS === 'web';

export function printPage(): void {
  if (canPrint) window.print();
}
