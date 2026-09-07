/**
 * The workshop's unit page: pick a game, find a unit, change its numbers
 * (issues #1270, #1271 and #2647).
 *
 * One route rather than a list route and a detail route, with the game and the
 * unit in the query string. A tweak is a set of edits across several units and
 * the person making it moves between them constantly, so unmounting the whole
 * page on every pick would throw away the edit set with it. `?game=` and
 * `?unit=` keep the deep link a separate detail route would have given.
 *
 * The edits live in this component's state and go nowhere else. Saving a project
 * to disk is issue #1282, and until it lands the page says so rather than
 * letting somebody spend an evening in here and lose it.
 *
 * Two reads, joined on the lowercased def key. `--unit-defs` gives the fields,
 * and the curated dataset gives the name a person reads, which is not in the
 * def for every game (see `unitName.ts`). The join is the one #1269 keyed its
 * output for.
 *
 * The units the project adds are held apart from the edits it makes, for the
 * reason `clones.ts` gives, and joined onto the game's table for everything
 * else: one browser, one field list, one way to edit a field (issue #1272).
 */
import { Button } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "@/content/config";
import {
  Diagnostics,
  EmptyState,
  SkeletonList,
} from "@/content/pages/components/states";
import {
  addClone,
  deriveClone,
  removeClone,
  type UnitClones,
  unitsWithClones,
} from "../clones";
import { useCustomParams, useUnitDefs } from "../config";
import {
  clearOverride,
  clearUnit,
  overrideCount,
  setOverride,
  type UnitOverrides,
} from "../overrides";
import { unitDisplayName } from "../unitName";
import { type FieldView, unitFieldView } from "../unitSections";
import { CloneUnitButton, DeleteCloneButton } from "./components/CloneActions";
import { UnitFieldGroups } from "./components/UnitFieldGroups";
import { UnitList } from "./components/UnitList";

/** Stable empties, so a page with neither does not re-derive on every render. */
const NO_UNITS: Record<string, Record<string, unknown>> = {};
const NO_CLONES: UnitClones = {};

export default function UnitPage() {
  const [params, setParams] = useSearchParams();
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);

  const games = scan.data?.games ?? [];
  const gameName = params.get("game") ?? "";
  const game = games.find((g) => g.name === gameName);
  const unitKey = params.get("unit") ?? "";

  const { defs, status, error, reload } = useUnitDefs(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  // The names, from the read that already answers for a game whose defs carry
  // none. Cheap next to the def table and cached for the session by its own
  // hook, and the list renders off the def table meanwhile rather than waiting.
  const { dataset } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );
  const named = useMemo(
    () => new Map((dataset?.units ?? []).map((u) => [u.name, u])),
    [dataset],
  );

  // What each custom parameter means, which is only ever "whatever this game's
  // Lua does with it". Runs alongside the defs rather than after them: nothing
  // on the page waits for it, and a row whose scan has not landed simply has no
  // note yet.
  const { consumers } = useCustomParams(
    selected?.enginePath,
    selected?.rootPath,
    game?.primaryArchive.name,
  );

  const [overrides, setOverrides] = useState<UnitOverrides>({});
  const [view, setView] = useState<FieldView>("relevant");
  // Kept per game. A copy of a unit is a whole definition taken out of one
  // game's table, so it has no meaning under another game, and the browser
  // would be showing units that game has never heard of.
  const [added, setAdded] = useState<Record<string, UnitClones>>({});
  const clones = added[gameName] ?? NO_CLONES;
  const updateClones = useCallback(
    (update: (current: UnitClones) => UnitClones) =>
      setAdded((all) => ({ ...all, [gameName]: update(all[gameName] ?? {}) })),
    [gameName],
  );

  // The curated dataset describes the game's units, so it is not asked about
  // one of ours: a copy that stands in for `armcom` would otherwise be handed
  // the game's name for `armcom` and show it instead of the one it was given.
  const nameOf = useCallback(
    (key: string, def: Record<string, unknown> | undefined) =>
      unitDisplayName(key, def, clones[key] ? undefined : named.get(key)),
    [named, clones],
  );

  const gameUnits = defs?.units ?? NO_UNITS;
  const units = useMemo(
    () => unitsWithClones(gameUnits, clones),
    [gameUnits, clones],
  );
  const unit = units[unitKey];
  const clone = clones[unitKey];
  const fields = useMemo(
    () => unitFieldView(unit, overrides, unitKey, view),
    [unit, overrides, unitKey, view],
  );

  // Replaces rather than pushes, so backing out of the page does not walk
  // through every unit that was looked at on the way.
  const select = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  };

  const edits = overrideCount(overrides);
  const unitEdits = Object.keys(overrides[unitKey] ?? {}).length;
  const addedCount = Object.keys(clones).length;

  /** Copy the selected unit, as the project has it, under a new name. */
  const createClone = (key: string, displayName: string, replaces: boolean) => {
    if (!unit) return;
    updateClones((current) =>
      addClone(
        current,
        deriveClone({
          key,
          source: unitKey,
          sourceDef: unit,
          patch: overrides[unitKey],
          displayName,
          replacesGameUnit: replaces,
        }),
      ),
    );
    select({ unit: key });
  };

  /** Take one of ours back out, edits and all: nothing else refers to it. */
  const deleteClone = () => {
    updateClones((current) => removeClone(current, unitKey));
    setOverrides((o) => clearUnit(o, unitKey));
    select({ unit: "" });
  };

  // `h-full` against the frame's own scroll container, so from `lg` up the two
  // panes each take the height that is left and scroll themselves rather than
  // the whole page scrolling as one. Below `lg` they stack and the frame
  // scrolls, which is why the height is not claimed there.
  return (
    <div className="flex flex-col gap-4 p-4 lg:h-full lg:min-h-0">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Unit tweaks</h1>
          <p className="text-xs text-muted-foreground">
            Change a unit's numbers. Only the fields you change are recorded, so
            the rest still follow the game when it updates. Copy a unit to add
            one of your own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OptionSelect
            className="w-64"
            size="sm"
            ariaLabel="Game"
            placeholder={scan.loading ? "Scanning…" : "Pick a game"}
            value={game?.name ?? ""}
            onValueChange={(name) => select({ game: name, unit: "" })}
            options={games.map((g) => ({ value: g.name, label: g.name }))}
          />
          {(edits > 0 || addedCount > 0) && (
            <span className="text-xs text-muted-foreground">
              {[
                edits > 0 && `${edits} change${edits === 1 ? "" : "s"}`,
                addedCount > 0 &&
                  `${addedCount} unit${addedCount === 1 ? "" : "s"} added`,
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </div>
      </header>

      {(edits > 0 || addedCount > 0) && (
        <Alert>
          <AlertTitle>These changes are not saved anywhere yet</AlertTitle>
          <AlertDescription>
            They live in this page for as long as it is open. Saving a tweak
            project to disk is still to come.
          </AlertDescription>
        </Alert>
      )}

      {scan.error && !scan.data && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">
            {scan.error}
          </AlertDescription>
        </Alert>
      )}

      {!game ? (
        <EmptyState
          label={
            scan.loading
              ? "Scanning for installed games…"
              : games.length === 0
                ? "No games are installed. Add one from the Library."
                : "Pick a game to see its units."
          }
        />
      ) : status === "error" ? (
        <Alert
          variant="destructive"
          className="flex items-center justify-between gap-3"
        >
          <span className="break-words">
            {error ?? "This game's unit definitions could not be read."}
          </span>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </Alert>
      ) : status !== "ready" || !defs ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Reading every unit definition in {game.name}. This mounts the game's
            archives and can take a while the first time.
          </p>
          <SkeletonList />
        </div>
      ) : (
        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <UnitList
            units={units}
            selected={unitKey}
            overrides={overrides}
            clones={clones}
            nameOf={nameOf}
            onSelect={(key) => select({ unit: key })}
          />

          {!unit ? (
            <EmptyState label="Pick a unit to see its fields." />
          ) : (
            <div className="flex min-w-0 flex-col gap-3 lg:min-h-0">
              <div className="flex flex-wrap items-center justify-between gap-2 lg:shrink-0">
                <div className="flex flex-col">
                  <h2 className="text-base font-semibold">
                    {nameOf(unitKey, unit)}
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">
                    {unitKey}
                  </span>
                  {clone && (
                    <span className="text-xs text-muted-foreground">
                      {clone.replacesGameUnit
                        ? `Yours, copied from ${clone.source}, in place of the game's own`
                        : `Yours, copied from ${clone.source}`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <CloneUnitButton
                    sourceKey={unitKey}
                    sourceName={nameOf(unitKey, unit)}
                    gameUnits={gameUnits}
                    clones={clones}
                    nameOf={nameOf}
                    onCreate={createClone}
                  />
                  {clone && (
                    <DeleteCloneButton
                      name={nameOf(unitKey, unit)}
                      edits={unitEdits}
                      onDelete={deleteClone}
                    />
                  )}
                  {unitEdits > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOverrides((o) => clearUnit(o, unitKey))}
                    >
                      <RotateCcw className="size-3.5" />
                      Reset {unitEdits} change{unitEdits === 1 ? "" : "s"}
                    </Button>
                  )}
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={view}
                    onValueChange={(v) => v && setView(v as FieldView)}
                    aria-label="Which fields to show"
                  >
                    <ToggleGroupItem value="relevant">Relevant</ToggleGroupItem>
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                  </ToggleGroup>
                  <span className="text-xs text-muted-foreground">
                    {view === "relevant"
                      ? `${fields.shown} shown, ${fields.hidden} hidden`
                      : `${fields.shown} shown`}
                  </span>
                </div>
              </div>

              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                <UnitFieldGroups
                  view={fields}
                  consumers={consumers}
                  inheritedLabel={clone ? "Copied value" : undefined}
                  onChange={(row, value) =>
                    setOverrides((o) =>
                      setOverride(o, unitKey, row.path, value, row.inherited),
                    )
                  }
                  onReset={(row) =>
                    setOverrides((o) => clearOverride(o, unitKey, row.path))
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {defs && defs.unitErrors.length > 0 && (
        <Diagnostics errors={defs.unitErrors} />
      )}
    </div>
  );
}
