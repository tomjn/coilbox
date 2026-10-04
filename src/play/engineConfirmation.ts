/**
 * Whether the engine a launch names is installed, under the battle room's rule:
 * only a version the engine binary reported counts, and a folder name is not a
 * version (issue #3405).
 *
 * An engine that has not reported yet cannot be ruled in or out by its name, but
 * one in a folder named for the wanted version is probably it. So the answer can
 * be "ask that engine first". The caller asks, records what came back, and calls
 * again. Pure, so every outcome is tested without React or a Tauri command.
 */

import type { ContentRequirement } from "@/content/resolveContent";

export interface InstalledEngine {
  /** Identifies the engine to `contentVerifyEngine`. */
  executable: string;
  /** The folder's name. Only ever used to pick whom to ask. */
  folder: string;
  /** The version the engine binary reported, once it has. */
  verified?: string;
}

/** What asking one engine for its version came to. */
export interface Verification {
  executable: string;
  /** The version it reported, or null when it would not say. */
  reported: string | null;
  /** Why it would not say, when it gave a reason. */
  reason?: string;
}

export type EngineConclusion =
  /** The launch names no engine version, so there is nothing to confirm. */
  | { kind: "unaffected" }
  | { kind: "installed" }
  /** No engine reports the version. Offer the download. */
  | { kind: "missing" }
  /** Ask this engine for its version, then call again with the answer. */
  | { kind: "verify"; executable: string }
  /** An engine that may be the one would not say. Not installed and not missing:
   *  the check did not happen. */
  | { kind: "unconfirmed"; executable: string; reason: string };

/** Judge each engine requirement the way the requirement itself matches, so the
 *  replay's tolerant match and the exact one both keep their own meaning. */
export function concludeEngine(
  requirements: readonly ContentRequirement[],
  engines: readonly InstalledEngine[],
  verifications: readonly Verification[],
): EngineConclusion {
  const wanted = requirements.filter((r) => r.kind === "engine");
  if (wanted.length === 0) return { kind: "unaffected" };
  for (const req of wanted) {
    const conclusion = concludeOne(req, engines, verifications);
    if (conclusion.kind !== "installed") return conclusion;
  }
  return { kind: "installed" };
}

function concludeOne(
  req: ContentRequirement,
  engines: readonly InstalledEngine[],
  verifications: readonly Verification[],
): EngineConclusion {
  const satisfies = (version: string) =>
    req.isInstalled({ games: [], maps: [], engineVersions: [version] });

  if (engines.some((e) => e.verified && satisfies(e.verified))) {
    return { kind: "installed" };
  }

  // Only an engine that has not reported is asked, and only when its folder is
  // named for the version. The rest are neither read nor run.
  const candidates = engines.filter((e) => !e.verified && satisfies(e.folder));
  const answers = candidates.map((e) => ({
    engine: e,
    answer: verifications.find((v) => v.executable === e.executable),
  }));

  if (answers.some((a) => a.answer?.reported && satisfies(a.answer.reported))) {
    return { kind: "installed" };
  }
  const next = answers.find((a) => !a.answer);
  if (next) return { kind: "verify", executable: next.engine.executable };

  const silent = answers.find((a) => a.answer && a.answer.reported === null);
  if (silent) {
    const why = silent.answer?.reason ?? "it did not report a version";
    return {
      kind: "unconfirmed",
      executable: silent.engine.executable,
      reason: `Could not confirm that engine ${req.label} is installed: ${why}`,
    };
  }
  return { kind: "missing" };
}
