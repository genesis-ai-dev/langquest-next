import { useCallback, useState } from 'react';
import type { Ctx } from './ctx';

/** Details on request (ADR-013): open state per thing shown, kept for the session and across Back. */
export function useDetails(): Ctx['details'] {
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  return useCallback((key: string) => ({
    open: !!openDetails[key],
    onToggle: () => setOpenDetails((d) => ({ ...d, [key]: !d[key] }))
  }), [openDetails]);
}
