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

/** The print-only layer, and the style that shows only it on paper. */
const PRINT_LAYER = 'lq-print';
// i18n-ignore: CSS
const PRINT_STYLE = `#${PRINT_LAYER}{display:none}
@media print{body>*:not(#${PRINT_LAYER}){display:none!important}#${PRINT_LAYER}{display:block!important}
html,body{height:auto!important;overflow:visible!important}#${PRINT_LAYER}>h1{font:700 22px system-ui,sans-serif;margin:0 0 12px}}`;

/**
 * The browser's print window, for the report in the view whose `nativeID`
 * is `id`, under `title`. The screen is a fixed box that scrolls inside, so
 * printing the page itself gave the sidebar, the chips and only what was
 * scrolled into view (UI audit, finding 72). The report is copied into a
 * layer of its own at the foot of the page, the only thing printed, and the
 * copy goes once printing is done.
 */
export function printPage(id?: string, title?: string): void {
  if (!canPrint) return;
  const doc = window.document;
  const source = id ? doc.getElementById(id) : null;
  if (source) {
    if (!doc.getElementById(`${PRINT_LAYER}-style`)) {
      const style = doc.createElement('style');
      style.id = `${PRINT_LAYER}-style`;
      style.textContent = PRINT_STYLE;
      doc.head.appendChild(style);
    }
    doc.getElementById(PRINT_LAYER)?.remove();
    const layer = doc.createElement('div');
    layer.id = PRINT_LAYER;
    if (title) {
      const heading = doc.createElement('h1');
      heading.textContent = title;
      layer.appendChild(heading);
    }
    const copy = source.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    layer.appendChild(copy);
    doc.body.appendChild(layer);
    window.addEventListener('afterprint', () => layer.remove(), { once: true });
  }
  window.print();
}
