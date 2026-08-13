/**
 * The half of `./EquivalentsPanel.tsx` that cannot be tested: this machine's
 * table for one game, and dropping from it (issue #1533).
 *
 * It takes the game's archive name, which is what every other caller of
 * `useEquivalents` hands over, so nothing here has to know that a table is
 * keyed by the game's shortname rather than by its archive.
 */

import { useEquivalents } from "../../equivalentsStore";
import { EquivalentsPanel } from "./EquivalentsPanel";

export function GameEquivalents({ gameArchive }: { gameArchive?: string }) {
  const { table, forget, forgetAll } = useEquivalents(gameArchive);
  return (
    <EquivalentsPanel table={table} onForget={forget} onForgetAll={forgetAll} />
  );
}
