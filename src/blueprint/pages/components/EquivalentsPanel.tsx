/**
 * What coilbox has been told about one game's equivalent buildings (issue
 * #1533).
 *
 * The table was writable long before it was readable. It is answered one pair
 * at a time while converting a layout, kept per game, and used first for every
 * later layout of that game, and until now the only way to see an answer was to
 * open a conversion for a layout that happened to name the def, and the only
 * way to correct one was to convert something again and pick differently.
 *
 * That is the wrong shape for this feature in particular, because the rule it
 * lives by is that a wrong substitution silently changes what a base builds. An
 * answer given once, reused forever and never shown is the worst version of
 * that: somebody who mistypes a pair has nowhere to go and look.
 *
 * So: the whole table as a list, on the game it is about. Dropping one is the
 * correction, because the next conversion asks the question again and keeps the
 * answer given then. Dropping the lot is there for somebody who would rather
 * start again than pick through it.
 *
 * Each answer says whose it is (issue #1537), because they are not equally
 * trustworthy and the difference is the first thing somebody hunting a wrong one
 * wants. An answer they gave is one they meant. One a game's file brought is one
 * nobody here chose. One from before coilbox recorded any of this is marked as
 * nothing at all, and the list says so rather than letting it read as a third
 * kind.
 *
 * Marked per answer rather than per row, because merging a game's file fills in
 * the sides a person never answered for and leaves the ones they did, so a row
 * really is part theirs and part the game's.
 *
 * The rows they answered come first (issue #1545). Reading Beyond All Reason's
 * published table lands 87 at once, and finding their own five among those by
 * eye is the work marking them was meant to remove. Ordered rather than
 * filtered, because the question somebody has is which answers are theirs
 * rather than which rows to hide, and this list is the one place every answer
 * is looked at: a row a control has hidden is a row nobody checks.
 *
 * A long table can also be searched for one building (issue #1547), which is
 * the other question people arrive with: what does coilbox think corak is,
 * asked because a base built the wrong thing. Ordering does not answer that,
 * and 87 rows is too many to read for one name.
 *
 * A box that hides rows is the thing issue #1545 declined to add, so this one
 * is built to be impossible to leave on by accident. It holds nothing between
 * visits, so the page always opens on the whole table. It shows what was typed,
 * says how many of how many rows are left, and offers to clear itself. It is
 * only offered for a table long enough that reading it by eye is real work, and
 * it is ignored where it is not offered, so dropping rows down to a short table
 * cannot leave one hidden with nothing on the page to say why. A search that
 * finds nothing says so, which is itself an answer: coilbox has nothing
 * recorded for that building.
 *
 * Pure and rendered in a test. The hooks are `./GameEquivalents.tsx`.
 */

import { Button, Input } from "@picoframe/frame";
import { Shuffle, X } from "lucide-react";
import {
  answeredByYou,
  defIn,
  type EquivalenceTable,
  namesDef,
  orderYoursFirst,
  sourceIn,
  tableSides,
} from "../../equivalents";

/**
 * How long a table has to be before searching it beats reading it.
 *
 * A dozen rows is a glance, and a control that hides rows earns its place only
 * where the alternative is real work. Beyond All Reason's published table is 87
 * rows, and a table somebody answered a pair at a time is nowhere near this.
 */
const WORTH_SEARCHING = 12;

export function EquivalentsPanel({
  table,
  query,
  onQuery,
  onForget,
  onForgetAll,
}: {
  table: EquivalenceTable;
  /** What somebody has typed to find one building. */
  query: string;
  onQuery: (typed: string) => void;
  /** Drop the pairing standing at this place in the table. */
  onForget: (at: number) => void;
  onForgetAll: () => void;
}) {
  // A game nobody has answered anything about has nothing to look at and
  // nothing to correct, so the page says nothing rather than saying "none".
  if (table.groups.length === 0) return null;

  // One column order for the whole list, in the order the table first heard of
  // each side, so a group missing a side reads as a gap rather than shuffling
  // the ones it has.
  const sides = tableSides(table);

  // Whether anything here is old enough that coilbox cannot say where it came
  // from. Said only when there is one, so a table that can account for itself
  // does not carry a caveat about a case it does not have.
  const anyUnsourced = table.groups.some((group) =>
    sides.some(
      (side) => defIn(group, side) !== undefined && !sourceIn(group, side),
    ),
  );

  // A search is offered only where the list is long enough to need one, and
  // what is not offered is not applied, so a table dropped back under that
  // length shows every row again rather than keeping a search nobody can see.
  const searchable = table.groups.length >= WORTH_SEARCHING;
  const hunt = searchable ? query.trim() : "";

  // The person's own answers first, and how many that is, so a table a game's
  // file filled can still be read for what they said (issue #1545). Said only
  // when the order is doing something, which is a table holding both kinds. The
  // order holds inside a search, because narrowing to five rows does not stop
  // two of them being theirs.
  const order = orderYoursFirst(table).filter((at) =>
    namesDef(table.groups[at], hunt),
  );
  const mine = table.groups.filter(answeredByYou).length;
  const mixed = mine > 0 && mine < table.groups.length;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Shuffle className="size-4 text-muted-foreground" aria-hidden />
          Equivalent buildings
        </h2>
        <Button size="sm" variant="outline" onClick={onForgetAll}>
          Forget all {table.groups.length}
        </Button>
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">
        Which of this game's buildings coilbox treats as each side's version of
        the same thing. It uses these first when a layout of this game is said
        in another side, ahead of anything it can read off a unit's name. Each
        answer says where it came from: you picked it while converting, or this
        game's own published table brought it when you asked coilbox to read
        one.
        {mixed &&
          ` The ${mine} holding an answer you gave ${mine === 1 ? "is" : "are"} first, because reading a game's table brings enough at once to lose them in.`}
      </p>
      {searchable && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Find a building"
            aria-label="Find a building"
            className="w-56"
          />
          {hunt !== "" && (
            <>
              <span className="text-xs text-muted-foreground">
                Showing {order.length} of {table.groups.length}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onQuery("")}>
                Clear
              </Button>
            </>
          )}
        </div>
      )}
      {order.length === 0 ? (
        <p className="rounded-lg border border-border/50 bg-card px-3 py-2 text-xs text-muted-foreground">
          Nothing in this table names {hunt}, so coilbox has no answer recorded
          for it and would fall back on reading the name when converting.
        </p>
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/50 bg-card">
          {order.map((at) => {
            // Everything on the row comes from where the group stands rather than
            // from where it is shown, so what a row names and what dropping it
            // drops cannot come apart.
            const group = table.groups[at];
            const said = sides.filter(
              (side) => defIn(group, side) !== undefined,
            );
            return (
              <li
                // A table holds no ids and two groups can honestly name the same
                // def, so where it stands is the only thing telling them apart.
                key={`${at}-${said.map((side) => defIn(group, side)).join("-")}`}
                className="flex items-center gap-3 px-3 py-1.5 text-sm"
              >
                <dl className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5">
                  {said.map((side) => {
                    const from = sourceIn(group, side);
                    return (
                      <div key={side} className="flex items-baseline gap-1.5">
                        <dt className="text-xs text-muted-foreground">
                          {side}
                        </dt>
                        <dd className="font-mono text-xs">
                          {defIn(group, side)}
                          {from && (
                            <span className="ml-1.5 font-sans text-[0.65rem] text-muted-foreground">
                              {from === "you" ? "you" : "the game"}
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 shrink-0 p-0"
                  aria-label={`Forget ${said.map((side) => defIn(group, side)).join(" and ")}`}
                  onClick={() => onForget(at)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="max-w-prose text-xs text-muted-foreground">
        Forgetting one is how a wrong answer is corrected. The next layout of
        this game you convert asks about it again, and keeps whatever you say
        then.
        {anyUnsourced &&
          " An answer with nothing after it is one coilbox held before it started recording where they came from, so there is no longer anybody to ask."}
      </p>
    </section>
  );
}
