/**
 * What goes into the unit's definition in the game, apart from how it moves on
 * screen (issue #4534): movement, who builds it, what it is worth, its weapons,
 * its stats and how they fit the game. They used to sit at the foot of the
 * Animation panel, among the walk cycles and poses.
 */

import { useMemo } from "react";
import type { LegoMovement, LegoPieceWeapon, LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { unitBounds } from "../../s3oBuild";
import type { LegoWorth } from "../../worth";
import { BuiltBySection } from "./BuiltBySection";
import { GameFitSection } from "./GameFitSection";
import { MovementSection } from "./MovementSection";
import type { ReferenceUnit } from "./ReferencePicker";
import { StatsSection } from "./StatsSection";
import { WeaponsSection } from "./WeaponsSection";
import { WorthSection } from "./WorthSection";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The movement class, speed and turn rate, or nothing for a unit that
   *  does not move (issue #3255). */
  onMovementChange: (movement: LegoMovement | undefined) => void;
  /** The table that sets the unit's health, cost and mass (issue #3280). */
  onWorthChange: (worth: LegoWorth) => void;
  /** Sets or clears the chassis budget (issue #3284). */
  onBudgetChange?: (budget: number | undefined) => void;
  /** What a turret or aim point fires, and over what arc (issue #3274). The
   *  Weapons section is shown only when this is given. */
  onWeaponChange?: (pieceId: string, weapon: LegoPieceWeapon) => void;
  /** Which base game units build this one (issue #4515). The Built by
   *  section is shown only when this is given. */
  onBuiltByChange?: (builtBy: string[]) => void;
  /** The game unit picked beside the build, for the stats to compare with. */
  referenceUnit?: ReferenceUnit | null;
}

export function GamePanel({
  project,
  pack,
  raw,
  onMovementChange,
  onWorthChange,
  onBudgetChange,
  onWeaponChange,
  onBuiltByChange,
  referenceUnit,
}: Props) {
  const bounds = useMemo(
    () => unitBounds(project, pack, raw),
    [project, pack, raw],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <MovementSection
        project={project}
        bounds={bounds}
        onMovementChange={onMovementChange}
      />

      {onBuiltByChange ? (
        <BuiltBySection project={project} onBuiltByChange={onBuiltByChange} />
      ) : null}

      <WorthSection
        project={project}
        pack={pack}
        onWorthChange={onWorthChange}
      />

      {onWeaponChange ? (
        <WeaponsSection project={project} onWeaponChange={onWeaponChange} />
      ) : null}

      <StatsSection
        project={project}
        pack={pack}
        bounds={bounds}
        reference={referenceUnit ?? null}
        onBudgetChange={onBudgetChange}
      />

      <GameFitSection project={project} bounds={bounds} />
    </div>
  );
}
