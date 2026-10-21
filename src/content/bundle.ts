import { t } from "@lingui/core/macro";
import type { EnqueueInput } from "../downloads/DownloadQueueProvider";
import type { BundledEngine, BundleProblem, BundleReport } from "./bindings";

/**
 * A distribution's bundled content (issue #3668): `.coilbox/content`, laid out
 * like a Spring data directory. Games, maps and rapid packages are read where
 * they sit. The engine for this platform is copied once into the player's
 * download destination before anything needs it, and this module decides which
 * engine that is and how the queue is asked to copy it.
 *
 * Pure, so the decisions are testable without the queue or Tauri.
 */

/** The platform folder names a bundle may use, the ones pr-downloader writes. */
export const BUNDLE_PLATFORMS = [
  "linux64",
  "linux_arm64",
  "windows64",
  "windows_arm64",
  "macos_arm64",
] as const;

/**
 * The bundled engines to copy now: those for this machine that the player does
 * not already have. Usually one. A distribution that carries two for the same
 * platform gets both, since it shipped them for a reason, and the queue copies
 * them one after the other.
 */
export function enginesToInstall(report: BundleReport | null): BundledEngine[] {
  return (report?.engines ?? []).filter(
    (e) => e.forThisPlatform && !e.installed,
  );
}

/** What the player reads while the copy runs, in the setup card and the queue. */
export function bundledEngineLabel(engine: BundledEngine): string {
  const version = engine.version;
  return t`Setting up engine ${version}`;
}

/** The queue request that copies `engine` into `writePath`. */
export function bundledEngineInput(
  engine: BundledEngine,
  writePath: string,
): EnqueueInput {
  return {
    kind: "engineBundled",
    label: bundledEngineLabel(engine),
    args: {
      version: engine.version,
      platform: engine.platform ?? null,
      writePath,
    },
    sizeBytes: engine.bytes,
  };
}

/**
 * One problem as a line of the health checklist, written for the person who
 * built the package. Paths are relative to `.coilbox/content/`.
 */
export function bundleProblemText(p: BundleProblem): string {
  switch (p.kind) {
    case "empty":
      return t`The folder is empty. Copy engine/, games/ and maps/ into it from a working install.`;
    case "looseArchive": {
      const path = p.path;
      return t`${path} sits at the top of the folder. Move it into games/ or maps/, or nothing will find it.`;
    }
    case "stray": {
      const path = p.path;
      return t`${path} is not part of a Spring data directory, so nothing reads it. The folder holds engine/, games/, maps/, packages/ and pool/.`;
    }
    case "packagesWithoutPool":
      return t`packages/ has rapid packages but there is no pool/ beside it. Copy pool/ too, or the packages cannot be read.`;
    case "looseGame": {
      const path = p.path;
      return t`${path} is a loose .sdd game. It is read in place, but coilbox does not write into this folder, so scenario missions cannot be installed into it. Ship the game as .sdz or .sd7, or keep the .sdd in the app folder's games/ instead.`;
    }
    case "unknownPlatform": {
      const path = p.path;
      const platforms = BUNDLE_PLATFORMS.join(", ");
      return t`${path} is not a platform folder, so its engine is never used. Use one of ${platforms}.`;
    }
    case "engineAtTop":
      return t`An engine sits at the top of the folder. Move it into engine/<platform>/<version>/.`;
    case "unreadableEngine": {
      const path = p.path;
      const detail = p.detail;
      return detail
        ? t`${path} cannot be copied: ${detail}`
        : t`${path} cannot be copied.`;
    }
    case "noEngineForThisPlatform": {
      const platform = p.detail ?? t`this machine`;
      const folder = p.detail ?? "<platform>";
      return t`The bundled engines are all for other platforms, so a player on ${platform} downloads one on first run. Add engine/${folder}/<version>/ to bundle it.`;
    }
  }
}
