/** A browser installs no store build: its build is the commit it loaded (diagnostics.ts). storeBuild.ts is a phone's. */
export function storeBuildParts(): { version: string; build?: string } | undefined {
  return undefined;
}

export function storeBuild(): string | undefined {
  return undefined;
}
