import { Button } from "@picoframe/frame";
import { type ReactNode, useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BodyPlan } from "../../bodyPlans";
import {
  type Description,
  describedPlan,
  MAX_WEAPONS,
  MOVES,
  type MoveId,
} from "../../describedPlan";
import type { SkeletonTarget } from "../../model";
import { defaultTarget } from "../../skeletonSize";
import { SkeletonTargetFields } from "./SkeletonTargetFields";

interface Props {
  onBack: () => void;
  onStart: (plan: BodyPlan, target: SkeletonTarget) => void;
}

const WEAPON_CHOICES = Array.from({ length: MAX_WEAPONS + 1 }, (_, n) => n);

/** The plan whose size rule and default size apply. A weapon or a build arm
 *  adds none, so a size typed stays through them. */
const sizedBy = (plan: BodyPlan) => plan.basedOn ?? plan.id;

/**
 * The four questions (#3263): how it moves, how many weapons, whether it
 * builds, and how big. Each answer is a fixed choice or a size, never a role or
 * a preset name. The first three pick a body plan (`describedPlan`) and the
 * last is the size it is fitted to.
 */
export function DescribeUnitForm({ onBack, onStart }: Props) {
  const [answer, setAnswer] = useState<Description>({
    move: "biped",
    weapons: 0,
    builds: false,
  });
  const plan = describedPlan(answer);
  const [target, setTarget] = useState<SkeletonTarget | null>(
    defaultTarget(plan),
  );

  /** A new answer. A plan with another size rule starts over at its own size. */
  function change(next: Description) {
    const nextPlan = describedPlan(next);
    if (sizedBy(nextPlan) !== sizedBy(plan)) {
      setTarget(defaultTarget(nextPlan));
    }
    setAnswer(next);
  }

  return (
    <form
      className="space-y-3 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (target) onStart(plan, target);
      }}
    >
      <Question label="How does it move?">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          className="flex-wrap"
          value={answer.move}
          onValueChange={(id) => {
            if (id !== "") change({ ...answer, move: id as MoveId });
          }}
          aria-label="How does it move?"
        >
          {MOVES.map((m) => (
            <ToggleGroupItem key={m.id} value={m.id}>
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Question>
      <Question label="How many weapons?">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(answer.weapons)}
          onValueChange={(value) => {
            if (value !== "") change({ ...answer, weapons: Number(value) });
          }}
          aria-label="How many weapons?"
        >
          {WEAPON_CHOICES.map((n) => (
            <ToggleGroupItem key={n} value={String(n)}>
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          One at most: the script has one weapon.
        </p>
      </Question>
      <Question label="Does it build?">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={answer.builds ? "yes" : "no"}
          onValueChange={(value) => {
            if (value !== "") change({ ...answer, builds: value === "yes" });
          }}
          aria-label="Does it build?"
        >
          <ToggleGroupItem value="no">No</ToggleGroupItem>
          <ToggleGroupItem value="yes">Yes</ToggleGroupItem>
        </ToggleGroup>
      </Question>
      <Question label="How big?">
        <SkeletonTargetFields
          key={sizedBy(plan)}
          initial={defaultTarget(plan)}
          onChange={setTarget}
        />
      </Question>
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={!target}>
          Start
        </Button>
      </div>
    </form>
  );
}

function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}
