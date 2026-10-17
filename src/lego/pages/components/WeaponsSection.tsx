/**
 * What each turret and aim point fires, and over what arc (issue #3274). See
 * `weaponModule.ts` for how the choice reaches the exported unit.
 *
 * The game is the unit's own, else the game it was exported into, since a unit
 * built from parts records no game of its own yet.
 */

import { Button, Input } from "@picoframe/frame";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUnitDefs } from "@/workshop/config";
import { exportedInto } from "@/workshop/legoUnits";
import { type ModProject, useModProjects } from "@/workshop/project";
import type { LegoPieceWeapon, LegoProject, LegoWeaponRef } from "../../model";
import { unitGame } from "../../movement";
import {
  mountedWeapons,
  pickedWeapon,
  sameWeapon,
  type WeaponOption,
  weaponCarriers,
  weaponOptions,
  weaponSummary,
} from "../../weaponModule";
import { useTestGame } from "./useTestGame";

interface Props {
  project: LegoProject;
  onWeaponChange: (pieceId: string, weapon: LegoPieceWeapon) => void;
}

/** What the picker can offer, or why it cannot offer the game's weapons. */
export interface WeaponSource {
  gameName: string | null;
  /** Null until the game is read. */
  weaponDefs: Record<string, Record<string, unknown>> | null;
  projects: readonly ModProject[];
  /** Why there is nothing to pick from yet. */
  unavailable: string | null;
}

export function useWeaponSource(project: LegoProject): WeaponSource {
  const { target, targetLoading, scan } = useTestGame();
  const { projects } = useModProjects();
  const own = unitGame(project);
  const games = scan.data?.games ?? [];
  const game = own
    ? games.find((g) => g.primaryArchive.name === own.archive)
    : games.find((g) => exportedInto(project, g.primaryArchive.path));
  const { defs, defsFor, status, error } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const current = defs && defsFor === game?.primaryArchive.name ? defs : null;
  const named = own?.name ?? "The game it was exported into";
  const unavailable =
    !own && !project.exported
      ? "Choose a game for this unit first: export it into the game's folder."
      : !targetLoading && !target
        ? "No engine is installed, so the game cannot be read."
        : scan.error
          ? `The content scan failed: ${scan.error}`
          : scan.data && !game
            ? `${named} is not installed.`
            : status === "error"
              ? `Could not read ${game?.name ?? named}: ${error ?? "its definitions could not be read"}`
              : null;
  return {
    gameName: game?.name ?? null,
    weaponDefs: current?.weaponDefs ?? null,
    projects,
    unavailable,
  };
}

function refLabel(ref: LegoWeaponRef): string {
  return ref.from === "game" ? ref.name : ref.key;
}

function WeaponPicker({
  value,
  source,
  onPick,
  label,
}: {
  value: LegoWeaponRef | undefined;
  source: WeaponSource;
  onPick: (ref: LegoWeaponRef | undefined) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const options =
    source.gameName && !source.unavailable
      ? weaponOptions(source.gameName, source.weaponDefs ?? {}, source.projects)
      : [];
  const groups = [...new Set(options.map((o) => o.group))];
  const pick = (ref: LegoWeaponRef | undefined) => {
    setOpen(false);
    onPick(ref);
  };
  const row = (option: WeaponOption) => (
    <CommandItem
      key={`${option.group}/${option.label}`}
      value={`${option.group}/${option.label}`}
      onSelect={() => pick(option.ref)}
    >
      <Check
        className={cn(
          "mr-2 size-4",
          value && sameWeapon(value, option.ref) ? "opacity-100" : "opacity-0",
        )}
      />
      {option.label}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={label}
          aria-expanded={open}
          className="justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? refLabel(value) : "Pick a weapon"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {source.unavailable ? (
          <p className="p-3 text-xs text-muted-foreground">
            {source.unavailable}
          </p>
        ) : !source.gameName || !source.weaponDefs ? (
          <p className="p-3 text-xs text-muted-foreground">
            Reading {source.gameName ?? "games"}
          </p>
        ) : (
          <Command>
            <CommandInput placeholder="Search weapons…" />
            <CommandList>
              <CommandEmpty>No weapon matches that.</CommandEmpty>
              {value ? (
                <CommandGroup>
                  <CommandItem
                    value="No weapon"
                    onSelect={() => pick(undefined)}
                  >
                    No weapon
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {groups.map((group) => (
                <CommandGroup key={group} heading={group}>
                  {options.filter((o) => o.group === group).map(row)}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function WeaponsSection({ project, onWeaponChange }: Props) {
  const source = useWeaponSource(project);
  const carriers = weaponCarriers(project);
  if (carriers.length === 0) return null;
  const mounted = mountedWeapons(project);

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">Weapons</p>
      {carriers.map((piece) => {
        const weapon = piece.weapon ?? {};
        const slot = mounted.findIndex((m) => m.piece.id === piece.id) + 1;
        const picked = weapon.fires
          ? pickedWeapon(
              weapon.fires,
              source.gameName ?? "The game",
              source.weaponDefs,
              source.projects,
            )
          : null;
        const arc = weapon.arc ?? 360;
        const set = (next: LegoPieceWeapon) => onWeaponChange(piece.id, next);
        const setNumber = (key: "arc" | "heading", text: string) => {
          const { [key]: _old, ...rest } = weapon;
          const value = Number(text);
          set(
            text.trim() === "" || !Number.isFinite(value)
              ? rest
              : { ...rest, [key]: value },
          );
        };
        return (
          <div key={piece.id} className="flex flex-col gap-1.5">
            <p className="text-xs">
              {piece.name}
              <span className="text-muted-foreground">
                {slot > 0 ? `, weapon ${slot}` : ", fires nothing"}
              </span>
            </p>
            <WeaponPicker
              value={weapon.fires}
              source={source}
              label={`Weapon for ${piece.name}`}
              onPick={(fires) => {
                const { fires: _old, ...rest } = weapon;
                set(fires ? { ...rest, fires } : rest);
              }}
            />
            {picked && "def" in picked ? (
              <p className="text-xs text-muted-foreground">
                {weaponSummary(picked.def)}
              </p>
            ) : picked ? (
              <p className="text-xs text-destructive">{picked.problem}</p>
            ) : null}
            {weapon.fires ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Arc, degrees">
                  <Input
                    type="number"
                    min={1}
                    max={360}
                    placeholder="360"
                    value={weapon.arc ?? ""}
                    onChange={(event) => setNumber("arc", event.target.value)}
                  />
                </Field>
                {arc < 360 ? (
                  <Field label="Facing, degrees right">
                    <Input
                      type="number"
                      min={-180}
                      max={180}
                      placeholder="0"
                      value={weapon.heading ?? ""}
                      onChange={(event) =>
                        setNumber("heading", event.target.value)
                      }
                    />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
