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
 */

import { Button, Input } from "@picoframe/frame";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Participant } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { ActorState, Facing, ScenarioActor } from "../../model";
import { MIN_ACTOR_HP } from "./editing";
import { TeamSelect } from "./TeamSelect";

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
  onEdit,
  onState,
}: {
  actor: ScenarioActor;
  participants: Participant[];
  /** Change the actor's own fields, as {@link editActor} takes them. */
  onEdit: (patch: Partial<Omit<ScenarioActor, "id">>) => void;
  /** Replace the actor's overrides, which are normalised on the way in. */
  onState: (state: ActorState) => void;
}) {
  const state = actor.state ?? {};
  const [health, setHealth] = useState(Math.round((state.hp ?? 1) * 100));
  const [name, setName] = useState(state.name ?? "");

  return (
    <>
      <TeamSelect
        participants={participants}
        value={actor.team}
        onValueChange={(team) => onEdit({ team })}
        className="w-32"
      />
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
              onValueChange={([next]) => setHealth(next)}
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
