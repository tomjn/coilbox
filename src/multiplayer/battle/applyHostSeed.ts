import { mpAddBot } from "../bindings";
import { hexToColorInt } from "./config";
import type { HostSeedBot } from "./fromSkirmish";

/**
 * Add every bot in a `HostSeed` via `mp_add_bot`, best-effort: one bot failing
 * to add (e.g. the game rejects its `aiDll`) doesn't stop the rest, so a
 * preset with three good bots and one bad one still gets the three good ones
 * rather than leaving a half-set-up room silently. Returns the per-bot
 * failure messages (empty when every bot was added).
 *
 * `existingBotNames` makes a re-run idempotent: a bot already in the battle is
 * skipped rather than re-added. The caller's own re-run guard is in-memory
 * (a ref keyed on the battle id), so it resets on a full page reload (seen
 * live via a failed HMR update) while the actual battle, held by the Rust
 * side, still has the bots from the first run. Without this, the second run's
 * `ADDBOT` for an already-present name is rejected by the server as a genuine
 * failure and surfaced to the host, even though the room is already correct.
 */
export async function addHostSeedBots(
  serverKey: string,
  bots: HostSeedBot[],
  existingBotNames: Iterable<string> = [],
): Promise<string[]> {
  const existing = new Set(existingBotNames);
  const failures: string[] = [];
  for (const bot of bots) {
    if (existing.has(bot.name)) continue;
    try {
      await mpAddBot({
        serverKey,
        name: bot.name,
        ready: true,
        teamId: bot.teamId,
        ally: bot.ally,
        mode: true,
        handicap: bot.handicap,
        sync: 1,
        side: bot.side,
        color: hexToColorInt(bot.colorHex),
        aiDll: bot.aiDll,
      });
    } catch (e) {
      failures.push(
        `${bot.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return failures;
}
