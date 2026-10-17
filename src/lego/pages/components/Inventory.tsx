/**
 * The builder's one inventory (issue #3306): the filter row and the grids.
 *
 * Parts and modules are drawn by two canvases, one each, because the parts grid
 * is virtualised over thousands of cells and the module grid draws a few tens of
 * assemblies with headings. With "All" they are stacked in one column and share
 * its height. A kind with nothing to show is left out, so a filter that empties
 * one hands the whole column to the other.
 *
 * State lives in `useInventoryView`, because the caller records what a unit
 * took from the inventory and so needs the same recent and favourite lists.
 */

import { Button, cn, Input } from "@picoframe/frame";
import { FileUp } from "lucide-react";
import type { ReactNode } from "react";

import { ButtonGroup } from "@/components/ui/button-group";
import type { LegoAtlas } from "../../atlas";
import type {
  InventoryKind,
  InventoryList,
  InventoryView,
} from "../../inventory";
import type { LegoProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import type { ShapeKind } from "../../shapes";
import { CompoundPicker } from "./CompoundPicker";
import { ModuleFilters } from "./ModuleFilters";
import { PartFilters } from "./PartFilters";
import { PartPicker } from "./PartPicker";

const KINDS: { value: InventoryKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "parts", label: "Parts" },
  { value: "modules", label: "Modules" },
];

/** Only a unit has a game to take from, so the Lego Parts page leaves it out. */
const GAME_UNITS_KIND: { value: InventoryKind; label: string } = {
  value: "units",
  label: "Game units",
};

const LISTS: { value: Exclude<InventoryList, "all">; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "favourites", label: "Favourites" },
];

interface FiltersProps {
  view: InventoryView;
  pack: LoadedPack;
  /** Every module, filtered or not. */
  compounds: LegoProject[];
  /** Absent hides the load from file button. */
  onLoadModuleFile?: () => void;
  /** Adds the "Game units" kind, for a page that has a unit to take from. */
  showGameUnits?: boolean;
  className?: string;
}

/**
 * Kind, list and search. The category buttons and the pack menu belong to
 * parts, and the category menu to modules, so each shows only when its kind is
 * the one chosen. "All" has the search box alone.
 */
export function InventoryFilters({
  view,
  pack,
  compounds,
  onLoadModuleFile,
  showGameUnits = false,
  className,
}: FiltersProps) {
  const { partFilter, moduleFilter } = view;
  // A shape is listed with the parts, so it counts as one.
  const partCount = view.parts.length + view.shapes.length;
  const loadButton = onLoadModuleFile ? (
    <Button size="sm" variant="outline" onClick={onLoadModuleFile}>
      <FileUp size={14} /> Load from file
    </Button>
  ) : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ButtonGroup aria-label="Kind">
        {(showGameUnits ? [...KINDS, GAME_UNITS_KIND] : KINDS).map(
          ({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={view.kind === value ? "default" : "outline"}
              onClick={() => view.setKind(value)}
              aria-pressed={view.kind === value}
            >
              {label}
            </Button>
          ),
        )}
      </ButtonGroup>
      {view.kind === "units" ? null : (
        <ButtonGroup aria-label="List">
          {LISTS.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={view.list === value ? "default" : "outline"}
              onClick={() => view.setList(view.list === value ? "all" : value)}
              aria-pressed={view.list === value}
            >
              {label}
            </Button>
          ))}
        </ButtonGroup>
      )}
      {view.kind === "units" ? (
        <Input
          value={view.query}
          onChange={(event) => view.setQuery(event.target.value)}
          placeholder="Search"
          className="w-56"
          aria-label="Search the game's units"
        />
      ) : view.kind === "parts" ? (
        <PartFilters
          pack={pack}
          query={view.query}
          onQuery={view.setQuery}
          category={partFilter.category}
          onCategory={partFilter.setCategory}
          packId={partFilter.packId}
          onPackId={partFilter.setPackId}
          shown={view.parts.length + view.shapes.length}
          showShapes
          className="flex-1"
        />
      ) : view.kind === "modules" ? (
        <ModuleFilters
          compounds={compounds}
          query={view.query}
          onQuery={view.setQuery}
          category={moduleFilter.category}
          onCategory={moduleFilter.setCategory}
          shown={view.modules.length}
          className="flex-1"
          trailing={loadButton}
        />
      ) : (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input
            value={view.query}
            onChange={(event) => view.setQuery(event.target.value)}
            placeholder="Search"
            className="w-56"
            aria-label="Search the inventory"
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {partCount} {partCount === 1 ? "part" : "parts"},{" "}
            {view.modules.length}{" "}
            {view.modules.length === 1 ? "module" : "modules"}
          </span>
          {loadButton}
        </div>
      )}
    </div>
  );
}

interface GridsProps {
  view: InventoryView;
  pack: LoadedPack;
  /** Every module, filtered or not. */
  compounds: LegoProject[];
  atlas?: LegoAtlas;
  selectedPartId?: string;
  /** Absent on the Lego Parts page, which has no unit to take a part. */
  onSelectPart?: (part: LegoPartInfo, alt: boolean) => void;
  selectedShape?: string;
  /** The builder adds the shape. The Lego Parts page shows its detail. */
  onSelectShape?: (shape: ShapeKind, alt: boolean) => void;
  /** Absent on the Lego Parts page, as `CompoundPicker` allows. */
  onInsertModule?: (module: LegoProject, now: boolean) => void;
  placingModuleId?: string;
  onDeleteModule: (id: string) => void;
  onRenameModule: (module: LegoProject, name: string) => void;
  onCopyModule: (module: LegoProject) => void;
  /** Absent hides each cell's save to file button. */
  onSaveModuleFile?: (module: LegoProject) => void;
  /** Absent hides each cell's share button. */
  onShareModule?: (module: LegoProject) => void;
  onLabelsModule?: (
    module: LegoProject,
    labels: { category: string | undefined; tags: string[] },
  ) => void;
  /** Drawn instead of the grids when the kind is "Game units". */
  gameUnits?: ReactNode;
  /** Beside the grids, such as the Lego Parts page's part detail. */
  aside?: ReactNode;
}

function emptyText(list: InventoryList): string {
  if (list === "recent") return "Nothing used yet.";
  if (list === "favourites") return "No favourites yet. Click a star.";
  return "Nothing matches. Clear the search or pick another filter.";
}

export function InventoryGrids({
  view,
  pack,
  compounds,
  atlas,
  selectedPartId,
  onSelectPart,
  selectedShape,
  onSelectShape,
  onInsertModule,
  placingModuleId,
  onDeleteModule,
  onRenameModule,
  onCopyModule,
  onSaveModuleFile,
  onShareModule,
  onLabelsModule,
  gameUnits,
  aside,
}: GridsProps) {
  const { inventory } = view;
  const favouriteParts = new Set(
    inventory.favourites.filter((r) => r.kind === "part").map((r) => r.id),
  );
  const favouriteModules = new Set(
    inventory.favourites.filter((r) => r.kind === "module").map((r) => r.id),
  );
  const favouriteShapes = new Set(
    inventory.favourites.filter((r) => r.kind === "shape").map((r) => r.id),
  );
  const hasCells = view.parts.length > 0 || view.shapes.length > 0;
  const empty = !hasCells && view.modules.length === 0;

  if (view.kind === "units") {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">{gameUnits}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {empty ? (
          <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
            {emptyText(view.list)}
          </p>
        ) : null}
        {hasCells ? (
          <PartPicker
            pack={pack}
            parts={view.parts}
            shapes={view.shapes}
            selectedShape={selectedShape}
            onSelectShape={onSelectShape}
            favouriteShapes={favouriteShapes}
            onFavouriteShape={(shape) =>
              inventory.toggleFavourite({ kind: "shape", id: shape.kind })
            }
            atlas={atlas}
            selectedId={selectedPartId}
            onSelect={onSelectPart}
            favourites={favouriteParts}
            onFavourite={(part) =>
              inventory.toggleFavourite({ kind: "part", id: part.id })
            }
          />
        ) : null}
        {view.modules.length > 0 ? (
          <div
            className={cn(
              "flex min-h-0 flex-1",
              hasCells && "border-t border-border",
            )}
          >
            <CompoundPicker
              pack={pack}
              compounds={view.modules}
              known={compounds}
              atlas={atlas}
              onInsert={onInsertModule}
              placingId={placingModuleId}
              onDelete={onDeleteModule}
              onRename={onRenameModule}
              onCopy={onCopyModule}
              onSaveFile={onSaveModuleFile}
              onShare={onShareModule}
              favourites={favouriteModules}
              onFavourite={(module) =>
                inventory.toggleFavourite({ kind: "module", id: module.id })
              }
              onLabels={onLabelsModule}
            />
          </div>
        ) : null}
      </div>
      {aside}
    </div>
  );
}
