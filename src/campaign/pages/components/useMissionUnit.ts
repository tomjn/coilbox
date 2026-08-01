/**
 * Resolve the model a mission's unit slot draws, by the game the mission
 * launches and the def the author picked.
 *
 * The campaign-side twin of {@link useMissionMapAssets}: it reads through the
 * same unitsync scan the launcher uses, keyed by the mission's own
 * `snapshot.gameName`, so a briefing draws the unit out of the game it is about
 * to start rather than whatever else is installed. The def list and the model
 * read are both the ones the scenario editor and the content browser already
 * use, so a unit already read for one of those is not read again here.
 */

import type { UnitModelResult } from "@/content/bindings";
import { useUnitsyncUnitModel } from "@/content/config";
import { countTriangles } from "@/content/unitModel";
import { usePreferredTarget } from "@/play/config";
import { useGameUnits } from "@/scenario/pages/components/useGameUnits";
import type { UnitPreviewConfig } from "../../model";

export interface MissionUnit {
  /** The model to draw, or null while it is being read or when there is none. */
  model: UnitModelResult | null;
  /** A read is in flight, so `model` being null is not yet an answer. */
  loading: boolean;
  /**
   * There is nothing to draw and waiting will not help: the game is not
   * installed, it has no unit by that name, that unit names no model, or the
   * model came back empty or unreadable. A briefing falls back on this, and the
   * editor says which slot could not be drawn.
   */
  unavailable: boolean;
}

export function useMissionUnit(
  gameName: string,
  config?: UnitPreviewConfig,
): MissionUnit {
  const { target } = usePreferredTarget();
  // A slot with no unit asks about no game, so a briefing that shows an image
  // never reads a game's unit list to find that out.
  const wanted = config?.unitDef.trim().toLowerCase() ?? "";
  const {
    units,
    loading: unitsLoading,
    archive,
  } = useGameUnits(wanted ? gameName : "");

  const entry = units.find((u) => u.name.toLowerCase() === wanted);
  const object = entry?.objectName?.trim();

  const { model, loading } = useUnitsyncUnitModel(
    target?.enginePath,
    target?.dataDir,
    archive,
    object,
  );

  // A model with pieces but no faces draws as nothing at all, which is the
  // viewer's own test for "there is no point showing a viewport for this".
  const drawable = !!model?.root && countTriangles(model.root) > 0;
  const reading = unitsLoading || loading;

  return {
    model: drawable ? model : null,
    loading: reading,
    unavailable: wanted !== "" && !reading && !drawable,
  };
}
