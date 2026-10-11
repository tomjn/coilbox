import { basename, errorText } from "@/lib/helpers";

/**
 * Installing a game or map archive the player already has as a file: one
 * dropped on the window, or one opened with coilbox from the file manager.
 *
 * Everything here is the part with no window in it. `DeepLinkHandler` owns the
 * prompt, and the Rust side (`dl_inspect_archive`, `dl_install_archive`) reads
 * the archive and does the copy.
 */

/** The two packaged archive kinds. A `.sdd` folder is not installed this way. */
const ARCHIVE = /\.(sdz|sd7)$/i;

export function isArchivePath(path: string): boolean {
  return ARCHIVE.test(path);
}

/**
 * The local path a `file://` URL names, or null for any other URL. macOS hands
 * over a file opened with coilbox as one of these, through the same event a
 * `coilbox://` link arrives on.
 */
export function pathFromFileUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  // `file:///C:/Games/a.sdz` has the drive after a leading slash.
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path;
}

/** The content folder chosen for each kind, from `useWriteRoot`. */
export interface ArchiveRoots {
  gamesRoot?: string;
  mapsRoot?: string;
}

/** An archive coilbox has read and can install. */
export interface ArchiveOffer {
  path: string;
  kind: "game" | "map";
  fileName: string;
  destDir: string;
}

type Inspect = (args: { path: string } & ArchiveRoots) => Promise<{
  kind: "game" | "map";
  fileName: string;
  destDir: string;
}>;

/**
 * Read each file and sort it into what can be installed and what is refused,
 * with the reason. A path that is not a `.sdz` or `.sd7` is refused here without
 * asking the Rust side to open it.
 */
export async function planArchives(
  paths: string[],
  roots: ArchiveRoots,
  inspect: Inspect,
): Promise<{ offers: ArchiveOffer[]; refused: string[] }> {
  const offers: ArchiveOffer[] = [];
  const refused: string[] = [];
  for (const path of [...new Set(paths)]) {
    if (!isArchivePath(path)) {
      refused.push(`${basename(path)} is not a .sdz or .sd7 archive.`);
      continue;
    }
    try {
      offers.push({ path, ...(await inspect({ path, ...roots })) });
    } catch (e) {
      refused.push(errorText(e));
    }
  }
  return { offers, refused };
}

/** The words of the prompt for a set of offers. */
export function describeOffers(offers: ArchiveOffer[]): {
  title: string;
  lines: string[];
} {
  if (offers.length === 1) {
    const [only] = offers;
    return {
      title: `Install a ${only.kind}`,
      lines: [
        `Install the ${only.kind} ${only.fileName}?`,
        `It is copied to ${only.destDir}. The file you opened stays where it is.`,
      ],
    };
  }
  return {
    title: `Install ${offers.length} archives`,
    lines: [
      ...offers.map(
        (o) => `${o.fileName}, a ${o.kind}, is copied to ${o.destDir}.`,
      ),
      "The files you opened stay where they are.",
    ],
  };
}

/**
 * Copy each offer into place. One that fails does not stop the rest, and each
 * failure comes back with its reason.
 */
export async function installArchives(
  offers: ArchiveOffer[],
  roots: ArchiveRoots,
  install: (args: { path: string } & ArchiveRoots) => Promise<unknown>,
): Promise<{ installed: ArchiveOffer[]; failed: string[] }> {
  const installed: ArchiveOffer[] = [];
  const failed: string[] = [];
  for (const offer of offers) {
    try {
      await install({ path: offer.path, ...roots });
      installed.push(offer);
    } catch (e) {
      failed.push(errorText(e));
    }
  }
  return { installed, failed };
}
