/**
 * Let someone in's QR code (docs/nearby-sync-plan.md 14.1, 3). Only an Android phone shows one
 * (LetInCode.android.tsx); here nothing draws, so the web bundle carries no QR library for it.
 */
export function LetInCode(_props: { value: string; label: string }) {
  return null;
}
