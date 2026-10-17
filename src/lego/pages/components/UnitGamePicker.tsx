/**
 * Which game the unit is for, in the builder's title card (issue #3257).
 *
 * "No game" is an option like any other, not a placeholder: a unit of parts
 * needs no game. A change the unit cannot take, such as leaving the game its
 * pieces came out of, is refused here with the reason, and nothing changes.
 * A recorded game that is not installed stays selectable so the card can name
 * it.
 */

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LegoProject, LegoUnitGame } from "../../model";
import { gameChangeRefusal, gameRecordFor, unitGame } from "../../unitGame";
import { useTestGame } from "./useTestGame";

/** Radix's select has no empty value, so "No game" needs one of its own. */
const NO_GAME = "coilbox:no-game";

interface Props {
  project: LegoProject;
  onChange: (game: LegoUnitGame | null) => void;
}

export function UnitGamePicker({ project, onChange }: Props) {
  const { games, scan } = useTestGame();
  const [refusal, setRefusal] = useState<string | null>(null);
  const current = unitGame(project);
  const installed = games.some(
    (g) => current && g.primaryArchive.name === current.archive,
  );

  function pick(value: string) {
    const item = games.find((g) => g.primaryArchive.name === value);
    if (value !== NO_GAME && !item) return;
    const next = item ? gameRecordFor(item, scan.data?.games ?? []) : null;
    const refused = gameChangeRefusal(project, next, scan.data?.games ?? []);
    setRefusal(refused);
    if (!refused) onChange(next);
  }

  return (
    <div className="px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span>for</span>
        <Select value={current?.archive ?? NO_GAME} onValueChange={pick}>
          <SelectTrigger
            size="sm"
            className="h-5 w-48 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
            aria-label="Game"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GAME}>No game</SelectItem>
            {current && !installed ? (
              <SelectItem value={current.archive}>
                {current.name} (not installed)
              </SelectItem>
            ) : null}
            {games.map((g) => (
              <SelectItem
                key={g.primaryArchive.name}
                value={g.primaryArchive.name}
              >
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {refusal ? (
        <p role="alert" className="max-w-72 text-destructive">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
