/**
 * The game a built unit is tested against. Kept as an app setting by the Test
 * drawer. It is not the unit's game: movement classes come from `unitGame`
 * (issue #4172).
 */

import { useSetting } from "@picoframe/frame";
import { useUnitsyncScan } from "../../../content/config";
import { withoutGeneratedGames } from "../../../lib/generatedGames";
import { usePreferredTarget } from "../../../play/config";

/**
 * Two installed archives can carry the same map or game name. A start script
 * names one, so the second is the same choice offered twice.
 */
export function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

export function useTestGame() {
  const { target, loading: targetLoading } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // Remembered app-wide rather than on the unit: which game and map you test
  // against is a habit, not a property of the thing being built.
  const [gameName, setGameName] = useSetting<string>("lego.testGame", "");

  // The scratch game is itself a game, so it comes back in every scan. Offering
  // it as a base would nest it inside itself, and the scenario editor's test
  // mutator is no better a base than this one is.
  const games = uniqueByName(withoutGeneratedGames(scan.data?.games ?? []));
  const game = games.find((g) => g.name === gameName) ?? games[0];

  return { target, targetLoading, scan, games, game, setGameName };
}
