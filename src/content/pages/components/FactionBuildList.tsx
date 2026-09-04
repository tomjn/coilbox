import { Button, buttonVariants, cn, useDrawer } from "@picoframe/frame";
import { useMemo } from "react";
import { Link } from "react-router";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import type {
  Side,
  UnitBuildpicsResult,
  UnitDatasetEntry,
} from "../../bindings";
import type { BrandingEntry } from "../../branding";
import { buildEdgeMap, reachableCounts } from "../../buildTree";
import { foldMorphs, groupOf, morphGroups } from "../../morphGraph";
import { unitIconSrc } from "../../unitIcon";
import { BuildTreeDrawer } from "./BuildTreeDrawer";

/**
 * The per-faction build-tree buttons, extracted from GameDetailPage so the game detail
 * screen and the `@widget/faction-button` / `@widget/build-tree` embeds (issue #274)
 * share one implementation. Each faction shows its start unit + reachable-unit count
 * next to two equal-weight actions: one opens the {@link BuildTreeDrawer} on that
 * faction, the other links to the units grid narrowed to it (`?faction=<startUnit>`,
 * the same id `encyclopediaSections` keys its blocks on). The drawer-open params
 * (engine/dataDir/archive/game name) plus the full sides + unit dataset are passed
 * through, and counts and icons are derived here so callers don't duplicate that.
 */

/** Everything a build button needs to open the shared drawer on a given faction. */
interface BuildContext {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  /** Resolved faction emblems, keyed by lowercased side name (may be omitted). */
  factionLogos?: Record<string, FactionLogoSrc>;
  /** Resolved catalog entry, for the drawer's HTML export branded wrapper. */
  branding?: BrandingEntry | null;
}

/** One faction: a button that opens the build-tree drawer starting on that side. */
function FactionBuildButton({
  ctx,
  side,
  icon,
  logo,
  unitLabel,
  count,
}: {
  ctx: BuildContext;
  side: Side;
  icon?: string;
  logo?: FactionLogoSrc;
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
          factionLogos={ctx.factionLogos}
          gameName={ctx.gameName}
          branding={ctx.branding}
        />
      ),
    });
  // The units grid keys a faction's block on its start unit id
  // (`encyclopediaSections`), so that id is what narrows the grid to this side
  // alone. A side reporting no start unit has no block of its own to narrow
  // to, so this falls back to the same disabled treatment as a 0 count below
  // rather than linking to a filter that would just come back empty.
  const browseHref = side.startUnit
    ? `/content/games/${encodeURIComponent(ctx.gameName)}/units?faction=${encodeURIComponent(side.startUnit)}`
    : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          {icon && (
            <img
              src={icon}
              alt=""
              className="h-16 w-16 shrink-0 rounded object-contain"
            />
          )}
          <span className="flex items-center gap-2 font-medium">
            {logo && <FactionLogo logo={logo} sideName={side.name} size={20} />}
            {side.name}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
          {count > 0 && <span>{count} units</span>}
          {unitLabel && <span>{unitLabel}</span>}
        </span>
      </div>
      {/* Equal weight: the drawer answers "what does this faction lead to",
          the grid answers "what does this faction have", and neither is the
          other's afterthought. Sized to their labels and pushed to the right
          edge of the row rather than stretched full-width, or a two-word
          button reads as a banner rather than an action. */}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={count === 0}
          onClick={open}
        >
          Build tree
        </Button>
        {browseHref && count > 0 ? (
          <Link
            to={browseHref}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Browse units
          </Link>
        ) : (
          <Button type="button" variant="outline" disabled>
            Browse units
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Units reachable from each side's commander via buildoptions, with each morph
 * group folded onto its base so an upgrade stage's build options count under
 * the commander rather than a stage of its own (issue #2063). A side maps to 0
 * when the dataset is still loading, the game exposes no buildoptions, or (as
 * on Zero-K) the engine reports a start unit the dataset never defines.
 * Exported so `GameDetailPage` can tell "every side is dead" from "some are"
 * using the exact numbers the buttons below disable on, rather than a second
 * guess at the same reachability.
 */
export function useFactionReachableCounts(
  sides: Side[],
  units: UnitDatasetEntry[],
) {
  return useMemo(() => {
    // The engine's reported start unit can be any stage of its morph group,
    // not necessarily the base the folded edge map keys its node on, so it's
    // resolved here first or the lookup misses and the count reads 0.
    const morphBase = groupOf(morphGroups(units));
    const resolvedSides = sides.map((s) => {
      const startUnit = s.startUnit?.toLowerCase();
      return startUnit
        ? { ...s, startUnit: morphBase.get(startUnit) ?? startUnit }
        : s;
    });
    return reachableCounts(
      resolvedSides,
      foldMorphs(units, buildEdgeMap(units)),
    );
  }, [sides, units]);
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
  factionLogos,
  branding,
}: {
  enginePath: string;
  dataDir: string;
  gameArchive: string;
  gameName: string;
  sides: Side[];
  units: UnitDatasetEntry[];
  buildpics: UnitBuildpicsResult | null;
  /** Resolved faction emblems, keyed by lowercased side name (may be empty). */
  factionLogos?: Record<string, FactionLogoSrc>;
  /** Resolved catalog entry, for the drawer's HTML export branded wrapper. */
  branding?: BrandingEntry | null;
}) {
  const ctx: BuildContext = {
    enginePath,
    dataDir,
    gameArchive,
    gameName,
    sides,
    units,
    factionLogos,
    branding,
  };
  const counts = useFactionReachableCounts(sides, units);
  return (
    <ul className="flex flex-col gap-2">
      {sides.map((s) => {
        const icon = s.startUnit
          ? unitIconSrc(buildpics?.units[s.startUnit])
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
              logo={factionLogos?.[s.name.toLowerCase()]}
              unitLabel={unitLabel}
              count={counts.get(s.name) ?? 0}
            />
          </li>
        );
      })}
    </ul>
  );
}
