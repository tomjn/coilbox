/**
 * What a selected actor is, beyond where it stands: whose it is, which way it
 * faces, and the four overrides the runtime applies to it at spawn.
 *
 * Team is on the bar because it is the one an author changes while looking at
 * the map. The rest are behind a popover: an exact facing, a starting health, an
 * invulnerable or unselectable flag and a display name are all things set once
 * for a character unit and then left alone, and a bar wide enough to hold them
 * all would cover the map they describe.
 *
 * Health and the display name are held here while they are being changed and
 * written when the gesture ends, because every change to the document is saved:
 * a dragged slider would otherwise write a file per frame. Mount this keyed by
 * the actor's id so moving the selection reseeds both.
 *
 * Both copies follow the actor when its overrides change on their own, which is
 * what an undo does (issue #2185). An actor's id is not its health or its name,
 * so the key does not cover that: before this, the slider and the box carried on
 * showing what was there before the step back, and the next nudge or keystroke
 * wrote it over the restored value.
 *
 * What each follows is what it shows rather than what is written down, because
 * neither is stored as it is shown. Health is a percentage of a fraction and
 * full health is no override at all, so `hp` is absent at 100%. The display name
 * is dropped when it is blank, so an actor with no name has no `name` either.
 *
 * The team select and the difficulty range also carry what the validator
 * found wrong with them, next to the field rather than left to the problems
 * drawer alone: a team the setup no longer has, and a range that can never
 * apply at any setting (issue #2307, extending #2287's pattern from the
 * Triggers panel).
 *
 * An actor standing off the map is said the same way, but as a row-level note
 * rather than a field problem (issue #2343): its position is dragged on the
 * map, not typed here, so there is no control for `aria-invalid` to sit on.
 * A unit type the game has not got is a third row-level note for the same
 * reason: `unitDef` is picked once at placement rather than edited here
 * (issue #2346).
 */

import { Button, Input } from "@picoframe/frame";
import { SlidersHorizontal } from "lucide-react";
import { useId } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useFieldText } from "@/lib/useFieldText";
import type { Participant } from "@/play/config";
import type { ActorState, Facing, ScenarioActor } from "../../model";
import type { MissionIssue } from "../../validate";
import { DifficultyRangeFields } from "./DifficultyRangeFields";
import { MIN_ACTOR_HP } from "./editing";
import { FieldProblem, RowProblem } from "./panels";
import { TeamSelect } from "./TeamSelect";
import { entryFieldProblem } from "./triggerProblems";

/** The engine's four facings, in the order it numbers them. */
const FACINGS: { value: string; label: string }[] = [
  { value: "0", label: "Faces south" },
  { value: "1", label: "Faces east" },
  { value: "2", label: "Faces north" },
  { value: "3", label: "Faces west" },
];

export function ActorControls({
  actor,
  participants,
  issues,
  onEdit,
  onState,
}: {
  actor: ScenarioActor;
  participants: Participant[];
  /** What the validator has found wrong with the mission (issue #2307). */
  issues: MissionIssue[];
  /** Change the actor's own fields, as {@link editActor} takes them. */
  onEdit: (patch: Partial<Omit<ScenarioActor, "id">>) => void;
  /** Replace the actor's overrides, which are normalised on the way in. */
  onState: (state: ActorState) => void;
}) {
  const state = actor.state ?? {};
  const [shown, setShown] = useFieldText(
    String(Math.round((state.hp ?? 1) * 100)),
  );
  const health = Number(shown);
  const [name, setName] = useFieldText(state.name ?? "");
  const teamDescribedBy = useId();
  const teamProblem = entryFieldProblem(issues, "actors", actor.id, "team");
  const posProblem = entryFieldProblem(issues, "actors", actor.id, "pos");
  // The unit type is picked once at placement and is not a field this popover
  // edits, the same reason `pos` above is a row-level note rather than a
  // field problem (issue #2346).
  const unitDefProblem = entryFieldProblem(
    issues,
    "actors",
    actor.id,
    "unitDef",
  );

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <TeamSelect
          participants={participants}
          value={actor.team}
          onValueChange={(team) => onEdit({ team })}
          className="w-32"
          ariaLabel="Team"
          ariaInvalid={teamProblem !== null}
          describedBy={teamDescribedBy}
        />
        <FieldProblem id={teamDescribedBy} problem={teamProblem} />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <SlidersHorizontal className="size-3.5" /> Details
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <RowProblem problem={posProblem} />
          <RowProblem problem={unitDefProblem} />
          <Field label="Facing">
            <OptionSelect
              size="sm"
              value={String(actor.facing)}
              onValueChange={(value) =>
                onEdit({ facing: (Number(value) % 4) as Facing })
              }
              options={FACINGS}
            />
          </Field>

          <Field label={`Starting health: ${health}%`}>
            <Slider
              aria-label="Starting health"
              min={MIN_ACTOR_HP * 100}
              max={100}
              step={1}
              value={[health]}
              onValueChange={([next]) => setShown(String(next))}
              onValueCommit={([next]) => onState({ ...state, hp: next / 100 })}
            />
          </Field>

          <Toggle
            id="actor-invulnerable"
            label="Invulnerable"
            checked={state.invulnerable === true}
            onCheckedChange={(on) => onState({ ...state, invulnerable: on })}
          />
          <Toggle
            id="actor-unselectable"
            label="Unselectable"
            checked={state.unselectable === true}
            onCheckedChange={(on) => onState({ ...state, unselectable: on })}
          />

          <Field label="Display name">
            <Input
              aria-label="Display name"
              placeholder="Shown over the unit"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => onState({ ...state, name })}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-8 text-xs"
            />
          </Field>

          {/* Which difficulties this actor is placed at (issue #2164). Below
              the overrides, because it is a question about the mission rather
              than about the unit, and most actors never leave it alone. */}
          <div className="border-t border-border/60 pt-3">
            <DifficultyRangeFields
              value={actor.difficulty}
              onChange={(difficulty) => onEdit({ difficulty })}
              problem={entryFieldProblem(
                issues,
                "actors",
                actor.id,
                "difficulty",
              )}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
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

function Toggle({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
