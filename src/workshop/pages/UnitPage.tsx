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
 */
import { Button } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useScanTargetSelection, useUnitsyncScan } from "@/content/config";
import {
  Diagnostics,
  EmptyState,
  SkeletonList,
} from "@/content/pages/components/states";
import { useUnitDefs } from "../config";
import {
  clearOverride,
  clearUnit,
  overrideCount,
  setOverride,
  type UnitOverrides,
} from "../overrides";
import { type FieldView, unitFieldView } from "../unitSections";
import { UnitFieldGroups } from "./components/UnitFieldGroups";
import { UnitList, unitLabel } from "./components/UnitList";

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

  const [overrides, setOverrides] = useState<UnitOverrides>({});
  const [view, setView] = useState<FieldView>("relevant");

  const unit = defs?.units[unitKey];
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Unit tweaks</h1>
          <p className="text-xs text-muted-foreground">
            Change a unit's numbers. Only the fields you change are recorded, so
            the rest still follow the game when it updates.
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
          {edits > 0 && (
            <span className="text-xs text-muted-foreground">
              {edits} change{edits === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </header>

      {edits > 0 && (
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
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <UnitList
            units={defs.units}
            selected={unitKey}
            overrides={overrides}
            onSelect={(key) => select({ unit: key })}
          />

          {!unit ? (
            <EmptyState label="Pick a unit to see its fields." />
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col">
                  <h2 className="text-base font-semibold">
                    {unitLabel(unitKey, unit)}
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">
                    {unitKey}
                  </span>
                </div>
                <div className="flex items-center gap-2">
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

              <UnitFieldGroups
                view={fields}
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
          )}
        </div>
      )}

      {defs && defs.unitErrors.length > 0 && (
        <Diagnostics errors={defs.unitErrors} />
      )}
    </div>
  );
}
