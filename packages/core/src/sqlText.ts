/**
 * Text checks written the way SQL `validate_payload` measures text, so core
 * never refuses a string the server accepted (PLAN.md invariant 11).
 */

/** SQL `length(trim(s)) = 0`. Postgres trim() strips spaces only, not tabs or newlines like JS trim(). */
export function sqlBlank(s: string): boolean {
  return !/[^ ]/.test(s);
}

/** SQL `length(s)`: characters (code points), not the UTF-16 units JS `.length` counts. */
export function sqlLength(s: string): number {
  return Array.from(s).length;
}
