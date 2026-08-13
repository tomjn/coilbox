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
 * Where a pairing came from is not shown, because nothing records it. A group
 * is a map of side name to def, so there is no key a source could go under that
 * a game is not free to name a side after, and giving one takes a shape change
 * rather than a surface. https://github.com/tomjn/coilbox/issues/1537.
 *
 * Pure and rendered in a test. The hooks are `./GameEquivalents.tsx`.
 */

import { Button } from "@picoframe/frame";
import { Shuffle, X } from "lucide-react";
import { type EquivalenceTable, tableSides } from "../../equivalents";

export function EquivalentsPanel({
  table,
  onForget,
  onForgetAll,
}: {
  table: EquivalenceTable;
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
        in another side, ahead of anything it can read off a unit's name. They
        come from what you picked while converting, and from this game's own
        published table where you asked coilbox to read one.
      </p>
      <ul className="divide-y divide-border/40 rounded-lg border border-border/50 bg-card">
        {table.groups.map((group, at) => {
          const said = sides.filter((side) => group[side] !== undefined);
          return (
            <li
              // A table holds no ids and two groups can honestly name the same
              // def, so where it stands is the only thing telling them apart.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={`${at}-${said.map((side) => group[side]).join("-")}`}
              className="flex items-center gap-3 px-3 py-1.5 text-sm"
            >
              <dl className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5">
                {said.map((side) => (
                  <div key={side} className="flex items-baseline gap-1.5">
                    <dt className="text-xs text-muted-foreground">{side}</dt>
                    <dd className="font-mono text-xs">{group[side]}</dd>
                  </div>
                ))}
              </dl>
              <Button
                size="sm"
                variant="ghost"
                className="size-7 shrink-0 p-0"
                aria-label={`Forget ${said.map((side) => group[side]).join(" and ")}`}
                onClick={() => onForget(at)}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="max-w-prose text-xs text-muted-foreground">
        Forgetting one is how a wrong answer is corrected. The next layout of
        this game you convert asks about it again, and keeps whatever you say
        then.
      </p>
    </section>
  );
}
