/**
 * The searchable list of every unit in the selected game (issue #1270).
 *
 * Two lines a row beside the unit's build picture: the name a person reads, and
 * under it the faction and the internal key. The key earns its place rather than
 * being debug output, because it is what every other part of coilbox joins on
 * and what a tweak will be written against, so somebody working here needs to be
 * able to see it and search by it.
 *
 * The picture is the point (issue #2692). Picking one unit out of Beyond All
 * Reason's 564 is recognising it, not reading it, and the name on its own does
 * not even identify it: BAR has four units called "Advanced Aircraft Plant", one
 * per side. So the faction is on the row too, wherever the game's own build graph
 * reaches the unit.
 *
 * Per row rather than grouped under faction headings, which is what the content
 * side's `UnitPicker` does with the same facts. This list is sorted by name, and
 * someone here has usually come to find one unit they can already name. Grouping
 * would sort by faction first, which is a worse order for that.
 *
 * Every unit in the game is on it (issue #2709). It used to stop at 500 rows and
 * ask for a search term, which put 64 of Beyond All Reason's 564 out of reach of
 * anyone who did not already know a name to type. The rows are windowed instead:
 * only the ones in view plus a margin are in the DOM, so the cost is the height
 * of the column rather than the size of the game. `src/lib/rowVirtualize.ts` has
 * the arithmetic, shared with the mission Lua view it was written for.
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
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { UnitDisplay } from "@/content/bindings";
import { UnitIcon } from "@/content/pages/components/UnitIcon";
import { scrollTopForRow, visibleRowWindow } from "@/lib/rowVirtualize";
import type { BuildMenus } from "../../buildMenus";
import type { CloneOrigin, UnitClones } from "../../clones";
import { type DisabledUnits, isUnitDisabled } from "../../disabled";
import type { UnitOverrides } from "../../overrides";
import { type UnitTextEdits, unitTextCount } from "../../unitText";

/**
 * A row's height in pixels, pinned by an inline style on every row so the
 * windowing arithmetic and the real layout cannot drift apart.
 *
 * The worry is that rows are not all the same height, because a unit's faction
 * went on the second line in issue #2692 and plenty of units have no faction:
 * no side's build graph reaches them, and `armhaapuw` in Beyond All Reason is
 * one. Measured in the app, both kinds come out at the same 46 pixels, because
 * the faction shares the second line with the key rather than adding a third.
 * So this is the height they already had, plus the 2 pixels of the `gap-0.5`
 * that used to separate them, which the row now carries as its own padding.
 * Pinning it is belt and braces: a row that stops fitting will be visible
 * rather than sending the scroll position quietly wrong further down.
 */
const ROW_HEIGHT = 48;
/**
 * Rows kept in the DOM above and below the visible range, so a fast scroll does
 * not show a blank strip while the next frame's window catches up.
 */
const OVERSCAN = 8;

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
  picOf,
  picsPending,
  factionOf,
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
  /** This unit's build picture, from `unitPics.ts`. */
  picOf: (key: string) => UnitDisplay | undefined;
  /** The pictures are still being read, so a row claims nothing about them. */
  picsPending: boolean;
  /** Which side reaches this unit, where the game has more than one and its
   *  build graph reaches it at all. */
  factionOf: (key: string) => string | undefined;
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
  const rows = needle
    ? all.filter(
        (u) => u.key.includes(needle) || u.label.toLowerCase().includes(needle),
      )
    : all;

  // The element itself rather than a ref, because a search that matches
  // nothing takes the whole scroller out of the DOM and puts a fresh one back
  // when the search is cleared. A ref plus a mount-once effect would leave the
  // observer watching the element that went.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  /** A row waiting to take keyboard focus, once the scroll below has put it in
   *  the window and React has mounted it. Cleared as soon as it has. */
  const [focusRow, setFocusRow] = useState<number | null>(null);

  useEffect(() => {
    if (!scroller) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  // Clamped here rather than left to the scroll event, because a search that
  // shortens the list leaves `scrollTop` past the end of it for one frame, and
  // a window starting past the end of the list is an empty list.
  const { start, end } = visibleRowWindow(
    Math.min(scrollTop, Math.max(0, rows.length * ROW_HEIGHT - viewportHeight)),
    viewportHeight,
    rows.length,
    ROW_HEIGHT,
    OVERSCAN,
  );

  /** Scrolls the container by the least that puts `row` fully on screen, and
   *  tells the window about it in the same batch so the row is mounted by the
   *  time anything tries to touch it. */
  const revealRow = (row: number) => {
    if (!scroller) return;
    const top = row * ROW_HEIGHT;
    const next =
      top < scroller.scrollTop
        ? top
        : top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight
          ? top + ROW_HEIGHT - scroller.clientHeight
          : null;
    if (next === null) return;
    scroller.scrollTop = next;
    setScrollTop(next);
  };

  // A new search is a new list, so it is read from the top. Without this the
  // old offset carries over and the results open part way down, or past their
  // own end.
  useLayoutEffect(() => {
    if (!scroller || !needle) return;
    scroller.scrollTop = 0;
    setScrollTop(0);
  }, [needle, scroller]);

  const selectedRow = rows.findIndex((u) => u.key === selected);
  // A unit picked anywhere else - opening the page on one, following a link,
  // searching so its row moves - has to be somewhere you can see. Centred
  // rather than nudged into view, because a selection arriving from off screen
  // has no reading position to preserve. A row already on screen is left
  // alone, so clicking one never jumps the list under the pointer.
  useEffect(() => {
    if (!scroller || selectedRow < 0) return;
    const top = selectedRow * ROW_HEIGHT;
    if (
      top >= scroller.scrollTop &&
      top + ROW_HEIGHT <= scroller.scrollTop + scroller.clientHeight
    )
      return;
    const next = scrollTopForRow(
      selectedRow,
      rows.length,
      scroller.clientHeight,
      ROW_HEIGHT,
    );
    scroller.scrollTop = next;
    setScrollTop(next);
  }, [scroller, selectedRow, rows.length]);

  useLayoutEffect(() => {
    if (focusRow === null) return;
    scroller
      ?.querySelector<HTMLButtonElement>(`[data-row="${focusRow}"]`)
      ?.focus();
    setFocusRow(null);
  }, [focusRow, scroller]);

  const moveFocus = (to: number) => {
    if (rows.length === 0) return;
    const next = Math.min(rows.length - 1, Math.max(0, to));
    revealRow(next);
    setFocusRow(next);
  };

  // Arrow keys, because tab cannot do this job any more: a row that is not in
  // the window is not in the DOM, so tabbing off the end of it would drop
  // focus out of the list entirely. Only one row is a tab stop, which is also
  // the end of tabbing through hundreds of buttons to reach whatever is under
  // the list.
  const onRowKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const row = Number(
      (e.target as HTMLElement).closest("[data-row]")?.getAttribute("data-row"),
    );
    if (!Number.isInteger(row)) return;
    const to =
      e.key === "ArrowDown"
        ? row + 1
        : e.key === "ArrowUp"
          ? row - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    moveFocus(to);
  };

  // The tab stop follows the selected row, clamped into the window so there is
  // always exactly one rendered row to tab on to, even when the selection has
  // been scrolled out of the DOM.
  const tabStop = Math.min(
    Math.max(selectedRow < 0 ? 0 : selectedRow, start),
    Math.max(start, end - 1),
  );

  // The search box and the count are fixed at the top and bottom of the column
  // and only the rows scroll, so the count still answers "of how many" after
  // you have scrolled a long way down. Below `lg` the two panes stack and the
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
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unit matches "{query.trim()}".
        </p>
      ) : (
        <div
          ref={setScroller}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          className="max-h-[60vh] min-h-0 overflow-y-auto rounded-lg border border-border/50 p-1 lg:max-h-none lg:flex-1"
        >
          {/* The full length of the list, whether or not its rows are mounted,
            so the scrollbar is the size of the game rather than the size of
            the window. */}
          <div style={{ height: rows.length * ROW_HEIGHT }}>
            <ul
              onKeyDown={onRowKeyDown}
              style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
            >
              {rows.slice(start, end).map((u, i) => {
                const row = start + i;
                const edits =
                  Object.keys(overrides[u.key] ?? {}).length +
                  unitTextCount(text, u.key);
                const clone = clones[u.key];
                const menuEdits = menus[u.key]?.length ?? 0;
                const off = isUnitDisabled(disabled, u.key);
                const faction = factionOf(u.key);
                return (
                  // The position and the total are said out loud, because a
                  // list that only has 30 of its rows in the DOM would
                  // otherwise be read as a list of 30.
                  <li
                    key={u.key}
                    aria-posinset={row + 1}
                    aria-setsize={rows.length}
                    style={{ height: ROW_HEIGHT }}
                    className="pb-0.5"
                  >
                    <button
                      type="button"
                      data-row={row}
                      tabIndex={row === tabStop ? 0 : -1}
                      onClick={() => onSelect(u.key)}
                      aria-current={u.key === selected ? "true" : undefined}
                      className={cn(
                        "flex h-full w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                        u.key === selected && "bg-accent font-medium",
                      )}
                    >
                      <UnitIcon display={picOf(u.key)} pending={picsPending} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          className={cn(
                            "truncate",
                            off &&
                              "text-muted-foreground line-through decoration-muted-foreground/60",
                          )}
                        >
                          {u.label}
                        </span>
                        {/* The faction leads the second line because it is what
                      tells four units of the same name apart, and it is short
                      where the key is not, so the key is the one that gives
                      way when the column runs out. */}
                        <span className="flex min-w-0 items-baseline gap-1 text-[10px] text-muted-foreground">
                          {faction && (
                            <>
                              <span className="max-w-[50%] shrink-0 truncate">
                                {faction}
                              </span>
                              <span aria-hidden>·</span>
                            </>
                          )}
                          <span className="truncate font-mono">{u.key}</span>
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
                            className={
                              builtBy[u.key].stale
                                ? "rounded-full bg-destructive/15 px-1.5 text-[10px] font-medium text-destructive"
                                : "rounded-full border border-border px-1.5 text-[10px] font-medium text-muted-foreground"
                            }
                            title={
                              builtBy[u.key].stale
                                ? `Left behind when ${builtBy[u.key].projectName} was renamed. Its files are still in this game, so the game has two units. Clear them in the unit builder's export drawer.`
                                : `Built in the unit builder as ${builtBy[u.key].projectName} and exported into this game`
                            }
                          >
                            {builtBy[u.key].stale ? "stale" : "built"}
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
          </div>
        </div>
      )}
      {/* Both numbers while a search is on, because "12 units" alone does not
        say whether the game has 12 or 564. */}
      <p className="shrink-0 text-xs text-muted-foreground">
        {needle
          ? `${rows.length} of ${all.length} units`
          : `${all.length} unit${all.length === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
