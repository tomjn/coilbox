/**
 * The builder's one inventory (issue #3306): the filter row and the grid.
 *
 * Shapes, parts and modules are drawn by one grid in sections (#4536), on the
 * Lego Parts page and in the builder's drawer alike. A section with nothing to
 * show is left out.
 *
 * State lives in `useInventoryView`, because the caller records what a unit
 * took from the inventory and so needs the same recent and favourite lists.
 */

import { Button, cn, Input } from "@picoframe/frame";
import { FileUp } from "lucide-react";
import { type ReactNode, type RefObject, useMemo } from "react";

import { ButtonGroup } from "@/components/ui/button-group";
import type { LegoAtlas } from "../../atlas";
import {
  type InventoryKind,
  type InventoryList,
  type InventoryRef,
  type InventoryView,
  refKey,
} from "../../inventory";
import type { LegoProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { SHAPE_KINDS, type ShapeKind } from "../../shapes";
import { isBuiltInModule } from "../../starterModules";
import { ModuleFilters } from "./ModuleFilters";
import { PartFilters } from "./PartFilters";
import { type GridItem, type GridSection, TileGrid } from "./TileGrid";

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
  /** False for a page that puts the pack menu in its header instead. */
  showPacks?: boolean;
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
  showPacks = true,
  className,
}: FiltersProps) {
  const { partFilter, moduleFilter } = view;
  // A shape is listed with the parts, so it counts as one.
  const partCount = view.parts.length + view.shapes.length;
  const loadButton = onLoadModuleFile ? (
    // Its words go when the row is short of room, and its name stays.
    <Button
      size="sm"
      variant="outline"
      onClick={onLoadModuleFile}
      aria-label="Load from file"
      title="Load from file"
      className="shrink-0"
    >
      <FileUp size={14} />
      <span className="hidden @xl:inline">Load from file</span>
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
          showShapes={(pack.manifest.swatches?.length ?? 0) > 0}
          showPacks={showPacks}
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
        <div className="@container flex min-w-88 flex-1 flex-nowrap items-center gap-2">
          <Input
            value={view.query}
            onChange={(event) => view.setQuery(event.target.value)}
            placeholder="Search"
            className="w-56 min-w-32"
            aria-label="Search the inventory"
          />
          <span className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted-foreground">
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
  /** Absent on the Lego Parts page, which has no unit to place a module in. */
  onInsertModule?: (module: LegoProject, now: boolean) => void;
  /** The Lego Parts page's answer to a click on a module, which has no unit. */
  onSelectModule?: (module: LegoProject) => void;
  /** The module the Lego Parts page has chosen, drawn as chosen. */
  selectedModuleId?: string;
  placingModuleId?: string;
  onDeleteModule: (id: string) => void;
  onRenameModule: (module: LegoProject, name: string) => void;
  onCopyModule: (module: LegoProject) => void;
  /** Absent leaves Save to file out of each module's menu. */
  onSaveModuleFile?: (module: LegoProject) => void;
  /** Absent leaves Share out of each module's menu. */
  onShareModule?: (module: LegoProject) => void;
  onLabelsModule?: (
    module: LegoProject,
    labels: { category: string | undefined; tags: string[] },
  ) => void;
  /** Drawn instead of the grid when the kind is "Game units". */
  gameUnits?: ReactNode;
  /** Beside the grid, such as the Lego Parts page's part detail. */
  aside?: ReactNode;
  /**
   * The page's scroller, for a page that scrolls the grid with everything
   * else on it (#4468). Absent, the grid scrolls in a box of its own.
   */
  scrollRoot?: RefObject<HTMLElement | null>;
}

function emptyText(list: InventoryList): string {
  if (list === "recent") return "Nothing used yet.";
  if (list === "favourites") return "No favourites yet.";
  return "Nothing matches.";
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
  onSelectModule,
  selectedModuleId,
  placingModuleId,
  onDeleteModule,
  onRenameModule,
  onCopyModule,
  onSaveModuleFile,
  onShareModule,
  onLabelsModule,
  gameUnits,
  aside,
  scrollRoot,
}: GridsProps) {
  const { inventory } = view;
  const favourites = useMemo(
    () => new Set(inventory.favourites.map(refKey)),
    [inventory.favourites],
  );
  const sections = useMemo(
    () =>
      inventorySections(
        { shapes: view.shapes, parts: view.parts, modules: view.modules },
        pack,
        compounds,
      ),
    [view.shapes, view.parts, view.modules, pack, compounds],
  );
  const empty = sections.every((section) => section.items.length === 0);

  if (view.kind === "units") {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">{gameUnits}</div>
      </div>
    );
  }

  const selectedKey = placingModuleId
    ? refKey({ kind: "module", id: placingModuleId })
    : selectedShape
      ? refKey({ kind: "shape", id: selectedShape })
      : selectedPartId
        ? refKey({ kind: "part", id: selectedPartId })
        : selectedModuleId
          ? refKey({ kind: "module", id: selectedModuleId })
          : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      {/* No width of its own beyond its share of the row, so the canvas inside
          can never size it (#4520). The page pads its own content, the drawer
          needs this to keep the headings off its edges. */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          !scrollRoot && "pl-2 pt-2",
        )}
      >
        {empty ? (
          <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
            {emptyText(view.list)}
          </p>
        ) : (
          <TileGrid
            pack={pack}
            sections={sections}
            atlas={atlas}
            selectedKey={selectedKey}
            placesModules={onInsertModule !== undefined}
            onPick={(item, alt) => {
              if (item.kind === "part") onSelectPart?.(item.part, alt);
              else if (item.kind === "shape") onSelectShape?.(item.shape, alt);
              else if (onInsertModule) onInsertModule(item.module, alt);
              else onSelectModule?.(item.module);
            }}
            favourites={favourites}
            onFavourite={(item) => inventory.toggleFavourite(refOf(item))}
            knownModules={compounds}
            moduleActions={{
              onDelete: onDeleteModule,
              onRename: onRenameModule,
              onCopy: onCopyModule,
              onSaveFile: onSaveModuleFile,
              onShare: onShareModule,
              onLabels: onLabelsModule,
            }}
            scrollRoot={scrollRoot}
          />
        )}
      </div>
      {scrollRoot && aside ? (
        <div className="sticky top-0 self-start">{aside}</div>
      ) : (
        aside
      )}
    </div>
  );
}

/**
 * The grid's sections, in the order they are drawn: Shapes, Parts, Built in
 * modules, Saved modules. Each carries its count before any filter, so its
 * heading can say "12 of 373" while a search, a category or a list narrows it.
 */
export function inventorySections(
  view: Pick<InventoryView, "shapes" | "parts" | "modules">,
  pack: LoadedPack,
  compounds: LegoProject[],
): GridSection[] {
  const builtInTotal = compounds.filter(isBuiltInModule).length;
  const builtIn = view.modules.filter(isBuiltInModule);
  const saved = view.modules.filter((module) => !isBuiltInModule(module));
  return [
    {
      id: "shapes",
      label: "Shapes",
      total: SHAPE_KINDS.length,
      items: view.shapes.map((shape) => ({ kind: "shape", shape })),
    },
    {
      id: "parts",
      label: "Parts",
      total: pack.parts.length,
      items: view.parts.map((part) => ({ kind: "part", part })),
    },
    {
      id: "built-in",
      label: "Built in modules",
      total: builtInTotal,
      items: builtIn.map((module) => ({ kind: "module", module })),
    },
    {
      id: "saved",
      label: "Saved modules",
      total: compounds.length - builtInTotal,
      items: saved.map((module) => ({ kind: "module", module })),
    },
  ];
}

function refOf(item: GridItem): InventoryRef {
  switch (item.kind) {
    case "shape":
      return { kind: "shape", id: item.shape.id };
    case "part":
      return { kind: "part", id: item.part.id };
    case "module":
      return { kind: "module", id: item.module.id };
  }
}
