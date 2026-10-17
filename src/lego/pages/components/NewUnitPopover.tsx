import { Button } from "@picoframe/frame";
import { Plus } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BodyPlan } from "../../bodyPlans";

interface Props {
  /** The starting points besides Blank, from the body plan registry. */
  plans: readonly BodyPlan[];
  /** The button's text. */
  label: string;
  busy?: boolean;
  /** The plan chosen, or null for the blank start. */
  onChoose: (plan: BodyPlan | null) => void;
}

/**
 * The button that starts a unit. With no plans registered it starts a blank
 * unit at once, as it always did. With plans it opens a popover that offers
 * Blank first and then each plan with its one line description.
 */
export function NewUnitPopover({ plans, label, busy, onChoose }: Props) {
  const [open, setOpen] = useState(false);

  if (plans.length === 0) {
    return (
      <Button onClick={() => onChoose(null)} disabled={busy}>
        <Plus size={16} /> {label}
      </Button>
    );
  }

  function choose(plan: BodyPlan | null) {
    setOpen(false);
    onChoose(plan);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button disabled={busy}>
          <Plus size={16} /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <ul className="space-y-0.5">
          <Entry
            label="Blank"
            description="One empty piece to build from."
            onClick={() => choose(null)}
          />
          {plans.map((plan) => (
            <Entry
              key={plan.id}
              label={plan.label}
              description={plan.description}
              onClick={() => choose(plan)}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Entry({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span data-plan-label className="block text-sm font-medium">
          {label}
        </span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </button>
    </li>
  );
}
