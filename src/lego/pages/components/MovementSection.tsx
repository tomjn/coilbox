/**
 * The unit's movement class, speed and turn rate, picked from the game the unit
 * belongs to (issues #3255, #4172). See `movement.ts` for how the classes are
 * narrowed and where the numbers come from.
 */

import { Input } from "@picoframe/frame";
import { CheckField, Field } from "../../../components/Field";
import { OptionSelect } from "../../../components/OptionSelect";
import { useUnitDefs } from "../../../workshop/config";
import { bankingKeys, withEngineBanking } from "../../banking";
import type { FlightStyle, LegoMovement, LegoProject } from "../../model";
import {
  declaresMoveClass,
  KIND_LABEL,
  movementKinds,
  movementState,
  suggestFlight,
  suggestMotion,
} from "../../movement";
import type { UnitBounds } from "../../s3oBuild";
import { footprintSteps } from "../../unitDef";
import { installedGameFor, unitGame } from "../../unitGame";
import { useTestGame } from "./useTestGame";
import { useWorkshopChanges, WorkshopChangeMarks } from "./WorkshopChangeMarks";

/** The option that leaves the unit static. Radix's select has no empty value. */
const STATIC = "__static";

/** The options that fly, beside the game's classes. */
const FLIES: Record<FlightStyle, string> = {
  gunship: "__flies_gunship",
  plane: "__flies_plane",
};

interface Props {
  project: LegoProject;
  bounds: UnitBounds;
  onMovementChange: (movement: LegoMovement | undefined) => void;
}

export function MovementSection({ project, bounds, onMovementChange }: Props) {
  // The Test drawer's game is only read here for the engine and the scan. The
  // classes come from the unit's own game, never from the drawer's pick.
  const { target, targetLoading, scan } = useTestGame();
  const workshop = useWorkshopChanges(project);
  const marks = (path: string) => (
    <WorkshopChangeMarks
      unitKey={workshop.key}
      changes={workshop.changesFor([path])}
    />
  );
  const own = unitGame(project);
  const game = installedGameFor(own, scan.data?.games ?? []);
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

  const noGame = !own
    ? "Choose a game for this unit to pick one of its movement classes."
    : !targetLoading && !target
      ? "No engine is installed, so there is no game to read classes from."
      : scan.error
        ? `The content scan failed: ${scan.error}`
        : scan.data
          ? `${own.name} is not installed, so there are no movement classes to read.`
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
  const standIns = [
    ...new Set(
      offered.flatMap((entry) =>
        entry.standsInFor ? [KIND_LABEL[entry.standsInFor]] : [],
      ),
    ),
  ];
  const options: {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }[] = [
    { value: STATIC, label: "Does not move" },
    {
      value: FLIES.gunship,
      label: "Flies, gunship",
      description: "hovers over its target",
    },
    {
      value: FLIES.plane,
      label: "Flies, plane",
      description: "strafes past its target",
    },
    ...offered.map((entry) => ({
      value: entry.name,
      label: entry.name,
      description: [
        entry.kind ? KIND_LABEL[entry.kind] : null,
        entry.standsInFor ? `no ${KIND_LABEL[entry.standsInFor]} class` : null,
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
    !movement.flies &&
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
    const style = (Object.keys(FLIES) as FlightStyle[]).find(
      (key) => FLIES[key] === value,
    );
    if (style) {
      onMovementChange(
        current && game
          ? suggestFlight(current, game.name, style)
          : withEngineBanking({ moveClass: "", flies: style }),
      );
      return;
    }
    if (!current || !game) return;
    onMovementChange(suggestMotion(current, game.name, value));
  }

  function setNumber(
    key:
      | "speed"
      | "turnRate"
      | "reverseSpeed"
      | "acceleration"
      | "brakeRate"
      | "cruiseAltitude"
      | "upDirSmoothing"
      | "maxBank"
      | "maxPitch"
      | "maxAileron"
      | "maxElevator"
      | "maxRudder",
    text: string,
  ) {
    if (!movement) return;
    const fromKey = `${key}From` as const;
    const { [key]: _value, [fromKey]: _from, ...rest } = movement;
    const value = Number(text);
    onMovementChange(
      text.trim() === "" || !Number.isFinite(value) || value < 0
        ? rest
        : { ...rest, [key]: value },
    );
  }

  function setBankingAllowed(allowed: boolean) {
    if (!movement) return;
    const { bankingAllowedFrom: _from, ...rest } = movement;
    onMovementChange({ ...rest, bankingAllowed: allowed });
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
            ? standIns.length > 0
              ? `${state.gameName} has no ${standIns.join(" or ")} class, so these are its nearest kind`
              : `${state.gameName}'s ${kinds.length > 0 ? kinds.map((kind) => KIND_LABEL[kind]).join(" and ") : "movement"} classes, from its movedefs.lua`
            : `Classes ${state.gameName}'s units use, not narrowed by kind: its movedefs.lua could not be read`}
        </p>
      )}

      {state.state === "offer" || state.state === "none-fit" || movement ? (
        <OptionSelect
          value={
            movement?.flies
              ? FLIES[movement.flies]
              : (movement?.moveClass ?? STATIC)
          }
          onValueChange={pick}
          options={options}
          ariaLabel="Movement class"
          size="sm"
        />
      ) : null}
      {stored && !own ? (
        <p className="text-xs text-destructive">
          {stored} is not from this unit's game, because it has none.
        </p>
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
            help={marks("speed")}
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
            help={marks("turnrate")}
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
          {movement.flies ? (
            <Field
              label="Cruise altitude, elmos"
              help={marks("cruisealtitude")}
              hint={
                movement.cruiseAltitudeFrom ??
                (movement.cruiseAltitude ? undefined : "Not set")
              }
            >
              <Input
                type="number"
                min={0}
                value={movement.cruiseAltitude ?? ""}
                onChange={(event) =>
                  setNumber("cruiseAltitude", event.target.value)
                }
              />
            </Field>
          ) : (
            <Field
              label="Reverse speed, elmos a second"
              help={marks("rspeed")}
              hint={
                movement.reverseSpeedFrom ??
                (movement.reverseSpeed
                  ? undefined
                  : "Not set, the unit never backs up")
              }
            >
              <Input
                type="number"
                min={0}
                value={movement.reverseSpeed ?? ""}
                onChange={(event) =>
                  setNumber("reverseSpeed", event.target.value)
                }
              />
            </Field>
          )}
          {movement.flies ? null : (
            <Field
              label="Slope smoothing"
              help={marks("updirsmoothing")}
              hint={
                movement.upDirSmoothing
                  ? undefined
                  : "Not set, the engine uses 0 and the unit follows the ground at once"
              }
            >
              <Input
                type="number"
                min={0}
                max={0.95}
                step="any"
                value={movement.upDirSmoothing ?? ""}
                onChange={(event) =>
                  setNumber("upDirSmoothing", event.target.value)
                }
              />
            </Field>
          )}
          <Field
            label="Acceleration, elmos a frame squared"
            help={marks("acceleration")}
            hint={
              movement.accelerationFrom ??
              (movement.acceleration !== undefined
                ? undefined
                : "Not set, the engine uses 0.5")
            }
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={movement.acceleration ?? ""}
              onChange={(event) =>
                setNumber("acceleration", event.target.value)
              }
            />
          </Field>
          <Field
            label="Brake rate, elmos a frame squared"
            help={marks("brakerate")}
            hint={
              movement.brakeRateFrom ??
              (movement.brakeRate !== undefined
                ? undefined
                : "Not set, the engine brakes at the acceleration")
            }
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={movement.brakeRate ?? ""}
              onChange={(event) => setNumber("brakeRate", event.target.value)}
            />
          </Field>
          {movement.flies ? (
            <>
              <p className="text-xs text-muted-foreground">
                The engine banks aircraft, not the script. The preview's roll
                illustrates these keys.
              </p>
              {bankingKeys(movement.flies).map((entry) => {
                const { key } = entry;
                if (key === "bankingAllowed") {
                  return (
                    <CheckField
                      key={key}
                      label={entry.label}
                      hint={
                        movement.bankingAllowedFrom ??
                        "Not set, the engine allows banking"
                      }
                      checked={
                        movement.bankingAllowed ?? entry.engineDefault === true
                      }
                      onChange={setBankingAllowed}
                    />
                  );
                }
                return (
                  <Field
                    key={key}
                    label={entry.label}
                    help={marks(key.toLowerCase())}
                    hint={
                      movement[`${key}From`] ??
                      (movement[key] !== undefined
                        ? undefined
                        : `Not set, the engine uses ${entry.engineDefault}`)
                    }
                  >
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={movement[key] ?? ""}
                      onChange={(event) => setNumber(key, event.target.value)}
                    />
                  </Field>
                );
              })}
            </>
          ) : null}
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
