import { Button } from "@picoframe/frame";
import { Plus } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BodyPlan } from "../../bodyPlans";
import type { SkeletonTarget } from "../../model";
import { defaultTarget } from "../../skeletonSize";
import { DescribeUnitForm } from "./DescribeUnitForm";
import { SkeletonTargetFields } from "./SkeletonTargetFields";

interface Props {
  /** The starting points besides Blank, from the body plan registry. */
  plans: readonly BodyPlan[];
  /** The button's text. */
  label: string;
  busy?: boolean;
  /** The plan chosen with the size to fit it to, or null for the blank start. */
  onChoose: (plan: BodyPlan | null, target?: SkeletonTarget) => void;
}

/**
 * The button that starts a unit. With no plans registered it starts a blank
 * unit at once, as it always did. With plans it opens a popover that offers
 * Blank first and then each plan with its one line description. A plan then
 * asks for the footprint and height to fit its skeleton to.
 */
export function NewUnitPopover({ plans, label, busy, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<BodyPlan | null>(null);
  const [target, setTarget] = useState<SkeletonTarget | null>(null);
  const [describing, setDescribing] = useState(false);

  if (plans.length === 0) {
    return (
      <Button onClick={() => onChoose(null)} disabled={busy}>
        <Plus size={16} /> {label}
      </Button>
    );
  }

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setPicked(null);
      setDescribing(false);
    }
  }

  function pick(plan: BodyPlan) {
    setPicked(plan);
    setTarget(defaultTarget(plan));
  }

  function chooseBlank() {
    close(false);
    onChoose(null);
  }

  function start() {
    if (!picked || !target) return;
    close(false);
    onChoose(picked, target);
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger asChild>
        <Button disabled={busy}>
          <Plus size={16} /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        {describing ? (
          <DescribeUnitForm
            onBack={() => setDescribing(false)}
            onStart={(plan, size) => {
              close(false);
              onChoose(plan, size);
            }}
          />
        ) : picked ? (
          <form
            className="space-y-3 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <p className="text-sm font-medium">{picked.label}</p>
            <SkeletonTargetFields
              initial={defaultTarget(picked)}
              onChange={setTarget}
            />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPicked(null)}
              >
                Back
              </Button>
              <Button type="submit" size="sm" disabled={!target}>
                Start
              </Button>
            </div>
          </form>
        ) : (
          <>
            <ul className="space-y-0.5">
              <Entry
                label="Blank"
                description="One empty piece to build from."
                onClick={chooseBlank}
              />
              {plans.map((plan) => (
                <Entry
                  key={plan.id}
                  label={plan.label}
                  description={plan.description}
                  onClick={() => pick(plan)}
                />
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setDescribing(true)}
              className="mt-1 w-full rounded border-t border-border px-2 py-1.5 text-left text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Describe it instead
            </button>
          </>
        )}
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
