import { cn, Input } from "@picoframe/frame";
import { ChevronRight, ListTree, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  UnitBuildpicsResult,
  UnitDatasetEntry,
  UnitDisplay,
} from "../../bindings";
import { buildPicMissing } from "../../buildPicMissing";
import { useUnitsyncUnitBuildpics } from "../../config";
import {
  buildTechForest,
  isSelected,
  subtreeState,
  toggleSubtree,
  toggleUnit,
  unknownSelected,
} from "../../techForest";

/** Cap on how many rows a search shows at once, so a huge game stays responsive
 * (a 4000-unit game would otherwise render every match). */
const SEARCH_CAP = 300;

/**
 * The shared build-graph tech-tree picker (issue #377). One component over the
 * game's unit dataset ({@link buildTechForest}), used to edit or visualise a flat
 * unit-id set: a campaign/battle restrictions editor stores it as `disabledUnits`,
 * the warpath viewer reads it as `unlockedUnits`. It is polarity-neutral, so the
 * caller decides what "selected" means via `selectedLabel`.
 *
 * Editable when `onChange` is given (a checkbox per unit, plus a subtree toggle
 * on builders that includes/excludes the whole `buildoptions` descendant set).
 * Read-only otherwise, rendering the selected set as a lit-up tree. Units nest
 * under their faction commander (spanning tree, one row each). Anything the game
 * exposes that no commander builds falls into "Other units", so nothing is
 * hidden. Stored ids absent from the current dataset are surfaced as "unknown"
 * rather than dropped. Build icons resolve lazily and fill in behind the tree.
 */
export function TechTreePicker({
  units,
  roots,
  selected,
  onChange,
  selectedLabel = "selected",
  enginePath,
  dataDir,
  gameArchive,
  buildpics: buildpicsProp,
}: {
  /** The game's unit graph (units + `buildoptions` edges). */
  units: UnitDatasetEntry[];
  /** Faction start units (commanders), the roots of each tree. */
  roots: string[];
  /** The current id set. Meaning is the caller's (disabled or unlocked units). */
  selected: string[];
  /** Apply the next set. Omit for a read-only lit-tree visualisation. */
  onChange?: (next: string[]) => void;
  /** Word for what a lit unit means, e.g. "disabled" or "unlocked". */
  selectedLabel?: string;
  /** Engine/target for lazy build-icon resolution (optional). */
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  /** Pre-resolved build icons, if the caller already has them. */
  buildpics?: UnitBuildpicsResult | null;
}) {
  const readOnly = !onChange;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const forest = useMemo(() => buildTechForest(units, roots), [units, roots]);

  // Friendly labels, keyed by lowercased id.
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.name.toLowerCase(), u.fullName || u.name);
    return m;
  }, [units]);

  // Resolve build icons for the whole known set (lazy, cached, fills in behind
  // the tree). Prefer icons the caller already fetched.
  const allIds = useMemo(() => [...forest.known], [forest]);
  const fetched = useUnitsyncUnitBuildpics(
    buildpicsProp ? undefined : enginePath,
    dataDir,
    gameArchive,
    buildpicsProp ? undefined : allIds,
  );
  const buildpics = buildpicsProp ?? fetched;

  // Default the roots open so the tree shows something useful, re-seeding when
  // the game (hence its roots) changes.
  const rootKey = useMemo(() => forest.roots.join(","), [forest]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the root set changes, not on every forest identity
  useEffect(() => {
    setExpanded(new Set(forest.roots));
  }, [rootKey]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Flatten the forest to the currently-visible rows. A search collapses to a
  // flat match list (across the whole dataset, ignoring expand state). Otherwise
  // a DFS emits a node's children only when it is expanded.
  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const out: Row[] = [];
      for (const id of forest.known) {
        if (
          id.includes(q) ||
          (labels.get(id) ?? "").toLowerCase().includes(q)
        ) {
          out.push({ id, depth: 0, hasChildren: false });
          if (out.length >= SEARCH_CAP) break;
        }
      }
      return out;
    }
    const out: Row[] = [];
    const walk = (id: string, depth: number) => {
      const kids = forest.childrenOf.get(id) ?? [];
      out.push({ id, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0 && expanded.has(id)) {
        for (const kid of kids) walk(kid, depth + 1);
      }
    };
    for (const root of forest.roots) walk(root, 0);
    // Units no commander builds (and games with no roots at all) still need to
    // be reachable, so list them under an "Other units" header.
    if (forest.ungrouped.length > 0) {
      out.push({ id: "__other", depth: 0, hasChildren: false, header: true });
      for (const id of forest.ungrouped) {
        out.push({ id, depth: 1, hasChildren: false });
      }
    }
    return out;
  }, [query, forest, expanded, labels]);

  const unknown = useMemo(
    () => unknownSelected(selected, forest.known),
    [selected, forest.known],
  );

  const selectedCount = selected.length;

  if (forest.known.size === 0) {
    return (
      <div className="rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
        No unit data available for this game.
        {selectedCount > 0 && (
          <UnknownList
            ids={unknown}
            readOnly={readOnly}
            onRemove={(id) => onChange?.(toggleUnit(selected, id, false))}
          />
        )}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units…"
            className="h-8"
            aria-label="Search units"
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {selectedCount} {selectedLabel}
          </span>
        </div>

        <ul className="flex max-h-80 flex-col overflow-auto rounded-md border border-border/50 p-1">
          {rows.map((row) =>
            row.header ? (
              <li
                key="__other"
                className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Other units
              </li>
            ) : (
              <UnitRow
                key={`${row.depth}:${row.id}`}
                row={row}
                label={labels.get(row.id) ?? row.id}
                display={buildpics?.units[row.id]}
                lit={isSelected(selected, row.id)}
                readOnly={readOnly}
                isBuilder={forest.builders.has(row.id)}
                subtree={
                  forest.builders.has(row.id)
                    ? subtreeState(selected, row.id, forest.edges)
                    : undefined
                }
                expanded={expanded.has(row.id)}
                onToggleExpand={() => toggleExpand(row.id)}
                onToggleUnit={(on) =>
                  onChange?.(toggleUnit(selected, row.id, on))
                }
                onToggleSubtree={(on) =>
                  onChange?.(toggleSubtree(selected, row.id, forest.edges, on))
                }
              />
            ),
          )}
          {rows.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              No units match.
            </li>
          )}
          {query.trim() && rows.length >= SEARCH_CAP && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              Showing the first {SEARCH_CAP} matches. Refine the search to
              narrow it.
            </li>
          )}
        </ul>

        {unknown.length > 0 && (
          <UnknownList
            ids={unknown}
            readOnly={readOnly}
            onRemove={(id) => onChange?.(toggleUnit(selected, id, false))}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

interface Row {
  id: string;
  depth: number;
  hasChildren: boolean;
  /** A group-header row ("Other units") rather than a unit. */
  header?: boolean;
}

/** One unit row: expand chevron, build icon, lit state / checkbox, name, and a
 * subtree toggle on builders. Lit rows get a tinted background so a read-only
 * tree reads as "lit up". */
function UnitRow({
  row,
  label,
  display,
  lit,
  readOnly,
  isBuilder,
  subtree,
  expanded,
  onToggleExpand,
  onToggleUnit,
  onToggleSubtree,
}: {
  row: Row;
  label: string;
  /** This unit's resolved build pic, absent until the icons come back. */
  display?: UnitDisplay;
  lit: boolean;
  readOnly: boolean;
  isBuilder: boolean;
  subtree?: "none" | "some" | "all";
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleUnit: (on: boolean) => void;
  onToggleSubtree: (on: boolean) => void;
}) {
  const missing = buildPicMissing(display);
  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded px-1 py-1 text-sm",
          lit && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        )}
        style={{ paddingLeft: `${row.depth * 16 + 4}px` }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}

        {readOnly ? (
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              lit ? "bg-primary shadow-[0_0_6px_var(--primary)]" : "bg-muted",
            )}
          />
        ) : (
          <Checkbox
            checked={lit}
            onCheckedChange={(v) => onToggleUnit(v === true)}
            aria-label={label}
          />
        )}

        {display?.icon ? (
          <img
            src={display.icon}
            alt=""
            className="size-7 shrink-0 rounded object-contain"
          />
        ) : (
          <span
            title={missing.title}
            className="flex size-7 shrink-0 items-center justify-center rounded bg-muted text-center text-[0.55rem] leading-tight text-muted-foreground"
          >
            {missing.label}
          </span>
        )}

        <span className={cn("truncate", !lit && readOnly && "opacity-60")}>
          {label}
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          {row.id}
        </span>

        {!readOnly && isBuilder && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onToggleSubtree(subtree !== "all")}
                aria-label={
                  subtree === "all"
                    ? `Clear ${label} and its whole subtree`
                    : `Select ${label} and its whole subtree`
                }
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                  subtree === "all"
                    ? "text-primary"
                    : subtree === "some"
                      ? "text-primary/60"
                      : "text-muted-foreground",
                )}
              >
                <ListTree className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {subtree === "all"
                ? "Clear whole subtree"
                : "Select whole subtree"}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

/** Stored ids not in the current game's dataset, shown so they are not lost. */
function UnknownList({
  ids,
  readOnly,
  onRemove,
}: {
  ids: string[];
  readOnly: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        Not in this game ({ids.length}), kept from the saved set.
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <li
            key={id}
            className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs"
          >
            <span className="font-mono">{id}</span>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${id}`}
                onClick={() => onRemove(id)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
