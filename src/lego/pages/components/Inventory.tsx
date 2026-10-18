/**
 * The builder's one inventory (issue #3306): the filter row and the grid.
 *
 * The row is the same on the Lego Parts page and in the builder's drawer
 * (#4538), where it has a Game units tab as well.
 *
 * Shapes, parts and modules are drawn by one grid in sections (#4536), on the
 * Lego Parts page and in the builder's drawer alike. A section with nothing to
 * show is left out. Clicking a tile opens it in the detail panel beside the
 * grid (#4537), which holds a module's actions.
 *
 * State lives in `useInventoryView`, because the caller records what a unit
 * took from the inventory and so needs the same recent and favourite lists.
 */

import { Button, cn, Input } from "@picoframe/frame";
import { FileUp } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { LegoAtlas } from "../../atlas";
import { useColourwayColours } from "../../colourwayColours";
import {
  type InventoryKind,
  type InventoryList,
  type InventoryRef,
  type InventoryView,
  refKey,
} from "../../inventory";
import {
  categoryFromValue,
  categoryMenu,
  categoryValue,
} from "../../inventoryCategory";
import type { LegoProject } from "../../model";
import type { LegoPartInfo, LoadedPack } from "../../pack";
import { SHAPE_KINDS, type ShapeKind } from "../../shapes";
import { isBuiltInModule } from "../../starterModules";
import { CategoryMenu } from "./CategoryMenu";
import { DetailPanel } from "./DetailPanel";
import { useRootHeight } from "./gridScroll";
import { PackSelect } from "./PartFilters";
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
 * Kind, search, category and list, in one row that keeps its shape on every
 * tab (#4538). What a tab has no use for is switched off rather than taken
 * away. The counts are on the grid's section headings.
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
  const colours = useColourwayColours(pack);
  const units = view.kind === "units";
  const groups = categoryMenu({
    kind: view.kind,
    pack,
    compounds,
    current: view.category,
    shapes: (pack.manifest.swatches?.length ?? 0) > 0,
  });
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Tabs
        value={view.kind}
        onValueChange={(value) => view.setKind(value as InventoryKind)}
      >
        <TabsList aria-label="Kind">
          {(showGameUnits ? [...KINDS, GAME_UNITS_KIND] : KINDS).map(
            ({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ),
          )}
        </TabsList>
      </Tabs>
      <Input
        value={view.query}
        onChange={(event) => view.setQuery(event.target.value)}
        placeholder="Search"
        className="w-56 min-w-32 flex-1"
        aria-label={units ? "Search the game's units" : "Search the inventory"}
      />
      <CategoryMenu
        groups={groups}
        value={categoryValue(view.category)}
        onValueChange={(value) => view.setCategory(categoryFromValue(value))}
        colours={colours}
        disabled={units}
      />
      {showPacks ? (
        <PackSelect
          pack={pack}
          packId={view.partFilter.packId}
          onPackId={view.partFilter.setPackId}
          disabled={view.kind === "modules" || units}
          className="w-44 shrink-0"
        />
      ) : null}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view.list === "all" ? "" : view.list}
        onValueChange={(value) =>
          view.setList(value === "" ? "all" : (value as InventoryList))
        }
        disabled={units}
        aria-label="List"
        className="shrink-0"
      >
        <ToggleGroupItem value="recent">Recent</ToggleGroupItem>
        <ToggleGroupItem value="favourites">Favourites</ToggleGroupItem>
      </ToggleGroup>
      {onLoadModuleFile ? (
        <Button
          size="icon"
          variant="outline"
          onClick={onLoadModuleFile}
          aria-label="Load from file"
          title="Load from file"
          className="size-8 shrink-0"
        >
          <FileUp size={14} />
        </Button>
      ) : null}
    </div>
  );
}

interface GridsProps {
  view: InventoryView;
  pack: LoadedPack;
  /** Every module, filtered or not. */
  compounds: LegoProject[];
  atlas?: LegoAtlas;
  /** The part being placed in the builder, drawn as chosen. */
  selectedPartId?: string;
  /** Absent on the Lego Parts page, which has no unit to take a part. */
  onSelectPart?: (part: LegoPartInfo, alt: boolean) => void;
  /**
   * The panel's Colourway control chose another colourway of the part being
   * placed, which the builder then places instead (#4540).
   */
  onSwitchPlacingPart?: (part: LegoPartInfo) => void;
  /** The builder adds the shape. Absent on the Lego Parts page. */
  onSelectShape?: (shape: ShapeKind, alt: boolean) => void;
  /** Absent on the Lego Parts page, which has no unit to place a module in. */
  onInsertModule?: (module: LegoProject, now: boolean) => void;
  placingModuleId?: string;
  onDeleteModule: (id: string) => void;
  onRenameModule: (module: LegoProject, name: string) => void;
  /** Saves the user's own copy of a built in module, and hands it back. */
  onCopyModule: (module: LegoProject) => Promise<LegoProject>;
  /** Absent leaves Save to file out of the panel. */
  onSaveModuleFile?: (module: LegoProject) => void;
  /** Absent leaves Share out of the panel. */
  onShareModule?: (module: LegoProject) => void;
  onLabelsModule?: (
    module: LegoProject,
    labels: { category: string | undefined; tags: string[] },
  ) => void;
  /** Drawn instead of the grid when the kind is "Game units". */
  gameUnits?: ReactNode;
  /**
   * The page's scroller, for a page that scrolls the grid with everything
   * else on it (#4468). Absent, the grid scrolls in a box of its own. The
   * detail panel stays in view while it scrolls.
   */
  scrollRoot?: RefObject<HTMLElement | null>;
  /**
   * Whether Escape closes the detail panel wherever focus is. The Lego Parts
   * page has nothing else Escape could mean. In the builder it closes the
   * panel only from inside the grid or the panel.
   */
  escapeAnywhere?: boolean;
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
  onSwitchPlacingPart,
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
  scrollRoot,
  escapeAnywhere = false,
}: GridsProps) {
  const { inventory } = view;
  // One choice for every kind, so a click on any tile replaces what the panel
  // was showing.
  const [selected, setSelected] = useState<InventoryRef | null>(null);
  const rootHeight = useRootHeight(scrollRoot);

  useEffect(() => {
    if (!escapeAnywhere || !selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A field that gave up an edit, or a menu that closed, has used it.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [escapeAnywhere, selected]);
  const favourites = useMemo(
    () => new Set(inventory.favourites.map(refKey)),
    [inventory.favourites],
  );
  const sections = useMemo(
    () =>
      inventorySections(
        {
          shapes: view.shapes,
          parts: view.parts,
          partTotal: view.partFilter.total,
          modules: view.modules,
        },
        compounds,
      ),
    [view.shapes, view.parts, view.partFilter.total, view.modules, compounds],
  );
  const empty = sections.every((section) => section.items.length === 0);

  if (view.kind === "units") {
    return (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">{gameUnits}</div>
      </div>
    );
  }

  // What the builder is placing, else what the panel shows.
  const selectedKey = placingModuleId
    ? refKey({ kind: "module", id: placingModuleId })
    : selectedPartId
      ? refKey({ kind: "part", id: selectedPartId })
      : selected
        ? refKey(selected)
        : undefined;

  const panel = selected ? (
    <DetailPanel
      pack={pack}
      atlas={atlas}
      selected={selected}
      compounds={compounds}
      moduleActions={{
        onDelete: onDeleteModule,
        onRename: onRenameModule,
        onCopy: onCopyModule,
        onSaveFile: onSaveModuleFile,
        onShare: onShareModule,
        onLabels: onLabelsModule,
      }}
      onSelect={(next) => {
        const part = next.kind === "part" ? pack.byId.get(next.id) : undefined;
        if (
          part &&
          selected.kind === "part" &&
          selected.id === selectedPartId
        ) {
          onSwitchPlacingPart?.(part);
        }
        setSelected(next);
      }}
      onClose={() => setSelected(null)}
      onAddShape={onSelectShape && ((shape) => onSelectShape(shape, false))}
      onPlaceModule={
        onInsertModule && ((module) => onInsertModule(module, false))
      }
      compact={!scrollRoot}
      className={scrollRoot ? undefined : "pr-3 pt-2"}
    />
  ) : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape is caught on its way up from the grid and the panel
    <div
      className="flex min-h-0 flex-1"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || !selected)
          return;
        event.preventDefault();
        setSelected(null);
      }}
    >
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
              setSelected(refOf(item));
              if (item.kind === "part") onSelectPart?.(item.part, alt);
              else if (item.kind === "shape") onSelectShape?.(item.shape, alt);
              else onInsertModule?.(item.module, alt);
            }}
            favourites={favourites}
            onFavourite={(item) => inventory.toggleFavourite(refOf(item))}
            scrollRoot={scrollRoot}
          />
        )}
      </div>
      {scrollRoot && panel ? (
        // Held in view while the page scrolls, and no taller than the page.
        <div
          className="sticky top-0 flex self-start"
          style={rootHeight > 0 ? { maxHeight: rootHeight } : undefined}
        >
          {panel}
        </div>
      ) : (
        panel
      )}
    </div>
  );
}

/**
 * The grid's sections, in the order they are drawn: Shapes, Parts, Built in
 * modules, Saved modules. Each carries its count before any filter, so its
 * heading can say "12 of 373" while a search, a category or a list narrows it.
 * Parts count from the chosen colourway's parts instead, as a colourway lists
 * each shape once (#4540): "Parts 125", not "125 of 373".
 */
export function inventorySections(
  view: Pick<InventoryView, "shapes" | "parts" | "modules"> & {
    /** The parts the category holds, `PartFilter.total`. */
    partTotal: number;
  },
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
      total: view.partTotal,
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
