import { Button, useDrawer } from "@picoframe/frame";
import { useMemo } from "react";
import type {
  Side,
  UnitBuildpicsResult,
  UnitDatasetEntry,
} from "../../bindings";
import { buildEdgeMap, reachableCounts } from "../../buildTree";
import { BuildTreeDrawer } from "./BuildTreeDrawer";

/**
 * The per-faction build-tree buttons, extracted from GameDetailPage so the game detail
 * screen and the `@widget/faction-button` / `@widget/build-tree` embeds (issue #274)
 * share one implementation. Each button shows a faction's start unit + reachable-unit
 * count and opens the {@link BuildTreeDrawer} on that faction. The drawer-open params
 * (engine/dataDir/archive/game name) plus the full sides + unit dataset are passed
 * through; counts and icons are derived here so callers don't duplicate that.
 */

/** Everything a build button needs to open the shared drawer on a given faction. */
interface BuildContext {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
}

/** One faction: a button that opens the build-tree drawer starting on that side. */
export function FactionBuildButton({
  ctx,
  side,
  icon,
  unitLabel,
  count,
}: {
  ctx: BuildContext;
  side: Side;
  icon?: string;
  unitLabel?: string;
  count: number;
}) {
  const drawer = useDrawer();
  const open = () =>
    drawer.open({
      title: `${ctx.gameName} — Build tree`,
      description:
        "Units each faction's commander can build, directly or indirectly.",
      width: "72rem",
      content: (
        <BuildTreeDrawer
          enginePath={ctx.enginePath}
          dataDir={ctx.dataDir}
          gameArchive={ctx.gameArchive}
          sides={ctx.sides}
          units={ctx.units}
          initialSide={side.name}
        />
      ),
    });
  return (
    <Button
      type="button"
      variant="outline"
      disabled={count === 0}
      onClick={open}
      className="h-auto w-full justify-between gap-3 p-3"
    >
      <span className="flex items-center gap-3">
        {icon && (
          <img
            src={icon}
            alt=""
            className="h-16 w-16 shrink-0 rounded object-contain"
          />
        )}
        <span className="font-medium">{side.name}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
        {count > 0 && <span>{count} units</span>}
        {unitLabel && <span>{unitLabel}</span>}
      </span>
    </Button>
  );
}

/** The list of faction build buttons for a game's sides. */
export function FactionBuildList({
  enginePath,
  dataDir,
  gameArchive,
  gameName,
  sides,
  units,
  buildpics,
}: {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  buildpics: UnitBuildpicsResult | null;
}) {
  const ctx: BuildContext = {
    enginePath,
    dataDir,
    gameArchive,
    gameName,
    sides,
    units,
  };
  // Units reachable from each faction's commander via buildoptions. Omitted (and the
  // button left inert) when the dataset is still loading or the game exposes no
  // buildoptions (0).
  const counts = useMemo(
    () => reachableCounts(sides, buildEdgeMap(units)),
    [sides, units],
  );
  return (
    <ul className="flex flex-col gap-2">
      {sides.map((s) => {
        const icon = s.startUnit
          ? buildpics?.units[s.startUnit]?.icon
          : undefined;
        // Prefer the unitdef's human name; fall back to the engine's start-unit
        // name, then the internal id.
        const unitLabel =
          (s.startUnit && buildpics?.units[s.startUnit]?.name) ||
          s.startUnitName ||
          s.startUnit;
        return (
          <li key={s.name}>
            <FactionBuildButton
              ctx={ctx}
              side={s}
              icon={icon}
              unitLabel={unitLabel}
              count={counts.get(s.name) ?? 0}
            />
          </li>
        );
      })}
    </ul>
  );
}
