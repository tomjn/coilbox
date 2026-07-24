import { mpAddBot } from "../bindings";
import { hexToColorInt } from "./config";
import type { HostSeedBot } from "./fromSkirmish";

/**
 * Add every bot in a `HostSeed` via `mp_add_bot`, best-effort: one bot failing
 * to add (e.g. the game rejects its `aiDll`) doesn't stop the rest, so a
 * preset with three good bots and one bad one still gets the three good ones
 * rather than leaving a half-set-up room silently. Returns the per-bot
 * failure messages (empty when every bot was added).
 */
export async function addHostSeedBots(
  serverKey: string,
  bots: HostSeedBot[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const bot of bots) {
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
