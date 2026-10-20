/**
 * Portable-install write-root healing. Pure and free of the picoframe/plugin-sdk
 * imports in `./config`, so the guardrail stays unit-testable.
 */

/** A content root reduced to what write-root healing needs. */
export interface WriteRootCandidate {
  id: string;
  path: string;
  portable: boolean;
  /** The distribution's bundled content folder, which is never written into. */
  bundled?: boolean;
  /** A folder the player set to read only, which is never written into. */
  readOnly?: boolean;
}

/** Whether coilbox may write into `root`. */
function isWritable(root: WriteRootCandidate): boolean {
  return !root.bundled && !root.readOnly;
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
 * The bundled content folder (`.coilbox/content`) is never chosen, configured or
 * not. It sits inside the package and is marked portable, so without this it
 * would pass both tests above, and coilbox does not write into it. A folder set
 * to read only is skipped the same way.
 *
 * Returns `undefined` only when nothing usable exists (no configured root and, when
 * portable, no in-package root either).
 */
export function healWriteRoot(
  allRoots: WriteRootCandidate[],
  writeRootId: string | undefined,
  packageDir: string | null,
): WriteRootCandidate | undefined {
  const roots = allRoots.filter(isWritable);
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

/**
 * The root id to store as the default download destination, or `undefined` to
 * leave `writeRootId` as it is. An unset id, or one naming a listed root that
 * coilbox may not write into, moves to the first writable root. An id naming a
 * root that is not listed is kept, because that is usually a drive that is not
 * plugged in.
 */
export function backfillWriteRootId(
  roots: WriteRootCandidate[],
  writeRootId: string | undefined,
): string | undefined {
  if (writeRootId) {
    const current = roots.find((r) => r.id === writeRootId);
    if (!current || isWritable(current)) return undefined;
  }
  return roots.find(isWritable)?.id;
}

const trimEnd = (p: string): string => p.replace(/[\\/]+$/, "");

/**
 * The content folder to write a test mutator into for an engine whose own
 * folder is `dataDir`. That folder when coilbox may write into it. When it is
 * the bundled folder or read only, `writePath` (the default write folder)
 * instead. The engine and unitsync read every content folder, so a mutator in
 * another one is found all the same.
 *
 * With no writable folder to fall back to, `dataDir` comes back unchanged and
 * the write is refused where it happens, with the reason.
 */
export function mutatorDataDir(
  roots: WriteRootCandidate[],
  dataDir: string,
  writePath: string | undefined,
): string {
  const engineRoot = roots.find((r) => trimEnd(r.path) === trimEnd(dataDir));
  if (!engineRoot || isWritable(engineRoot)) return dataDir;
  return writePath ?? dataDir;
}

/** The kinds of content that can have a download folder of their own. */
export type WriteRootKind = "games" | "maps";

/** The folder ids the user has chosen, as the downloads config stores them. */
export interface WriteRootIds {
  /** The default, which everything without a folder of its own goes to. */
  writeRootId?: string;
  gamesRootId?: string;
  mapsRootId?: string;
}

/**
 * The folder a download of `kind` goes to. With no kind this is the default
 * from {@link healWriteRoot}, which engines and everything else use.
 *
 * A kind's own folder wins when it is set and still usable. It is not usable
 * when it has been removed, when it is the bundled content folder or read only, or when a
 * portable install would be writing outside its package. Each of those falls
 * back to the default, so a stale choice never leaves a download with nowhere
 * to go.
 */
export function pickWriteRoot(
  allRoots: WriteRootCandidate[],
  ids: WriteRootIds,
  kind: WriteRootKind | undefined,
  packageDir: string | null,
): WriteRootCandidate | undefined {
  const fallback = healWriteRoot(allRoots, ids.writeRootId, packageDir);
  const ownId =
    kind === "games"
      ? ids.gamesRootId
      : kind === "maps"
        ? ids.mapsRootId
        : undefined;
  if (!ownId) return fallback;
  const own = allRoots.find((r) => r.id === ownId && isWritable(r));
  if (!own) return fallback;
  if (packageDir && !isInsidePackage(own.path, packageDir)) return fallback;
  return own;
}
