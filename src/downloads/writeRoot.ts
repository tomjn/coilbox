/**
 * Portable-install write-root healing. Pure and free of the picoframe/plugin-sdk
 * imports in `./config`, so the guardrail stays unit-testable.
 */

/** A content root reduced to what write-root healing needs. */
export interface WriteRootCandidate {
  id: string;
  path: string;
  portable: boolean;
}

/** Whether `path` is the package dir or sits inside it (mirrors the health check). */
function isInsidePackage(path: string, packageDir: string): boolean {
  return (
    path === packageDir ||
    path.startsWith(`${packageDir}/`) ||
    path.startsWith(`${packageDir}\\`)
  );
}

/**
 * The app dir a portable package sits in, derived from its `.coilbox` root; `null`
 * when not portable (so callers leave the user's write-root choice untouched).
 */
export function packageDirOf(portableRoot: string): string | null {
  if (!portableRoot) return null;
  return portableRoot.replace(/[/\\]\.coilbox\/?$/, "");
}

/**
 * Choose the effective download write root, healing a portable install so downloads
 * always land inside the package.
 *
 * - Not portable (`packageDir` null): the configured root, verbatim — the user's
 *   choice stands.
 * - Portable: keep the configured root when it's inside the package; otherwise fall
 *   back to an in-package root (preferring a `portable` one). This repairs a stale or
 *   external write root dragged in by copying/renaming a package — the footgun where
 *   downloads would otherwise land beside the *old* folder, not the running one.
 *
 * Returns `undefined` only when nothing usable exists (no configured root and, when
 * portable, no in-package root either).
 */
export function healWriteRoot(
  roots: WriteRootCandidate[],
  writeRootId: string | undefined,
  packageDir: string | null,
): WriteRootCandidate | undefined {
  const configured = writeRootId
    ? roots.find((r) => r.id === writeRootId)
    : undefined;
  if (!packageDir) return configured;
  if (configured && isInsidePackage(configured.path, packageDir)) {
    return configured;
  }
  return (
    roots.find((r) => r.portable && isInsidePackage(r.path, packageDir)) ??
    roots.find((r) => isInsidePackage(r.path, packageDir)) ??
    configured
  );
}
