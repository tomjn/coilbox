/**
 * The difficulties one thing exists at (issue #2164), as two pickers.
 *
 * The same control wherever a range can be set, because the question is the same
 * one for an actor, a group, a base and a trigger, and an author who has learned
 * it in one popover should not meet a different shape in the next.
 *
 * Two bounds rather than a row of ticks. It is the shape the document stores,
 * and it stays right when a difficulty is added between two that already exist:
 * a base marked "hard and up" gains the new hardest level rather than quietly
 * disappearing from it.
 *
 * "Any" is how a bound is cleared, and a range with neither bound is no range at
 * all, which is what everything already authored says. That is what keeps the
 * whole thing additive: an author who never opens these two pickers writes a
 * document with no difficulty in it, compiling to the bytes it always did.
 */

import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import {
  DIFFICULTIES,
  type Difficulty,
  type DifficultyRange,
} from "../../model";

/** The value the pickers use for "no bound this way". */
const ANY = "any";

const LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

const options = (blank: string) => [
  { value: ANY, label: blank },
  ...DIFFICULTIES.map((level) => ({ value: level, label: LABEL[level] })),
];

const read = (value: string): Difficulty | undefined =>
  value === ANY ? undefined : (value as Difficulty);

/**
 * The range one picker leaves behind: what was there with one bound replaced,
 * or nothing at all once neither bound is set.
 *
 * The "nothing at all" is the load-bearing half. An author who set a bound and
 * then put it back to Any has to end up with the document they started with,
 * or every scenario somebody opened and thought about would carry an empty
 * range and ask for a runtime it does not need.
 */
export function rangeWith(
  range: DifficultyRange | undefined,
  bound: "atLeast" | "atMost",
  value: string,
): DifficultyRange | undefined {
  const next = { ...range, [bound]: read(value) };
  return next.atLeast || next.atMost ? next : undefined;
}

export function DifficultyRangeFields({
  value,
  onChange,
}: {
  value: DifficultyRange | undefined;
  /** The new range, or undefined once it bounds nothing. */
  onChange: (range: DifficultyRange | undefined) => void;
}) {
  const range = value ?? {};

  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Only from">
        <OptionSelect
          size="sm"
          value={range.atLeast ?? ANY}
          onValueChange={(next) => onChange(rangeWith(value, "atLeast", next))}
          options={options("Any difficulty")}
        />
      </Field>
      <Field label="Only up to">
        <OptionSelect
          size="sm"
          value={range.atMost ?? ANY}
          onValueChange={(next) => onChange(rangeWith(value, "atMost", next))}
          options={options("Any difficulty")}
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}
