/**
 * The unit's movement class, speed and turn rate, picked from the game it is
 * tested against (issue #3255). See `movement.ts` for how the classes are
 * narrowed and where the numbers come from.
 */

import { Input } from "@picoframe/frame";
import { Field } from "../../../components/Field";
import { OptionSelect } from "../../../components/OptionSelect";
import { useUnitDefs } from "../../../workshop/config";
import type { LegoMovement, LegoProject } from "../../model";
import {
  declaresMoveClass,
  KIND_LABEL,
  movementKinds,
  movementState,
  suggestMotion,
} from "../../movement";
import type { UnitBounds } from "../../s3oBuild";
import { footprintSteps } from "../../unitDef";
import { useTestGame } from "./useTestGame";

/** The option that leaves the unit static. Radix's select has no empty value. */
const STATIC = "__static";

interface Props {
  project: LegoProject;
  bounds: UnitBounds;
  onMovementChange: (movement: LegoMovement | undefined) => void;
}

export function MovementSection({ project, bounds, onMovementChange }: Props) {
  const { target, targetLoading, scan, game } = useTestGame();
  const { defs, defsFor, status, error } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const kinds = movementKinds(project);
  const footprint = Math.max(
    footprintSteps(bounds.sizeX),
    footprintSteps(bounds.sizeZ),
  );
  // The previous game's table is not this game's, for the render before the
  // next read starts.
  const current =
    defs && defsFor === game?.primaryArchive.name
      ? { units: defs.units, moveDefs: defs.moveDefs }
      : null;

  const noGame =
    !targetLoading && !target
      ? "No engine is installed, so there is no game to read classes from."
      : scan.error
        ? `The content scan failed: ${scan.error}`
        : scan.data
          ? "No game is installed, so there is no game to read classes from."
          : "Reading games";
  const state = movementState({
    gameName: game?.name ?? null,
    noGame,
    status: current ? status : status === "error" ? "error" : "loading",
    error,
    game: current,
    kinds,
    footprint,
  });

  const movement = project.movement;
  const offered = state.state === "offer" ? state.offer.classes : [];
  const options: {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }[] = [
    { value: STATIC, label: "Does not move" },
    ...offered.map((entry) => ({
      value: entry.name,
      label: entry.name,
      description: [
        entry.kind ? KIND_LABEL[entry.kind] : null,
        entry.footprint ? `${entry.footprint} by ${entry.footprint}` : null,
        `${entry.units} ${entry.units === 1 ? "unit" : "units"}`,
      ]
        .filter(Boolean)
        .join(", "),
    })),
  ];
  // A stored class the list does not hold is still shown, so the picker says
  // what the definition writes. One the game does not declare at all is the
  // unit the engine drops, said only once the game is read.
  const stored =
    movement &&
    !offered.some(
      (entry) => entry.name.toLowerCase() === movement.moveClass.toLowerCase(),
    )
      ? movement.moveClass
      : null;
  const missing = !!stored && !!current && !declaresMoveClass(current, stored);
  if (stored) {
    options.push({ value: stored, label: stored, disabled: missing });
  }

  function pick(value: string) {
    if (value === STATIC) {
      onMovementChange(undefined);
      return;
    }
    if (!current || !game) return;
    onMovementChange(suggestMotion(current, game.name, value));
  }

  function setNumber(key: "speed" | "turnRate", text: string) {
    if (!movement) return;
    const fromKey = key === "speed" ? "speedFrom" : "turnRateFrom";
    const { [key]: _value, [fromKey]: _from, ...rest } = movement;
    const value = Number(text);
    onMovementChange(
      text.trim() === "" || !Number.isFinite(value) || value < 0
        ? rest
        : { ...rest, [key]: value },
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">Movement</p>
      {state.state === "no-game" ? (
        <p className="text-xs text-muted-foreground">{state.reason}</p>
      ) : state.state === "loading" ? (
        <p className="text-xs text-muted-foreground">
          Reading {state.gameName}'s movement classes
        </p>
      ) : state.state === "error" ? (
        <p className="text-xs text-destructive">
          Could not read {state.gameName}: {state.message}
        </p>
      ) : state.state === "none-fit" ? (
        <p className="text-xs text-muted-foreground">
          {state.gameName} has no{" "}
          {state.kinds.map((kind) => KIND_LABEL[kind]).join(" or ")} movement
          class, so this unit does not move.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {state.offer.source === "movedefs"
            ? `${state.gameName}'s ${kinds.length > 0 ? kinds.map((kind) => KIND_LABEL[kind]).join(" and ") : "movement"} classes, from its movedefs.lua`
            : `Classes ${state.gameName}'s units use, not narrowed by kind: its movedefs.lua could not be read`}
        </p>
      )}

      {state.state === "offer" || movement ? (
        <OptionSelect
          value={movement?.moveClass ?? STATIC}
          onValueChange={pick}
          options={options}
          ariaLabel="Movement class"
          size="sm"
        />
      ) : null}
      {missing && game ? (
        <p className="text-xs text-destructive">
          {game.name} has no {stored} class, so the engine drops this unit at
          load. Pick another.
        </p>
      ) : null}

      {movement ? (
        <>
          <Field
            label="Speed, elmos a second"
            hint={
              movement.speedFrom ?? (movement.speed ? undefined : "Not set")
            }
          >
            <Input
              type="number"
              min={0}
              value={movement.speed ?? ""}
              onChange={(event) => setNumber("speed", event.target.value)}
            />
          </Field>
          <Field
            label="Turn rate"
            hint={
              movement.turnRateFrom ??
              (movement.turnRate !== undefined ? undefined : "Not set")
            }
          >
            <Input
              type="number"
              min={0}
              value={movement.turnRate ?? ""}
              onChange={(event) => setNumber("turnRate", event.target.value)}
            />
          </Field>
          {!movement.speed ? (
            <p className="text-xs text-muted-foreground">
              With no speed the engine treats it as static.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
