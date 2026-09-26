/**
 * Every change a project makes, grouped by unit, with the game's own value and
 * the project's beside it (issue #3112).
 *
 * The change ledger already traces each edit to what it compiles into
 * (`changeLedger.ts`, issue #2653), and the Checks page's own ledger group
 * still shows that trace: which file or tweak slot carries a change, and why
 * one did not reach either. That is a different question from the one this
 * page answers. "What have I changed" is the first thing somebody balancing a
 * game wants to know when they open a project, and reading it off the ledger's
 * ordinary rows means clicking into a unit's fields one at a time to see the
 * before and after. This page reads every changed field's game value and
 * project value straight off `gameUnits` and the project's own overrides, the
 * same tables the unit editor itself reads, and puts the two side by side.
 *
 * A unit or a library weapon the project adds or copies whole is shown as one
 * "added" line rather than a field row per key it carries: the whole unit is
 * new, so there is no game value to compare a key against, and a hundred field
 * rows for one new unit would swamp the edits somebody actually tuned.
 *
 * Each field row links to that field in the unit editor and can be reverted on
 * the spot. Revert clears the same override key the field's own reset button
 * does (`overrides.ts`'s `clearOverride`), through the page's normal edit path,
 * so undo puts it back like any other change.
 */
import { Button, Input } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import type { UnitDisplay } from "@/content/bindings";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import type { ChangeLedger } from "../../changeLedger";
import { type UnitClones, unitIsAdded } from "../../clones";
import { overrideValue, readPath, type UnitOverrides } from "../../overrides";
import { projectPath } from "../../routes";
import { evaluateUnitQuery, parseUnitQuery } from "../../searchQuery";
import { display } from "./UnitFieldRow";

export function ChangesPanel({
  projectId,
  ledger,
  loading,
  error,
  gameUnits,
  units,
  clones,
  overrides,
  nameOf,
  picOf,
  picsPending,
  factionOf,
  onRevertField,
}: {
  projectId: string | undefined;
  ledger: ChangeLedger | null;
  loading: boolean;
  error: string | null;
  /** The game's own read of its units, without the project's copies, so a
   *  field's game value is the game's and never the project's own clone. */
  gameUnits: Record<string, Record<string, unknown>>;
  /** The game's units with the project's own clones stood in among them, for
   *  a name, a picture and a search match that work on an added unit too. */
  units: Record<string, Record<string, unknown>>;
  /** The project's own copies (issue #1272), so a unit's changes can be shown
   *  as one "added" line rather than one row per field it carries. */
  clones: UnitClones;
  overrides: UnitOverrides;
  nameOf: (key: string, def: Record<string, unknown> | undefined) => string;
  picOf: (key: string) => UnitDisplay | undefined;
  picsPending: boolean;
  factionOf: (key: string) => string | undefined;
  /** Clear one field's override, through the page's own edit path so undo
   *  puts it back (issue #3112). */
  onRevertField: (unit: string, fieldPath: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("");

  const unitLedgers = useMemo(
    () => ledger?.units.filter((u) => u.changes.length > 0) ?? [],
    [ledger],
  );
  const totalChanges = unitLedgers.reduce((n, u) => n + u.changes.length, 0);

  const factions = useMemo(() => {
    const seen = new Set<string>();
    for (const u of unitLedgers) {
      const f = factionOf(u.unit);
      if (f) seen.add(f);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [unitLedgers, factionOf]);

  const needle = query.trim();
  const parsedQuery = useMemo(() => parseUnitQuery(needle), [needle]);

  const visible = useMemo(() => {
    if (!parsedQuery.ok) return [];
    return unitLedgers.filter((u) => {
      if (faction && factionOf(u.unit) !== faction) return false;
      const def = units[u.unit];
      return evaluateUnitQuery(parsedQuery.query, {
        key: u.unit,
        name: nameOf(u.unit, def),
        def,
        overrides: overrides[u.unit],
      });
    });
  }, [unitLedgers, parsedQuery, faction, factionOf, units, nameOf, overrides]);

  if (!projectId)
    return (
      <p className="text-muted-foreground text-sm">
        No project is open yet, so there is nothing to show.
      </p>
    );
  if (error)
    return (
      <p className="text-destructive text-sm">
        This project's changes could not be traced: {error}
      </p>
    );
  if (!ledger)
    return (
      <p className="text-muted-foreground text-sm">
        {loading ? "Tracing…" : "Not traced yet."}
      </p>
    );
  if (totalChanges === 0)
    return (
      <p className="text-muted-foreground text-sm">
        This project changes nothing yet.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search changed units, or "hp > 3000"'
          aria-label="Search changed units"
          className="h-8 max-w-xs text-xs"
        />
        {factions.length > 1 && (
          <OptionSelect
            size="sm"
            ariaLabel="Filter changes by faction"
            className="w-auto"
            value={faction}
            onValueChange={setFaction}
            options={[
              { value: "", label: "Every faction" },
              ...factions.map((f) => ({ value: f, label: f })),
            ]}
          />
        )}
      </div>
      {!parsedQuery.ok ? (
        <p className="text-destructive text-sm">{parsedQuery.error}</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No changed unit matches this search.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((unitLedger) => {
            const unit = unitLedger.unit;
            const added = unitIsAdded(clones, unit);
            // An added unit's own field changes are folded into the one
            // "added" line below rather than shown as field rows: the whole
            // unit is new, so there is no game value for one of its keys to
            // be compared against.
            const fieldChanges = added
              ? []
              : unitLedger.changes.filter((c) => c.fieldPath !== null);
            const otherChanges = unitLedger.changes.filter(
              (c) => c.fieldPath === null,
            );
            return (
              <li
                key={unit}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
              >
                <Link
                  to={projectPath(projectId, unit)}
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  <UnitIcon display={picOf(unit)} pending={picsPending} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {nameOf(unit, units[unit])}
                    </span>
                    <span className="flex min-w-0 items-baseline gap-1 text-[10px] text-muted-foreground">
                      {factionOf(unit) && (
                        <>
                          <span className="max-w-[50%] shrink-0 truncate">
                            {factionOf(unit)}
                          </span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <span className="truncate font-mono">{unit}</span>
                    </span>
                  </span>
                </Link>
                <ul className="flex flex-col gap-1.5 pl-2">
                  {otherChanges.map((change) => (
                    <li
                      key={change.description}
                      className="text-xs text-muted-foreground"
                    >
                      {change.description}
                    </li>
                  ))}
                  {fieldChanges.map((change) => {
                    const path = change.fieldPath as string;
                    return (
                      <li
                        key={path}
                        className="flex flex-col gap-0.5 rounded-md bg-primary/5 py-1 pl-2 pr-1"
                      >
                        <span className="flex items-center gap-1.5">
                          <Link
                            to={projectPath(projectId, unit, path)}
                            className="truncate font-mono text-xs text-primary hover:underline"
                            title={path}
                          >
                            {path}
                          </Link>
                          <span
                            className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
                            title="This value has been changed from the game's default."
                          >
                            edited
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Game: {display(readPath(gameUnits[unit], path))}
                          </span>
                          <span>
                            Project:{" "}
                            {display(overrideValue(overrides, unit, path))}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => onRevertField(unit, path)}
                            title={`Revert ${path} to the game's value`}
                            aria-label={`Revert ${path} to the game's value`}
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
