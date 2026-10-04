/**
 * What a launch needs installed, said one way for every launch path (issue
 * #3364). A skirmish, a campaign mission, a scenario, a Conquest or Warpath
 * battle and a replay all come down to an engine, a game and a map, so they
 * all ask through here and get the same answer.
 *
 * This is a thin front for `content/resolveContent.ts`, not a second resolver:
 * it builds the requirement list that module already knows how to diff. Pure,
 * so "what is missing, given what is installed" is tested without React.
 * `LaunchContentProvider.tsx` holds the drawer that downloads what is missing.
 *
 * There is no skirmish AI in here on purpose. A native AI ships inside the
 * engine folder and a Lua AI inside the game archive, so neither can be
 * downloaded apart from the engine or game this already asks for, and the
 * downloads plugin has no AI kind. A roster naming an AI the game does not
 * offer is still handled by `reconcileParticipantAis`, which has to run after
 * this check: it reads the game's AI list, and a game that was just downloaded
 * has none until then.
 */

import {
  type ContentRequirement,
  computeMissingRequirements,
  engineVersionRequirement,
  exactMapRequirement,
  type InstalledContentSnapshot,
  launchGameRequirement,
} from "@/content/resolveContent";
import type { PlayTarget } from "./config";

/** The engine, game and map one launch needs. Leave out what it does not pin:
 *  a skirmish runs on whichever engine is preferred, so it names no version. */
export interface LaunchNeeds {
  /** An engine version the launch only works on, such as a replay's. */
  engineVersion?: string;
  /** The game's full name, version included, as a start script names it. */
  game?: string;
  map?: string;
}

/**
 * The requirements for a launch, matched by exact name.
 *
 * A caller that matches some other way, a game by shortname or an engine by
 * release number, builds that one `ContentRequirement` itself and passes the
 * list on. Everything downstream takes requirements, not `LaunchNeeds`.
 */
export function launchRequirements(needs: LaunchNeeds): ContentRequirement[] {
  const out: ContentRequirement[] = [];
  const engine = needs.engineVersion?.trim();
  if (engine) out.push(engineVersionRequirement(engine));
  if (needs.game) out.push(launchGameRequirement(needs.game));
  if (needs.map) out.push(exactMapRequirement(needs.map));
  return out;
}

/** What a launch needs that this machine does not have. Empty means it can
 *  start. `installed` must be a real reading: see `resolveVerdict` for why an
 *  empty snapshot from a scan that has not answered is not one. */
export function missingLaunchContent(
  needs: LaunchNeeds,
  installed: InstalledContentSnapshot,
): ContentRequirement[] {
  return computeMissingRequirements(launchRequirements(needs), installed);
}

/**
 * The dependency archive an installed game lacks, for a launch path that keeps
 * its own check of the game and map but must still stop here (issue #3489). It
 * asks the same question `missingLaunchContent` does, so the rule is one. Null
 * when the game is not installed, which that path reports as a missing game.
 */
export function missingLaunchDependency(
  game: string,
  games: InstalledContentSnapshot["games"],
): ContentRequirement | null {
  return (
    missingLaunchContent(
      { game },
      { games, maps: [], engineVersions: [] },
    ).find((r) => r.kind === "dependency") ?? null
  );
}

/**
 * Which engine reads the install, and which one the launch runs.
 *
 * They differ only while a launch names an engine version that is not
 * installed. There is nothing to run yet, but the games and maps can still be
 * read through any other engine, so a missing game is listed beside the missing
 * engine instead of turning up after the engine has downloaded.
 *
 * An engine is matched with the requirement's own `isInstalled`, so the engine
 * that satisfies the check is by construction the one that gets run. Only an
 * engine that reported its version can match, the battle room's rule (issue
 * #3405). Callers that name a version confirm an engine in a folder of that name
 * first, through `concludeEngine`.
 */
export function launchTargets(
  requirements: readonly ContentRequirement[],
  installed: readonly PlayTarget[],
  fallback: PlayTarget | null,
): { scan: PlayTarget | null; run: PlayTarget | null } {
  const engines = requirements.filter((r) => r.kind === "engine");
  if (engines.length === 0) return { scan: fallback, run: fallback };
  const run =
    installed.find((t) =>
      engines.every((r) =>
        r.isInstalled({
          games: [],
          maps: [],
          // Only a version the engine reported. A folder name is not one.
          engineVersions: t.syncVersion ? [t.syncVersion] : [],
        }),
      ),
    ) ?? null;
  return { scan: run ?? fallback, run };
}

/** How a launch's content check ended. */
export type LaunchContentResult =
  /** Everything is installed. `target` is the engine to launch with, read after
   *  any download, so use it in place of one captured before the check. */
  | { ready: true; target: PlayTarget }
  /**
   * The launch must not go ahead. `cancelled` is the player closing the
   * drawer. `no-engine` is a machine with no engine to run and no version named
   * to download, which the calling page has to say for itself.
   */
  | { ready: false; reason: "cancelled" | "no-engine" };
