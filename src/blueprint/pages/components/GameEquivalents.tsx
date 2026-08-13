/**
 * The half of `./EquivalentsPanel.tsx` that cannot be tested: this machine's
 * table for one game, and dropping from it (issue #1533).
 *
 * It takes the game's archive name, which is what every other caller of
 * `useEquivalents` hands over, so nothing here has to know that a table is
 * keyed by the game's shortname rather than by its archive.
 */

import { useState } from "react";
import { useEquivalents } from "../../equivalentsStore";
import { EquivalentsPanel } from "./EquivalentsPanel";

export function GameEquivalents({ gameArchive }: { gameArchive?: string }) {
  const { table, forget, forgetAll } = useEquivalents(gameArchive);

  // What is being hunted for is held here and nowhere else (issue #1547), so
  // leaving the page clears it and coming back opens on the whole table. A
  // search that outlived a visit would be a row hidden from somebody who never
  // typed anything.
  const [query, setQuery] = useState("");

  return (
    <EquivalentsPanel
      table={table}
      query={query}
      onQuery={setQuery}
      onForget={forget}
      onForgetAll={forgetAll}
    />
  );
}
