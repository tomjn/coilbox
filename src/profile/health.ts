import type { GameFilter, ProfileSource } from "./profile";

export type HealthStatus = "ok" | "warn" | "error" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  hint?: string;
}

/** A writability probe result for one folder (from `dlPathWritable`). */
export interface WritableResult {
  writable: boolean;
  error?: string | null;
}

/** A content root reduced to what the checks need. */
export interface RootInput {
  path: string;
  portable: boolean;
  engineCount: number;
}

/** Everything the checks derive from. Assembled by `useHealthChecks`. */
export interface HealthInputs {
  /** `<app_dir>/.coilbox`, or "" when not portable. */
  portableRoot: string;
  profileSource: ProfileSource;
  profileError: string | null;
  gameFilter: GameFilter | undefined;
  roots: RootInput[];
  installedGames: string[];
  writeRootPath: string | undefined;
  campaignFailures: { bundled: number; local: number };
  writable: { writeRoot?: WritableResult; dataDir?: WritableResult };
}

/** Strip the trailing `.coilbox` segment to get the app dir the package sits in. */
function appDirOf(portableRoot: string): string {
  return portableRoot.replace(/[/\\]\.coilbox\/?$/, "");
}

function countFilterMatches(
  filter: GameFilter,
  games: string[],
): { count: number; regexError?: string } {
  let re: RegExp | undefined;
  if (filter.regex) {
    try {
      re = new RegExp(filter.regex, "i");
    } catch (e) {
      return {
        count: 0,
        regexError: e instanceof Error ? e.message : String(e),
      };
    }
  }
  const names = filter.names?.map((n) => n.toLowerCase()) ?? [];
  const count = games.filter((g) => {
    const lower = g.toLowerCase();
    return names.includes(lower) || (re?.test(g) ?? false);
  }).length;
  return { count };
}

export function deriveHealthChecks(i: HealthInputs): HealthCheck[] {
  const portable = i.portableRoot !== "";
  const checks: HealthCheck[] = [];

  // 1. Portable mode
  checks.push(
    portable
      ? {
          id: "portable",
          status: "ok",
          label: `Portable mode active — ${i.portableRoot}`,
        }
      : {
          id: "portable",
          status: "unknown",
          label: "Not portable (standard per-user install)",
        },
  );

  // 2. Profile source / parse error
  if (i.profileError && i.profileSource === "file") {
    checks.push({
      id: "profile",
      status: "error",
      label: "profile.json failed to parse",
      hint: i.profileError,
    });
  } else if (i.profileError) {
    checks.push({
      id: "profile",
      status: "error",
      label: "Profile failed to load",
      hint: i.profileError,
    });
  } else {
    checks.push({
      id: "profile",
      status: i.profileSource === "default" ? "unknown" : "ok",
      label:
        i.profileSource === "default"
          ? "No distribution profile loaded"
          : `Profile loaded from ${i.profileSource}`,
    });
  }

  // 3. Content roots (portable coverage)
  if (i.roots.length === 0) {
    checks.push({
      id: "roots",
      status: "warn",
      label: "No content folders configured",
      hint: "Add a Content Folder so Coilbox can find the game.",
    });
  } else {
    const portableRoots = i.roots.filter((r) => r.portable).length;
    const label = `${i.roots.length} content folder(s), ${portableRoots} portable`;
    checks.push(
      portable && portableRoots === 0
        ? {
            id: "roots",
            status: "warn",
            label,
            hint: "No content folder is portable — nothing would ship with the package. Tick Portable on the bundled folder.",
          }
        : { id: "roots", status: "ok", label },
    );
  }

  // 4. Game filter reality check
  if (!i.gameFilter || (!i.gameFilter.regex && !i.gameFilter.names?.length)) {
    checks.push({
      id: "gameFilter",
      status: "unknown",
      label: "No game filter set",
    });
  } else {
    const { count, regexError } = countFilterMatches(
      i.gameFilter,
      i.installedGames,
    );
    if (regexError) {
      checks.push({
        id: "gameFilter",
        status: "error",
        label: "Game filter regex is invalid",
        hint: `Invalid regex: ${regexError}`,
      });
    } else {
      checks.push({
        id: "gameFilter",
        status: count === 0 ? "warn" : "ok",
        label: `Game filter matches ${count} installed game(s)`,
        hint:
          count === 0
            ? "Check the regex/names, or install the game."
            : undefined,
      });
    }
  }

  // 5. Write root portable
  if (!portable) {
    checks.push({
      id: "writeRoot",
      status: "unknown",
      label: "Write root portability n/a (not portable)",
    });
  } else if (i.writeRootPath === undefined) {
    checks.push({
      id: "writeRoot",
      status: "unknown",
      label: "No download write root set",
    });
  } else {
    const inside = i.writeRootPath.startsWith(appDirOf(i.portableRoot));
    checks.push(
      inside
        ? {
            id: "writeRoot",
            status: "ok",
            label: "Download write root is inside the package",
          }
        : {
            id: "writeRoot",
            status: "warn",
            label: "Download write root is outside the package",
            hint: "Downloads and release updates would land outside the package. Point the write root at a bundled folder.",
          },
    );
  }

  // 6. Bundled campaign load errors
  {
    const total = i.campaignFailures.bundled + i.campaignFailures.local;
    checks.push(
      total === 0
        ? { id: "campaigns", status: "ok", label: "All campaigns loaded" }
        : {
            id: "campaigns",
            status: "warn",
            label: `${total} campaign(s) failed to load`,
            hint: "Check the JSON in .coilbox/campaigns/.",
          },
    );
  }

  // 7. Playable content present
  {
    const engines = i.roots.reduce((n, r) => n + r.engineCount, 0);
    const games = i.installedGames.length;
    if (engines === 0) {
      checks.push({
        id: "content",
        status: "warn",
        label: "No engine found",
        hint: "Install or bundle an engine — the game can't launch without one.",
      });
    } else if (games === 0) {
      checks.push({
        id: "content",
        status: "warn",
        label: "No games found",
        hint: "Bundle or download the game archive (.sdz/.sd7).",
      });
    } else {
      checks.push({
        id: "content",
        status: "ok",
        label: `${engines} engine(s), ${games} game(s) found`,
      });
    }
  }

  // 8. Folders writable
  {
    const probes = [i.writable.writeRoot, i.writable.dataDir].filter(
      (p): p is WritableResult => p !== undefined,
    );
    if (probes.length === 0) {
      checks.push({
        id: "writable",
        status: "unknown",
        label: "Folder writability not checked",
      });
    } else {
      const bad = probes.find((p) => !p.writable);
      checks.push(
        bad
          ? {
              id: "writable",
              status: "error",
              label: "A folder is read-only",
              hint: `Downloads and updates will fail — the folder is read-only (${bad.error ?? "not writable"}). Move the package somewhere writable — not a mounted disk image or a protected system folder.`,
            }
          : {
              id: "writable",
              status: "ok",
              label: "Download + data folders are writable",
            },
      );
    }
  }

  return checks;
}
