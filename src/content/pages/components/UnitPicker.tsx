import { Button, cn, Input } from "@picoframe/frame";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { createContext, type ReactNode, use, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePreferredTarget } from "../../../play/config";
import type {
  UnitBuildpicsResult,
  UnitDatasetEntry,
  UnitDisplay,
} from "../../bindings";
import { buildPicMissing } from "../../buildPicMissing";
import {
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../../config";
import {
  buildTechForest,
  factionGroups,
  isSelected,
  toggleUnit,
  unknownSelected,
} from "../../techForest";
import { unitLabel } from "../../unitChoices";
import { unitIconSrc } from "../../unitIcon";

/** Cap on how many rows the list shows at once, so a huge game stays responsive
 * (a 4000-unit game would otherwise render every row). */
const SEARCH_CAP = 500;

/**
 * Which game the pickers below are picking from.
 *
 * An editor screen knows its game once, and the fields that ask for a unit are
 * nested several components deep inside it. Naming the game here saves threading
 * it through every one of them, and without it those fields fall back to a list
 * with no build pics and no faction blocks.
 */
const UnitGameContext = createContext<{
  gameName?: string;
  gameArchive?: string;
  enginePath?: string;
  dataDir?: string;
}>({});

/**
 * Name the game for every picker on the screen.
 *
 * The engine target is read here rather than in the picker, because the picker
 * is rendered by components that are deliberately pure and testable without the
 * app frame around them. This provider is only ever mounted by a screen, where
 * reading a setting is fine.
 */
export function UnitGameProvider({
  gameName,
  gameArchive,
  children,
}: {
  gameName?: string;
  gameArchive?: string;
  children: ReactNode;
}) {
  const { target } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const value = useMemo(
    () => ({ gameName, gameArchive, enginePath, dataDir }),
    [gameName, gameArchive, enginePath, dataDir],
  );
  return <UnitGameContext value={value}>{children}</UnitGameContext>;
}

/** A faction, as the picker heads its block of units. */
export interface UnitPickerFaction {
  /** The faction's start unit, which is how its units are found. */
  startUnit: string;
  /** What to call the block. The start unit's own name when absent. */
  name?: string;
}

/**
 * Pick units from a game's dataset: one searchable list, blocked by faction and
 * sorted by name, with each unit's build pic beside it.
 *
 * One component for every screen that asks "which units?", because they were all
 * asking it differently: a campaign's restrictions, a battle preset's, a warpath's
 * unlocks, and a plain dropdown in the scenario editor, the lego builder and the
 * mission editor. {@link UnitPicker} is the multi-select list, and
 * {@link UnitPickerButton} is the same list in a popover for the single-select
 * ones.
 *
 * It is flat, and deliberately (#1051). It used to draw the build graph as an
 * indented tree, which cannot be done honestly: a unit two builders make has to
 * be filed under one of them, so a builder's row showed an arbitrary subset of
 * what it builds and hid the rest, and the whole-subtree toggle beside it took an
 * arbitrary set with it. A faction heading is the one grouping the graph does
 * support, since asking which faction reaches a unit has an answer.
 *
 * It is polarity-neutral. "Selected" is whatever the caller means: the
 * restrictions editor ticks the units a mission allows, the warpath viewer lights
 * the ones a run has unlocked.
 */
export function UnitPicker({
  units,
  factions = [],
  gameName,
  selected,
  onChange,
  selectedLabel = "selected",
  enginePath,
  dataDir,
  gameArchive,
  buildpics,
}: {
  /** The game's units, as `useUnitsyncUnitDataset` reports them. */
  units: UnitDatasetEntry[];
  /** Faction blocks, in the order they should appear. Resolved from the game's
   * own sides when absent. */
  factions?: UnitPickerFaction[];
  /** The game these units came from, so the picker can read its sides and build
   * pics itself. Unnecessary when `factions` and `buildpics` are both given. */
  gameName?: string;
  /** The current id set. Meaning is the caller's (allowed or unlocked units). */
  selected: string[];
  /** Apply the next set. Omit for a read-only view of the set. */
  onChange?: (next: string[]) => void;
  /** Word for what a ticked unit means, e.g. "available" or "unlocked". */
  selectedLabel?: string;
  /** Engine/target for lazy build-icon resolution (optional). */
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  /** Pre-resolved build icons, if the caller already has them. */
  buildpics?: UnitBuildpicsResult | null;
}) {
  const readOnly = !onChange;
  const { forest, labels, blocks, allIds, known, icons, iconsPending } =
    useUnitCatalogue({
      units,
      factions,
      gameName,
      enginePath,
      dataDir,
      gameArchive,
      buildpics,
    });
  const unknown = useMemo(
    () => unknownSelected(selected, known),
    [selected, known],
  );
  // A restriction that disabled a commander and left its tech levels buildable
  // would be a hole rather than a restriction, so picking the group's row
  // toggles every stage in it, not just the base.
  const pick = (id: string, on: boolean) => {
    if (!onChange) return;
    const stages = [...known].filter(
      (u) => (forest.morphBase.get(u) ?? u) === id,
    );
    const targets = stages.length > 0 ? stages : [id];
    onChange(
      targets.reduce((next, stage) => toggleUnit(next, stage, on), selected),
    );
  };

  if (known.size === 0) {
    return (
      <div className="rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-xs text-muted-foreground">
        No unit data available for this game.
        {selected.length > 0 && (
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
    <div className="flex flex-col gap-2">
      <UnitList
        forest={forest}
        labels={labels}
        icons={icons}
        iconsPending={iconsPending}
        ids={allIds}
        factions={blocks}
        // Both numbers, because "379 allowed" alone does not say whether that is
        // all of them or most of them.
        count={`${selected.length} of ${allIds.length} ${selectedLabel}`}
        isOn={(id) => isSelected(selected, id)}
        mode={readOnly ? "read-only" : "multi"}
        onPick={pick}
      />
      {unknown.length > 0 && (
        <UnknownList
          ids={unknown}
          readOnly={readOnly}
          onRemove={(id) => onChange?.(toggleUnit(selected, id, false))}
        />
      )}
    </div>
  );
}

/**
 * Pick one unit, from a button that opens {@link UnitPicker}'s list in a popover.
 *
 * The forms that use this have three or four unit fields on them, so the list
 * cannot be inline. The trigger carries the picked unit's build pic and name, and
 * the search box takes focus when the popover opens, which is what the plain
 * dropdown it replaces relied on Radix typeahead for.
 */
export function UnitPickerButton({
  units,
  factions = [],
  gameName,
  value,
  onValueChange,
  loading,
  placeholder = "Pick a unit",
  disabled,
  className,
  size = "default",
  enginePath,
  dataDir,
  gameArchive,
  buildpics,
  onClear,
}: {
  units: UnitDatasetEntry[];
  factions?: UnitPickerFaction[];
  /** The game these units came from, so the picker can read its sides and build
   * pics itself. */
  gameName?: string;
  /** The internal def name currently picked, or "" for none. */
  value: string;
  onValueChange: (unitDef: string) => void;
  /**
   * Put the picked unit down, shown as a button beside the picker while one is
   * picked (issue #1716).
   *
   * For a picker that arms something rather than filling in a field. Picking a
   * building in an editor turns every click on the map into a building, and
   * without this there is nothing to pick to stop: the list offers units, and
   * "none" is not one of them.
   */
  onClear?: () => void;
  /** The dataset is still being read, so an empty list is not an answer yet. */
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  buildpics?: UnitBuildpicsResult | null;
}) {
  const [open, setOpen] = useState(false);
  const { forest, labels, blocks, allIds, known, icons, iconsPending } =
    useUnitCatalogue({
      units,
      factions,
      gameName,
      enginePath,
      dataDir,
      gameArchive,
      buildpics,
    });
  const picked = value.toLowerCase();
  const pickedLabel = value ? (labels.get(picked) ?? value) : "";

  return (
    <PickedUnit onClear={value ? onClear : undefined} what={pickedLabel}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled ?? known.size === 0}
            className={cn(
              "justify-between gap-2 font-normal",
              size === "sm" ? "h-8 text-xs" : "h-9 text-sm",
              className,
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              {value && (
                <UnitIcon
                  display={icons?.units[picked]}
                  pending={iconsPending}
                  size="sm"
                />
              )}
              <span
                className={cn("truncate", !value && "text-muted-foreground")}
              >
                {value ? pickedLabel : loading ? "Reading units" : placeholder}
              </span>
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-50"
              aria-hidden
            />
          </Button>
        </PopoverTrigger>
        {/* Wide enough for a readable name beside a long internal id, which is what
          22rem was not: the two columns fought and both truncated. */}
        <PopoverContent align="start" className="w-[34rem] max-w-[90vw] p-2">
          <UnitList
            forest={forest}
            labels={labels}
            icons={icons}
            iconsPending={iconsPending}
            ids={allIds}
            factions={blocks}
            autoFocusSearch
            isOn={(id) => id === picked}
            mode="single"
            onPick={(id) => {
              onValueChange(id);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </PickedUnit>
  );
}

/**
 * The picker, with the way to stop placing beside it (issue #1716).
 *
 * A button of its own rather than a cross inside the trigger, because the
 * trigger is a button and a button inside a button is neither valid nor
 * clickable. It is only there while something is picked, so a picker nobody has
 * armed is exactly what it was.
 *
 * The children alone when there is nothing to clear, so the wrapper cannot
 * change the layout of any of the forms that use this as a plain field.
 */
function PickedUnit({
  onClear,
  what,
  children,
}: {
  onClear?: () => void;
  /** What is picked, so the button says which unit it is putting down. */
  what: string;
  children: ReactNode;
}) {
  if (!onClear) return children;
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Button
        variant="ghost"
        size="sm"
        // A cross on its own, beside a picker showing what is picked: the words
        // would only repeat what the thing next to it already says.
        className="h-8 w-8 p-0"
        title={`Stop placing ${what}`}
        onClick={onClear}
      >
        <X className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Stop placing {what}</span>
      </Button>
    </span>
  );
}

/**
 * The forest, the names and the build pics, which both pickers need.
 *
 * A caller that already read the game passes what it has. One that only knows
 * the game by name gets the same list anyway: the target, the archive and the
 * game's sides are all resolvable from here, through the same cached reads the
 * caller would have made, so a plain form field earns build pics and faction
 * blocks without threading four props through it.
 */
function useUnitCatalogue({
  units,
  factions,
  gameName,
  enginePath,
  dataDir,
  gameArchive,
  buildpics,
}: {
  units: UnitDatasetEntry[];
  factions: UnitPickerFaction[];
  gameName?: string;
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  buildpics?: UnitBuildpicsResult | null;
}) {
  const named = use(UnitGameContext);
  const engine = enginePath ?? named.enginePath;
  const root = dataDir ?? named.dataDir;
  const knownArchive = gameArchive ?? named.gameArchive;
  const game = gameName ?? named.gameName;
  const scan = useUnitsyncScan(knownArchive ? undefined : engine, root);
  const archive =
    knownArchive ??
    scan.data?.games.find((g) => g.name === game)?.primaryArchive.name;
  const info = useUnitsyncGameInfo(
    factions.length > 0 ? undefined : engine,
    root,
    archive,
  );

  const blocks = useMemo(() => {
    if (factions.length > 0) return factions;
    return (info.info?.sides ?? [])
      .filter((s) => !!s.startUnit)
      .map((s) => ({ startUnit: s.startUnit as string, name: s.name }));
  }, [factions, info.info]);
  const roots = useMemo(
    () => blocks.map((f) => f.startUnit).filter(Boolean),
    [blocks],
  );
  // The forest is built over the whole game, not the caller's list. A blueprint
  // field offers buildings only, so the commanders that root each faction are
  // not in it, and every unit would fall outside a faction and land in one
  // unheaded block. Which faction builds a unit is the game's answer.
  const whole = useUnitsyncUnitDataset(engine, root, archive);
  const forest = useMemo(
    () => buildTechForest(whole.dataset?.units ?? units, roots),
    [whole.dataset, units, roots],
  );
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.name.toLowerCase(), unitLabel(u));
    return m;
  }, [units]);
  /** The ids to lay out, which is the caller's list rather than the game's. */
  const allIds = useMemo(() => units.map((u) => u.name.toLowerCase()), [units]);
  const known = useMemo(() => new Set(allIds), [allIds]);
  const fetched = useUnitsyncUnitBuildpics(
    buildpics ? undefined : engine,
    root,
    archive,
    buildpics ? undefined : allIds,
  );
  const icons = buildpics ?? fetched;
  return {
    forest,
    labels,
    blocks,
    allIds,
    known,
    icons,
    // No pics yet is not the same as no pics: a row says nothing until the read
    // lands, rather than claiming the game ships nothing.
    iconsPending: !icons && allIds.length > 0,
  };
}

/** The search box and the list under it, shared by both pickers. */
function UnitList({
  forest,
  labels,
  icons,
  iconsPending,
  ids,
  factions,
  count,
  mode,
  isOn,
  onPick,
  autoFocusSearch = false,
}: {
  forest: ReturnType<typeof buildTechForest>;
  labels: Map<string, string>;
  icons: UnitBuildpicsResult | null;
  /** The build pics have not come back yet, so a row claims nothing about them. */
  iconsPending: boolean;
  /** The units to lay out, which can be a subset of the game. */
  ids: string[];
  factions: UnitPickerFaction[];
  /** Summary shown beside the search box, e.g. "12 available". */
  count?: string;
  mode: "multi" | "single" | "read-only";
  isOn: (id: string) => boolean;
  onPick: (id: string, on: boolean) => void;
  autoFocusSearch?: boolean;
}) {
  const [query, setQuery] = useState("");

  // A commander's tech levels are one row here, not five (issue #2063): only
  // the multi and read-only lists fold a stage into its base, because the
  // single-select pickers (placing an exact unit, a blueprint substitution)
  // need to offer the stage itself. A stage stands on its own row when its
  // base isn't among these ids either, so a caller's filtered subset never
  // loses a unit it did offer.
  const { rowIds, upgradeCount } = useMemo(() => {
    if (mode === "single")
      return { rowIds: ids, upgradeCount: new Map<string, number>() };
    const idSet = new Set(ids.map((raw) => raw.toLowerCase()));
    const upgradeCount = new Map<string, number>();
    const rowIds = ids.filter((raw) => {
      const id = raw.toLowerCase();
      const base = forest.morphBase.get(id) ?? id;
      if (base === id || !idSet.has(base)) return true;
      upgradeCount.set(base, (upgradeCount.get(base) ?? 0) + 1);
      return false;
    });
    return { rowIds, upgradeCount };
  }, [ids, forest, mode]);

  const label = (id: string) => {
    const name = labels.get(id) ?? id;
    const extra = upgradeCount.get(id) ?? 0;
    return extra > 0
      ? `${name}, ${extra} upgrade${extra === 1 ? "" : "s"}`
      : name;
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const name = (id: string) => labels.get(id) ?? id;
    const heading = (root: string) =>
      factions.find((f) => f.startUnit.toLowerCase() === root)?.name ??
      name(root);
    const match = q
      ? (id: string) => id.includes(q) || name(id).toLowerCase().includes(q)
      : undefined;
    return factionGroups(forest, rowIds, name, heading, match);
  }, [forest, rowIds, labels, factions, query]);

  const total = groups.reduce((n, g) => n + g.units.length, 0);
  const capped = total > SEARCH_CAP;
  let left = SEARCH_CAP;
  const showHeadings = groups.length > 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search units…"
          className="h-8"
          aria-label="Search units"
          // The popover opened for this box, and the list is long enough that
          // reaching it by tab is a step nobody asked for.
          autoFocus={autoFocusSearch}
        />
        {count && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {count}
          </span>
        )}
      </div>

      <ul className="flex max-h-80 flex-col overflow-auto rounded-md border border-border/50 p-1">
        {groups.map((group) => {
          const shown = group.units.slice(0, Math.max(left, 0));
          left -= shown.length;
          if (shown.length === 0) return null;
          return (
            <li key={group.id || "__other"}>
              {showHeadings && (
                <p className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
              )}
              <ul>
                {shown.map((id) => (
                  <UnitRow
                    key={id}
                    id={id}
                    label={label(id)}
                    display={icons?.units[id]}
                    pending={iconsPending}
                    on={isOn(id)}
                    mode={mode}
                    onPick={(on) => onPick(id, on)}
                  />
                ))}
              </ul>
            </li>
          );
        })}
        {total === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">
            No units match.
          </li>
        )}
        {capped && (
          <li className="px-2 py-1 text-xs text-muted-foreground">
            Showing the first {SEARCH_CAP} of {total}. Search to narrow it.
          </li>
        )}
      </ul>
    </div>
  );
}

/** One unit: build pic, name, internal id, and whatever the mode uses to pick it. */
function UnitRow({
  id,
  label,
  display,
  pending,
  on,
  mode,
  onPick,
}: {
  id: string;
  label: string;
  /** This unit's resolved build pic, absent until the icons come back. */
  display?: UnitDisplay;
  pending: boolean;
  on: boolean;
  mode: "multi" | "single" | "read-only";
  onPick: (on: boolean) => void;
}) {
  const body = (
    <>
      <UnitIcon display={display} pending={pending} />
      {/* The name gets the room. An author recognises a clipped internal id more
          easily than a clipped name, so the id is the column that gives way. */}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="max-w-[45%] truncate font-mono text-xs text-muted-foreground">
        {id}
      </span>
    </>
  );

  if (mode === "single") {
    return (
      <li>
        {/* A list of buttons rather than a listbox: the picked one says so with
            `aria-pressed`, and the search box above stays a plain text field
            instead of having to own arrow-key navigation for the list. */}
        <button
          type="button"
          aria-pressed={on}
          onClick={() => onPick(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm",
            "hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
            on && "bg-accent",
          )}
        >
          {body}
          {/* At the end, and only when it applies: a single-pick list has no
              checkbox, so holding a column open for one wasted the width the
              names needed. */}
          {on && <Check className="size-4 shrink-0" aria-hidden />}
        </button>
      </li>
    );
  }

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-2 rounded px-1 py-1 text-sm",
          // Only the read-only view tints the row. Where there are checkboxes the
          // checkbox is the state, and a tint behind every ticked row in a list
          // that starts fully ticked is a wall of colour saying nothing.
          mode === "read-only" &&
            on &&
            "bg-primary/10 ring-1 ring-inset ring-primary/40",
        )}
      >
        {mode === "read-only" ? (
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              on ? "bg-primary shadow-[0_0_6px_var(--primary)]" : "bg-muted",
            )}
          />
        ) : (
          <Checkbox
            checked={on}
            onCheckedChange={(v) => onPick(v === true)}
            aria-label={label}
          />
        )}
        {body}
      </div>
    </li>
  );
}

/** A unit's build pic, or a stand-in saying why there isn't one. */
function UnitIcon({
  display,
  pending = false,
  size = "default",
}: {
  display?: UnitDisplay;
  /** The pics are still being read, so this one is not missing, just not here. */
  pending?: boolean;
  size?: "sm" | "default";
}) {
  const src = unitIconSrc(display);
  const box = size === "sm" ? "size-5" : "size-7";
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={cn(box, "shrink-0 rounded object-contain")}
      />
    );
  }
  if (pending) {
    return (
      <span
        aria-hidden
        className={cn(box, "shrink-0 animate-pulse rounded bg-muted")}
      />
    );
  }
  const missing = buildPicMissing(display);
  return (
    <span
      title={missing.title}
      className={cn(
        box,
        "flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-center text-[0.55rem] leading-tight text-muted-foreground",
      )}
    >
      {/* The small box is 20px, which fits a swatch and not two words, so the
          trigger says it with the tooltip the box already carries. */}
      {size === "sm" ? null : missing.label}
    </span>
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
