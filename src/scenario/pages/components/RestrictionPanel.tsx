/**
 * The restrictions panel: what the mission's teams may build, and what they may
 * be ordered to do.
 *
 * These are the runtime's rules, not the engine's `[RESTRICT]` block, which is
 * global and permanent. The difference is `unlock_unit`, which lifts one def for
 * one participant mid-mission, and that is the whole reason the runtime keeps
 * its own list.
 *
 * The rule binds every team the scenario declares, because the data names no
 * team. That is the one thing an author has to know before writing one, so the
 * panel says it in place rather than in a manual.
 */

import { Button, Input } from "@picoframe/frame";
import { Lock, Plus, X } from "lucide-react";
import { useState } from "react";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Scenario } from "../../model";
import { EditorPanel } from "./panels";
import {
  addBuildableUnit,
  addCommand,
  type BuildableMode,
  buildableMode,
  buildableWarning,
  removeBuildableUnit,
  removeCommand,
  setBuildableMode,
} from "./registries";

/** Commands an author reaches for, as the runtime resolves them: it looks a name
 *  up in the engine's `CMD` table, so these are the engine's names rather than
 *  ours. The box takes any of them, because a game can add its own. */
const COMMON_COMMANDS = [
  "selfd",
  "reclaim",
  "repair",
  "resurrect",
  "capture",
  "manualfire",
  "cloak",
  "onoff",
];

export function RestrictionPanel({
  scenario,
  onChange,
  units,
  unitsLoading,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  /** The scenario's game's units, for picking what is restricted. */
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
}) {
  const mode = buildableMode(scenario);
  const buildable = scenario.restrictions.buildable;
  const listed = buildable?.units ?? [];
  const commands = scenario.restrictions.commands ?? [];
  const warning = buildableWarning(scenario);

  return (
    <EditorPanel
      title="Restrictions"
      icon={Lock}
      summary={summary(mode, listed.length, commands.length)}
    >
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          A restriction binds every team the scenario declares, not the player
          alone: the rule names no team, and an author who wants one for the
          player only writes it here and gives the def back to the others with{" "}
          <code>unlock_unit</code>. Teams the scenario says nothing about, Gaia
          included, are untouched. The mission's own spawns are too, so a
          scenario can place a unit its teams may not build.
        </p>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-medium">Building</h3>
            <OptionSelect
              size="sm"
              className="w-52"
              value={mode}
              onValueChange={(next) =>
                onChange(setBuildableMode(scenario, next as BuildableMode))
              }
              options={[
                { value: "none", label: "Anything the game allows" },
                { value: "allow", label: "Only these units" },
                { value: "deny", label: "Everything but these" },
              ]}
            />
          </div>

          {mode !== "none" && (
            <>
              {listed.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {listed.map((def) => (
                    <li key={def}>
                      <Chip
                        label={def}
                        remove={`Take ${def} off the list`}
                        onRemove={() =>
                          onChange(removeBuildableUnit(scenario, def))
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}

              <UnitPickerButton
                units={units}
                value=""
                loading={unitsLoading}
                placeholder="Add a unit to the list"
                size="sm"
                className="w-72"
                onValueChange={(def) =>
                  onChange(addBuildableUnit(scenario, def))
                }
              />

              {warning && (
                <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
                  {warning}
                </p>
              )}
            </>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border/50 pt-4">
          <h3 className="text-xs font-medium">Commands withheld</h3>
          {commands.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {commands.map((name) => (
                <li key={name}>
                  <Chip
                    label={name}
                    remove={`Allow ${name} again`}
                    onRemove={() => onChange(removeCommand(scenario, name))}
                  />
                </li>
              ))}
            </ul>
          )}
          <CommandField
            taken={commands}
            onAdd={(name) => onChange(addCommand(scenario, name))}
          />
          <p className="text-[11px] text-muted-foreground">
            An engine command name, as the engine spells it: <code>selfd</code>{" "}
            is self destruct. An order the mission's own Lua gives is exempt, so
            withholding one never stops the scenario driving its own units.
          </p>
        </section>
      </div>
    </EditorPanel>
  );
}

function summary(mode: BuildableMode, units: number, commands: number): string {
  const build =
    mode === "none"
      ? "Builds anything"
      : mode === "allow"
        ? `Only ${units} unit${units === 1 ? "" : "s"}`
        : `${units} unit${units === 1 ? "" : "s"} withheld`;
  return commands === 0
    ? build
    : `${build} · ${commands} command${commands === 1 ? "" : "s"}`;
}

/** One entry of a list of names, with the button that takes it back off. */
function Chip({
  label,
  remove,
  onRemove,
}: {
  label: string;
  remove: string;
  onRemove: () => void;
}) {
  return (
    <span className="flex items-center gap-1 rounded-md border border-border/50 py-0.5 pr-0.5 pl-2 font-mono text-xs">
      {label}
      <Button
        size="sm"
        variant="ghost"
        className="size-6 p-0 text-destructive hover:text-destructive"
        aria-label={remove}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

/** A command to withhold, picked from the common ones or typed. Typed as well as
 *  picked, because a game can declare commands of its own and the runtime
 *  resolves whatever name it is given. */
function CommandField({
  taken,
  onAdd,
}: {
  taken: string[];
  onAdd: (name: string) => void;
}) {
  const [text, setText] = useState("");
  const suggestions = COMMON_COMMANDS.filter((name) => !taken.includes(name));

  const add = (name: string) => {
    if (!name.trim()) return;
    onAdd(name);
    setText("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label="Command to withhold"
        value={text}
        placeholder="selfd"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          }
        }}
        className="h-7 w-40 font-mono text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={!text.trim()}
        onClick={() => add(text)}
      >
        <Plus className="size-3.5" /> Withhold
      </Button>
      {suggestions.length > 0 && (
        <OptionSelect
          size="sm"
          className="w-52"
          value=""
          placeholder="Or one of the common ones"
          onValueChange={add}
          options={suggestions.map((name) => ({ value: name, label: name }))}
        />
      )}
    </div>
  );
}
