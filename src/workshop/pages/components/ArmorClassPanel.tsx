/**
 * A unit's armour class, picked from what the game's own `gamedata/armordefs.lua`
 * names plus whatever the project has already invented (issue #2645).
 *
 * Unlike every field beside it on this page, a class is never a key on the
 * unit's own definition: the engine decides it purely from which class's
 * membership list in that one shared file names the unit
 * (`CDamageArrayHandler::Init`, `UnitDef::armorType`), so there is no path in
 * this unit's own file for the edit-in-place route to write, and no field for
 * `overrides` to hold. It always goes through the mutator, which ships its own
 * whole `gamedata/armordefs.lua` in place of the game's.
 */
import { Button, Input } from "@picoframe/frame";
import { FileCog, RotateCcw } from "lucide-react";
import { useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import type { ArmorClassSummary } from "../../armorClasses";

export function ArmorClassPanel({
  unitName,
  current,
  inherited,
  options,
  onChange,
}: {
  unitName: string;
  /** The class the unit is in once the project's own move is applied. */
  current: string;
  /** The class the game's own `armordefs.lua` puts the unit in, ignoring any
   *  move the project has made. */
  inherited: string;
  options: ArmorClassSummary[];
  onChange: (className: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const overridden = current.toLowerCase() !== inherited.toLowerCase();

  const known = options.some(
    (o) => o.name.toLowerCase() === current.toLowerCase(),
  );
  const selectOptions = known
    ? options.map((o) => ({
        value: o.name,
        label: o.name,
        description: `${o.units} unit${o.units === 1 ? "" : "s"}`,
      }))
    : [
        {
          value: current,
          label: current,
          description: `Not in ${unitName}'s game or project yet`,
        },
        ...options.map((o) => ({
          value: o.name,
          label: o.name,
          description: `${o.units} unit${o.units === 1 ? "" : "s"}`,
        })),
      ];

  const addClass = () => {
    const name = draft.trim();
    if (!name) return;
    onChange(name);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Armour class</span>
        <OptionSelect
          size="sm"
          ariaLabel="Armour class"
          placeholder="default"
          value={current}
          onValueChange={onChange}
          options={selectOptions}
        />
        {!adding ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-[10px]"
            onClick={() => setAdding(true)}
          >
            Add a class
          </Button>
        ) : (
          <span className="flex items-center gap-1.5">
            <Input
              className="h-8 w-40 font-mono text-xs"
              aria-label="New armour class name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addClass();
                }
                if (e.key === "Escape") {
                  setDraft("");
                  setAdding(false);
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[10px]"
              onClick={addClass}
            >
              Use this name
            </Button>
          </span>
        )}
        {overridden && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onChange(inherited)}
            title={`Reset the armour class to ${inherited}, the game's own`}
            aria-label={`Reset the armour class to ${inherited}, the game's own`}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
      <span className="flex items-start gap-1 text-[10px] text-muted-foreground">
        <FileCog className="mt-px size-3 shrink-0" />
        <span>
          An armour class is a name in the game's own{" "}
          <span className="font-mono">gamedata/armordefs.lua</span>, not a field
          on {unitName}, so this always goes through the mutator route: it ships
          a whole copy of that file with {unitName} moved.
          {overridden
            ? ` The game itself puts ${unitName} in ${inherited}.`
            : ""}
        </span>
      </span>
    </div>
  );
}
