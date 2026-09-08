/**
 * The searchable list of every unit in the selected game (issue #1270).
 *
 * Two lines a row: the name a person reads, and under it the internal key. The
 * key earns its place rather than being debug output, because it is what every
 * other part of coilbox joins on and what a tweak will be written against, so
 * somebody working here needs to be able to see it and search by it.
 *
 * A unit the project has edited is marked, because otherwise the only way to
 * find your own work again is to remember where you left it.
 *
 * A unit the project added is marked too, and sorted in among the game's own
 * rather than kept in a list of its own (issue #1272). It is a unit: it belongs
 * where its name puts it, and the mark is there to say whose it is.
 *
 * A builder whose build menu the project changes is marked as well, for the
 * same reason a changed field is (issue #1274). It is a separate mark, because
 * it is a separate kind of edit: a changed number and a changed roster are not
 * the same thing and the counts must not be added together.
 *
 * A unit the project switches off gets a mark of its own too (issue #2649), and
 * it is not a count: switching a unit off is one decision, not N edits, so it
 * says "off" rather than a number.
 */
import { cn, Input } from "@picoframe/frame";
import { useMemo, useState } from "react";
import type { BuildMenus } from "../../buildMenus";
import type { CloneOrigin, UnitClones } from "../../clones";
import { type DisabledUnits, isUnitDisabled } from "../../disabled";
import type { UnitOverrides } from "../../overrides";
import { type UnitTextEdits, unitTextCount } from "../../unitText";

/**
 * How many rows are drawn before the list stops and asks for a search term.
 * The same cap `GameUnitsPage` and `UnitPicker` use for the same job, rather
 * than a second number invented here.
 */
const RENDER_CAP = 500;

export function UnitList({
  units,
  selected,
  overrides,
  text,
  clones,
  builtBy,
  menus,
  disabled,
  nameOf,
  onSelect,
}: {
  /** The game's units with the project's own already in among them. */
  units: Record<string, Record<string, unknown>>;
  selected: string;
  overrides: UnitOverrides;
  /** Renames and rewritten tooltips a game keeps outside its unit table, which
   *  count towards a unit's mark the same way an override does (issue #2650). */
  text: UnitTextEdits;
  clones: UnitClones;
  /** Which units came out of the lego builder, keyed by unit (issue #2651). */
  builtBy?: Record<string, CloneOrigin>;
  /** The build menus the project changes, keyed by builder (issue #1274). */
  menus: BuildMenus;
  /** The units the project switches off (issue #2649). */
  disabled: DisabledUnits;
  /** What to call a unit, resolved by the page against the curated dataset. */
  nameOf: (key: string, def: Record<string, unknown>) => string;
  onSelect: (key: string) => void;
}) {
  const [query, setQuery] = useState("");

  const all = useMemo(
    () =>
      Object.entries(units)
        .map(([key, def]) => ({ key, label: nameOf(key, def) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [units, nameOf],
  );

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? all.filter(
        (u) => u.key.includes(needle) || u.label.toLowerCase().includes(needle),
      )
    : all;
  const rows = matches.slice(0, RENDER_CAP);

  // The search box and the count are fixed at the top and bottom of the column
  // and only the rows scroll, so the count still answers "of how many" after
  // you have scrolled past 500 of them. Below `lg` the two panes stack and the
  // page scrolls as one, so the column is capped rather than stretched.
  return (
    <div className="flex min-h-0 flex-col gap-2 lg:h-full">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search units…"
        aria-label="Search units"
        className="h-9 shrink-0"
      />
      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unit matches "{query.trim()}".
        </p>
      ) : (
        <ul className="flex max-h-[60vh] min-h-0 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/50 p-1 lg:max-h-none lg:flex-1">
          {rows.map((u) => {
            const edits =
              Object.keys(overrides[u.key] ?? {}).length +
              unitTextCount(text, u.key);
            const clone = clones[u.key];
            const menuEdits = menus[u.key]?.length ?? 0;
            const off = isUnitDisabled(disabled, u.key);
            return (
              <li key={u.key}>
                <button
                  type="button"
                  onClick={() => onSelect(u.key)}
                  aria-current={u.key === selected ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                    u.key === selected && "bg-accent font-medium",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        "truncate",
                        off &&
                          "text-muted-foreground line-through decoration-muted-foreground/60",
                      )}
                    >
                      {u.label}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {u.key}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {off && (
                      <span
                        className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground"
                        title="Disabled: taken off every build menu in the game when this is compiled"
                      >
                        off
                      </span>
                    )}
                    {/* A unit out of the lego builder is marked as built
                      rather than added, whether or not the game's read has
                      caught up with it (issue #2651). Its own chip because it
                      answers a different question: not "did I add this here"
                      but "is this one of mine at all", which in a game with
                      hundreds of units is the only way to find it again. */}
                    {builtBy?.[u.key] ? (
                      <span
                        className="rounded-full border border-border px-1.5 text-[10px] font-medium text-muted-foreground"
                        title={`Built in the unit builder as ${builtBy[u.key].projectName} and exported into this game`}
                      >
                        built
                      </span>
                    ) : (
                      clone && (
                        <span
                          className="rounded-full border border-border px-1.5 text-[10px] font-medium text-muted-foreground"
                          title={
                            clone.replacesGameUnit
                              ? `Your copy of ${clone.source}, standing in for the game's own`
                              : `A unit you added, copied from ${clone.source}`
                          }
                        >
                          {clone.replacesGameUnit ? "replaced" : "added"}
                        </span>
                      )
                    )}
                    {menuEdits > 0 && (
                      <span
                        className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
                        title={`Build menu changed, ${menuEdits} edit${menuEdits === 1 ? "" : "s"}`}
                      >
                        menu
                      </span>
                    )}
                    {edits > 0 && (
                      <span
                        className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
                        title={`${edits} field${edits === 1 ? "" : "s"} changed`}
                      >
                        {edits}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="shrink-0 text-xs text-muted-foreground">
        {matches.length > rows.length
          ? `Showing the first ${rows.length} of ${matches.length}. Search to narrow it.`
          : `${matches.length} unit${matches.length === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
