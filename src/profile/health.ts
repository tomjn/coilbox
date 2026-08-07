import type { GameFilter, ProfileSource } from "./profile";

export type HealthStatus = "ok" | "warn" | "error" | "unknown";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  /** Short human explanation / next step, rendered as prose. */
  hint?: string;
  /** Verbatim technical detail (e.g. a JSON source excerpt), rendered monospace. */
  detail?: string;
}

/** One campaign that failed to load, with enough to find and fix it. */
export interface CampaignFailure {
  source: "bundled" | "local";
  /** The campaign's own `name`, or a placeholder when the JSON won't parse. */
  name: string;
  /** The parse or schema error explaining why it was rejected. */
  error: string;
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
  /** Monospace source excerpt pinpointing the parse error, when locatable. */
  profileErrorSnippet: string | null;
  gameFilter: GameFilter | undefined;
  roots: RootInput[];
  /**
   * The games a unitsync scan found, by the name a `gameFilter` matches, or null
   * when no scan has answered yet: no engine to scan with, or one that failed.
   *
   * Null rather than an empty list, because "nothing is installed" and "nobody
   * looked" are different answers and the panel exists to tell them apart
   * (issue #959).
   */
  installedGames: string[] | null;
  writeRootPath: string | undefined;
  campaignFailures: CampaignFailure[];
  writable: { writeRoot?: WritableResult; dataDir?: WritableResult };
  /** The profile's `hide` list (nav ids the bundler wants hidden). */
  hide: string[];
  /** Nav ids that actually opt into hiding — the set `hide` can affect. */
  hideableNavIds: string[];
  /** The profile's `hideSettings` list (settings-section ids to hide). */
  hideSettings: string[];
  /** Every settings-section id present in the app — the set `hideSettings` can affect. */
  settingsIds: string[];
  /** Non-empty `icon` names configured on the profile's links. */
  linkIcons: string[];
  /** The curated icon names links resolve against; others fall back to a generic glyph. */
  validIconNames: string[];
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

/**
 * Warn when a `hide` id matches no hideable nav item. Hiding is opt-in per nav item
 * (`isProfileHidden(id)`), so any other id — a typo, or a real-but-not-hideable item —
 * silently does nothing. Returns `null` when the profile hides nothing (no row, no
 * noise); "ok" when every id is hideable; "warn" naming each id that matches nothing.
 */
export function checkHideIds(
  hide: string[],
  hideable: string[],
): HealthCheck | null {
  if (hide.length === 0) return null;
  const unknown = hide.filter((id) => !hideable.includes(id));
  if (unknown.length === 0) {
    return {
      id: "hide",
      status: "ok",
      label: `Hide list: ${hide.length} id(s), all match a hideable feature`,
    };
  }
  return {
    id: "hide",
    status: "warn",
    label: `${unknown.length} hide id(s) match nothing`,
    hint: `${unknown
      .map((id) => `hide id '${id}' matches nothing`)
      .join("; ")}. Hideable ids: ${hideable.join(", ")}.`,
  };
}

/**
 * Warn when a `hideSettings` id matches no settings section. Every section id is
 * hideable, so this only catches typos / stale ids. Same shape as {@link checkHideIds}.
 */
export function checkHideSettingsIds(
  hideSettings: string[],
  settingsIds: string[],
): HealthCheck | null {
  if (hideSettings.length === 0) return null;
  const unknown = hideSettings.filter((id) => !settingsIds.includes(id));
  if (unknown.length === 0) {
    return {
      id: "hideSettings",
      status: "ok",
      label: `Hide settings: ${hideSettings.length} id(s), all match a section`,
    };
  }
  return {
    id: "hideSettings",
    status: "warn",
    label: `${unknown.length} hideSettings id(s) match nothing`,
    hint: `${unknown
      .map((id) => `hideSettings id '${id}' matches nothing`)
      .join("; ")}. Section ids: ${settingsIds.join(", ")}.`,
  };
}

/**
 * Warn when a link's `icon` isn't a curated name. An unknown icon silently falls back
 * to a generic glyph, so a typo looks like it worked. Compared case-insensitively, to
 * match how `resolveLinkIcon` looks the name up. `null` when no link sets an icon.
 */
export function checkLinkIcons(
  icons: string[],
  valid: string[],
): HealthCheck | null {
  if (icons.length === 0) return null;
  const validLower = valid.map((n) => n.toLowerCase());
  const unknown = icons.filter((n) => !validLower.includes(n.toLowerCase()));
  if (unknown.length === 0) {
    return {
      id: "linkIcons",
      status: "ok",
      label: `Link icons: ${icons.length} set, all recognised`,
    };
  }
  return {
    id: "linkIcons",
    status: "warn",
    label: `${unknown.length} link icon(s) unknown`,
    hint: `${unknown
      .map((n) => `link icon '${n}' is unknown — falls back to a generic icon`)
      .join("; ")}.`,
  };
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
      detail: i.profileErrorSnippet ?? undefined,
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
  } else if (i.installedGames === null) {
    checks.push({
      id: "gameFilter",
      status: "unknown",
      label: "Game filter not checked against anything",
      hint: "Nothing has scanned the content folders for games yet, so there is nothing to match the filter against. Install an engine, or open Content > Games and let the scan finish, then re-run this.",
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
      const installed = i.installedGames;
      const filterDesc = i.gameFilter.regex
        ? `regex /${i.gameFilter.regex}/i`
        : `names [${i.gameFilter.names?.join(", ")}]`;
      const sample = installed.slice(0, 8).join(", ");
      const more = installed.length > 8 ? ", …" : "";
      checks.push({
        id: "gameFilter",
        status: count === 0 ? "warn" : "ok",
        label: `Game filter matches ${count} installed game(s)`,
        hint:
          count === 0
            ? installed.length
              ? `Filter (${filterDesc}) matched none of the ${installed.length} installed game(s): ${sample}${more}. Adjust it to match one of these.`
              : `Filter (${filterDesc}) has nothing to match yet — no games are installed. Install the game, or check the filter.`
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
    const appDir = appDirOf(i.portableRoot);
    const inside =
      i.writeRootPath === appDir ||
      i.writeRootPath.startsWith(`${appDir}/`) ||
      i.writeRootPath.startsWith(`${appDir}\\`);
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
            hint: `Write root "${i.writeRootPath}" is outside the package ("${appDir}"). Downloads and release updates would land there, not with the package. Point the write root at a folder under the package.`,
          },
    );
  }

  // 6. Bundled campaign load errors
  {
    const failures = i.campaignFailures;
    checks.push(
      failures.length === 0
        ? { id: "campaigns", status: "ok", label: "All campaigns loaded" }
        : {
            id: "campaigns",
            status: "warn",
            label: `${failures.length} campaign(s) failed to load`,
            hint: "Fix the JSON in .coilbox/campaigns/ (bundled) or the app data campaigns folder (local):",
            detail: failures
              .map((f) => `${f.name} [${f.source}]: ${f.error}`)
              .join("\n"),
          },
    );
  }

  // 7. Playable content present
  {
    const engines = i.roots.reduce((n, r) => n + r.engineCount, 0);
    const games = i.installedGames?.length ?? 0;
    const scanned = i.roots.length
      ? `Scanned ${i.roots.length} content folder(s): ${i.roots.map((r) => r.path).join(", ")}.`
      : "No content folders are configured to scan.";
    if (engines === 0) {
      checks.push({
        id: "content",
        status: "warn",
        label: "No engine found",
        hint: `Install or bundle an engine — the game can't launch without one. ${scanned}`,
      });
    } else if (i.installedGames === null) {
      // An engine is there but no scan has answered. Counting the files in
      // `games/` instead would be the wrong answer twice over: an archive
      // unitsync refuses is not a game, and coilbox writes archives of its own.
      checks.push({
        id: "content",
        status: "unknown",
        label: `${engines} engine(s) found, games not scanned yet`,
        hint: `Nothing has scanned for games yet. Open Content > Games and let the scan finish, then re-run this. ${scanned}`,
      });
    } else if (games === 0) {
      checks.push({
        id: "content",
        status: "warn",
        label: "No games found",
        hint: `Bundle or download the game archive (.sdz/.sd7). ${scanned}`,
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

  // 9-11. Profile no-op advisories: configured values that silently do nothing.
  // Each returns null (no row) when its part of the profile is empty.
  for (const c of [
    checkHideIds(i.hide, i.hideableNavIds),
    checkHideSettingsIds(i.hideSettings, i.settingsIds),
    checkLinkIcons(i.linkIcons, i.validIconNames),
  ]) {
    if (c) checks.push(c);
  }

  return checks;
}
